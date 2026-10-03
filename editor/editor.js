import { handoutNeedsFixing, handoutOptionLabel, indentSelection, prefixLines, readHandoutStatus, selectionDetails, setHandoutStatus } from './editor-model.js';

const select = document.querySelector('#handout');
const needsFixing = document.querySelector('#needs-fixing');
const source = document.querySelector('#source');
const visual = document.querySelector('#visual');
const visualMode = document.querySelector('#visual-mode');
const sourceMode = document.querySelector('#source-mode');
const editorLabel = document.querySelector('#editor-label');
const visualHelp = document.querySelector('#visual-help');
const preview = document.querySelector('#preview');
const state = document.querySelector('#state');
const scanState = document.querySelector('#scan-state');
const message = document.querySelector('#message');
const issues = document.querySelector('#issues');
const validationState = document.querySelector('#validation-state');
const validationPanel = document.querySelector('#validation');
const cursorStatus = document.querySelector('#cursor-status');
const documentStatus = document.querySelector('#document-status');
const draftRecovery = document.querySelector('#draft-recovery');
const imageDialog = document.querySelector('#image-dialog');
const assetList = document.querySelector('#asset-list');
let opened = { source: '', revision: '' };
let selectedAsset = '';
let previewTimer;
let validationTimer;
let validationSequence = 0;
// This cache describes a completed request, not whatever happens to be rendered
// in the Validation panel. Background validation may finish out of order, so
// callers must compare the complete buffer snapshot before reusing it.
let completedSyntaxValidation;
let renderSequence = 0;
let renderController;
const session = crypto.randomUUID();
let handouts = [];
let editorMode = 'visual';
const attachedVisualDocuments = new WeakSet();

function frontMatter(sourceText) {
  const match = sourceText.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
  return match?.[0] || '';
}
function authoredHtml(document) {
  return [...document.querySelectorAll('.sheet .content')].map(content => {
    const clone = content.cloneNode(true);
    clone.querySelectorAll('.kicker, h1, .footer').forEach(element => element.remove());
    clone.querySelectorAll('[data-source-path], [data-source-line], [contenteditable]').forEach(element => {
      element.removeAttribute('data-source-path'); element.removeAttribute('data-source-line'); element.removeAttribute('contenteditable');
    });
    return clone.innerHTML.trim();
  }).join('\n\n<!-- pagebreak -->\n\n');
}
function attachVisualEditor() {
  const document = visual.contentDocument;
  if (!document || attachedVisualDocuments.has(document)) return;
  attachedVisualDocuments.add(document);
  document.querySelectorAll('.content').forEach(content => {
    content.contentEditable = 'true';
    content.querySelectorAll(':scope > .kicker, :scope > h1, :scope > .footer').forEach(element => { element.contentEditable = 'false'; });
  });
  const style = document.createElement('style');
  style.textContent = '.content[contenteditable="true"] { outline: 2px solid transparent; } .content[contenteditable="true"]:focus { outline-color: #2563eb; outline-offset: -3px; }';
  document.head.append(style);
  document.body.addEventListener('input', () => {
    source.value = `${frontMatter(source.value)}${authoredHtml(document)}\n`;
    updateStatusControl(); renderSoon();
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });
}
function showEditorMode(mode) {
  editorMode = mode;
  const isVisual = mode === 'visual';
  visual.hidden = !isVisual; source.hidden = isVisual; visualHelp.hidden = !isVisual;
  visualMode.classList.toggle('active', isVisual); sourceMode.classList.toggle('active', !isVisual);
  visualMode.setAttribute('aria-pressed', String(isVisual)); sourceMode.setAttribute('aria-pressed', String(!isVisual));
  editorLabel.textContent = isVisual ? 'Visual editor' : 'Markdown / HTML source';
  cursorStatus.hidden = isVisual;
  if (isVisual) renderVisual(); else source.focus();
}
async function renderVisual() {
  try {
    const html = await request('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: select.value, source: source.value }) });
    if (editorMode !== 'visual') return;
    visual.addEventListener('load', attachVisualEditor, { once: true });
    visual.srcdoc = html;
  } catch (error) { message.textContent = `Visual editor: ${error.message}. Switch to Source to correct the document.`; }
}

function populateHandouts(preferredPath = select.value) {
  const visible = needsFixing.checked ? handouts.filter(handoutNeedsFixing) : handouts;
  select.replaceChildren(...visible.map(item => new Option(handoutOptionLabel(item), item.path)));
  if (visible.some(item => item.path === preferredPath)) select.value = preferredPath;
}
function updateHandout(path, changes) {
  const item = handouts.find(candidate => candidate.path === path);
  if (!item) return;
  Object.assign(item, changes);
  if (needsFixing.checked && path === select.value && !handoutNeedsFixing(item)) needsFixing.checked = false;
  populateHandouts(path);
}

async function scanHandouts() {
  let completed = 0;
  scanState.textContent = `Scanning handouts… 0/${handouts.length}`;
  for (const item of handouts) {
    updateHandout(item.path, { formatting: 'checking' });
    try {
      const result = await request('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: item.path }) });
      if (item.path !== opened.path || !dirty()) updateHandout(item.path, { formatting: result.formatting, issueCount: result.issueCount });
    } catch {
      if (item.path !== opened.path || !dirty()) updateHandout(item.path, { formatting: 'unavailable' });
    }
    completed += 1;
    scanState.textContent = `Scanning handouts… ${completed}/${handouts.length}`;
  }
  const errors = handouts.filter(item => item.formatting === 'error').length;
  const unavailable = handouts.filter(item => item.formatting === 'unavailable').length;
  scanState.textContent = unavailable
    ? `Scan complete · ${errors} with errors · ${unavailable} unavailable`
    : `Scan complete · ${errors} with errors`;
}

const draftKey = path => `handout-editor:draft:${path}`;
function readDraft(path) {
  try { return JSON.parse(localStorage.getItem(draftKey(path))); } catch { return null; }
}
function writeDraft() {
  if (!opened.path || !dirty()) return;
  try { localStorage.setItem(draftKey(opened.path), JSON.stringify({ source: source.value, revision: opened.revision, updatedAt: Date.now() })); } catch { /* Editing must continue if storage is unavailable. */ }
}
function clearDraft(path = opened.path) {
  try { localStorage.removeItem(draftKey(path)); } catch { /* Storage may be disabled. */ }
  draftRecovery.hidden = true;
}
function updateCursorStatus() {
  const details = selectionDetails(source.value, source.selectionStart, source.selectionEnd);
  const selection = details.selected ? ` · ${details.selected} selected` : '';
  cursorStatus.textContent = `Line ${details.line}, column ${details.column} · ${details.words} words · ${details.characters} characters${selection}`;
}
function updateStatusControl() {
  const status = readHandoutStatus(source.value);
  documentStatus.disabled = !status;
  if (status) documentStatus.value = status;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const type = response.headers.get('content-type') || '';
  const value = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw Error(value.error || value);
  return value;
}
function dirty() {
  const changed = source.value !== opened.source;
  state.textContent = changed ? 'Unsaved changes' : 'Saved';
  state.classList.toggle('dirty', changed);
  return changed;
}
function renderSoon() {
  dirty(); writeDraft(); updateCursorStatus(); clearTimeout(previewTimer);
  previewTimer = setTimeout(render, 350);
  clearTimeout(validationTimer);
  validationTimer = setTimeout(validate, 100);
}
function showIssues(findings) {
  issues.replaceChildren(...findings.map(issue => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${issue.type}${issue.page ? ` · page ${issue.page}` : ''}: ${issue.message}`;
    const help = document.createElement('small');
    help.textContent = issue.remediation || 'Correct the reported source or metadata; no automatic change was made.';
    button.append(help);
    button.addEventListener('click', () => selectIssue(issue));
    item.append(button); return item;
  }));
}
function selectIssue(issue) {
  const matchingElement = document => document && issue.sourcePath && issue.sourceLine
    ? [...document.querySelectorAll('[data-source-path][data-source-line]')].find(candidate => candidate.dataset.sourcePath === issue.sourcePath && Number(candidate.dataset.sourceLine) === issue.sourceLine)
    : null;
  const previewDocument = preview.contentDocument;
  previewDocument?.querySelectorAll('[data-validation-outline]').forEach(element => { element.style.outline = ''; element.removeAttribute('data-validation-outline'); });
  const previewElement = matchingElement(previewDocument);
  if (previewElement) {
    previewElement.dataset.validationOutline = 'true'; previewElement.style.outline = '3px solid #dc2626'; previewElement.style.outlineOffset = '2px';
    previewElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const visualElement = editorMode === 'visual' ? matchingElement(visual.contentDocument) : null;
  if (visualElement) {
    if (!visualElement.hasAttribute('tabindex')) visualElement.setAttribute('tabindex', '-1');
    visualElement.focus({ preventScroll: true });
    visualElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    message.textContent = `Navigated to ${issue.type} in the Visual editor.`;
    return;
  }
  if (editorMode === 'visual' && previewElement) {
    message.textContent = `Navigated to ${issue.type} in the preview.`;
    return;
  }
  if (issue.sourceLine) {
    showEditorMode('source');
    const lines = source.value.split('\n');
    const lineIndex = Math.max(0, Math.min(issue.sourceLine - 1, lines.length - 1));
    const start = lines.slice(0, lineIndex).reduce((length, line) => length + line.length + 1, 0);
    source.setSelectionRange(start, start + lines[lineIndex].length);
    const style = getComputedStyle(source);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
    source.scrollTop = Math.max(0, lineIndex * lineHeight - (source.clientHeight - lineHeight) / 2);
    source.scrollLeft = 0;
    message.textContent = `Navigated to ${issue.type} on source line ${issue.sourceLine}.`;
  } else {
    message.textContent = `Could not locate ${issue.type} in the document.`;
  }
}
function bufferSnapshot() {
  return { path: select.value, source: source.value };
}
function isCurrentBuffer(snapshot) {
  return snapshot.path === select.value && snapshot.source === source.value;
}
function matchesBuffer(validation, snapshot) {
  return validation?.path === snapshot.path && validation.source === snapshot.source;
}
async function validateSyntax(snapshot) {
  const result = await request('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...snapshot, phase: 'syntax' }) });
  completedSyntaxValidation = { path: snapshot.path, source: snapshot.source, result };
  return result;
}
async function syntaxForSave(snapshot) {
  if (matchesBuffer(completedSyntaxValidation, snapshot)) return completedSyntaxValidation.result;
  return validateSyntax({ ...snapshot, session, requestId: ++validationSequence });
}
async function validate() {
  const sequence = ++validationSequence;
  const payload = { path: select.value, source: source.value, session, requestId: sequence };
  try {
    const syntax = await validateSyntax(payload);
    if (sequence !== validationSequence) return;
    showIssues(syntax.issues);
    if (!syntax.valid) { updateHandout(payload.path, { formatting: 'error' }); validationState.textContent = 'Fix syntax / metadata'; validationState.className = ''; return; }
    validationState.textContent = 'Checking layout'; validationState.className = 'checking';
    showIssues([]);
    const layout = await request('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, phase: 'layout' }) });
    if (sequence !== validationSequence) return;
    showIssues(layout.issues);
    validationState.textContent = layout.valid ? 'No issues' : `${layout.issues.length} issue${layout.issues.length === 1 ? '' : 's'}`;
    updateHandout(payload.path, { formatting: layout.valid ? 'valid' : 'error' });
    validationState.className = '';
  } catch (error) {
    if (sequence === validationSequence && !/superseded/i.test(error.message)) { validationState.textContent = `Validation unavailable: ${error.message}`; validationState.className = ''; }
  }
}
async function render() {
  const sequence = ++renderSequence;
  renderController?.abort();
  renderController = new AbortController();
  try {
    const html = await request('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: select.value, source: source.value }), signal: renderController.signal });
    if (sequence !== renderSequence) return;
    preview.srcdoc = html;
    message.textContent = '';
  } catch (error) { if (error.name !== 'AbortError' && sequence === renderSequence) message.textContent = `Preview: ${error.message}`; }
}
async function openHandout({ discardCurrentDraft = false } = {}) {
  if (dirty() && !confirm('Discard unsaved changes?')) { select.value = opened.path; return; }
  try {
    if (discardCurrentDraft) clearDraft();
    opened = await request(`/api/handout?path=${encodeURIComponent(select.value)}`);
    source.value = opened.source; selectedAsset = ''; showAssets(); updateStatusControl(); dirty();
    const draft = readDraft(opened.path);
    const canRestore = draft && typeof draft.source === 'string' && draft.source !== opened.source;
    draftRecovery.hidden = !canRestore;
    draftRecovery.dataset.path = canRestore ? opened.path : '';
    renderSoon(); showEditorMode(editorMode);
  } catch (error) { message.textContent = error.message; }
}
async function save() {
  try {
    clearTimeout(validationTimer);
    let snapshot;
    let syntax;
    do {
      snapshot = bufferSnapshot();
      syntax = await syntaxForSave(snapshot);
    } while (!isCurrentBuffer(snapshot));
    if (!syntax.valid) {
      showIssues(syntax.issues);
      validationState.textContent = 'Fix syntax / metadata';
      validationState.className = '';
      validationPanel.focus();
      if (!confirm('Syntax or metadata errors remain. Save this incomplete draft anyway?')) {
        message.textContent = 'Save canceled. Review the Validation panel.';
        return false;
      }
    }
    const result = await request('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...snapshot, revision: opened.revision }) });
    opened = { ...opened, ...snapshot, revision: result.revision }; updateHandout(snapshot.path, { status: result.status }); clearDraft(); dirty(); message.textContent = 'Saved atomically.'; return true;
  } catch (error) { message.textContent = `Not saved: ${error.message}`; return false; }
}
function insert(button) {
  const start = source.selectionStart; const end = source.selectionEnd; const selected = source.value.slice(start, end);
  let replacement;
  if (button.dataset.wrap) { const [before, after] = button.dataset.wrap.split('|'); replacement = before + selected + after; }
  else if (button.dataset.before && selected.includes('\n')) {
    const change = prefixLines(source.value, start, end, button.dataset.before);
    source.setRangeText(change.replacement, change.start, change.end, 'select');
    source.setSelectionRange(change.selectionStart, change.selectionEnd); source.focus(); renderSoon(); return;
  } else if (button.dataset.before) replacement = button.dataset.before + selected;
  else if (button.dataset.insert) replacement = button.dataset.insert;
  else {
    const kind = button.dataset.block;
    if (kind === 'procedure') replacement = `<ol class="procedure">\n<li>${selected || 'Step'}</li>\n</ol>`;
    else if (kind === 'checklist') replacement = `<div class="checklist"><ul>\n<li>${selected || 'Item'}</li>\n</ul></div>`;
    else if (kind === 'grid') replacement = `<div class="grid">\n<div>${selected || 'Left column'}</div>\n<div>Right column</div>\n</div>`;
    else replacement = `<div class="${kind}">\n${selected || 'Content'}\n</div>`;
  }
  source.setRangeText(replacement, start, end, 'end'); source.focus(); renderSoon();
}
function imageOptions() {
  return {
    width: document.querySelector('#image-width').value,
    align: document.querySelector('#image-align').value,
    crop: document.querySelector('#image-crop').value,
    position: `${document.querySelector('#image-x').value}% ${document.querySelector('#image-y').value}%`
  };
}
function selectedFigure() {
  const cursor = source.selectionStart;
  const before = source.value.lastIndexOf('<figure', cursor);
  if (before < 0) return null;
  let end = source.value.indexOf('</figure>', before);
  if (end < cursor) return null;
  end += '</figure>'.length;
  const clear = source.value.slice(end).match(/^\n<div class="figure-clear"><\/div>/);
  if (clear) end += clear[0].length;
  const text = source.value.slice(before, end);
  const file = text.match(/\.\.\/assets\/handouts\/[^/]+\/([^"?#]+)/)?.[1];
  return { start: before, end, text, file };
}
function showAssets() {
  assetList.replaceChildren(...(opened.assets || []).map(asset => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `asset${selectedAsset === asset.file ? ' selected' : ''}`;
    const image = document.createElement('img');
    image.src = `/assets/handouts/${encodeURIComponent(opened.code)}/${encodeURIComponent(asset.file)}`; image.alt = '';
    button.append(image, document.createTextNode(asset.file));
    button.addEventListener('click', () => { selectedAsset = asset.file; showAssets(); });
    return button;
  }));
}
async function figureMarkup(file) {
  return request('/api/figure', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: select.value, file, options: imageOptions() }) });
}
async function insertAsset(file) {
  const result = await figureMarkup(file);
  const range = selectedFigure();
  if (range) source.setRangeText(result.markup, range.start, range.end, 'end');
  else source.setRangeText(`\n${result.markup}\n`, source.selectionStart, source.selectionEnd, 'end');
  source.focus(); renderSoon(); imageDialog.close();
}
document.querySelector('#images').addEventListener('click', () => {
  const figure = selectedFigure();
  if (figure?.file) selectedAsset = figure.file;
  showAssets(); imageDialog.showModal();
});
document.querySelector('#image-form').addEventListener('submit', async event => {
  event.preventDefault();
  const file = document.querySelector('#image-file').files[0];
  if (!file) return;
  try {
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const decorative = document.querySelector('#image-decorative').checked;
    const result = await request('/api/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      path: select.value, name: file.name, mimeType: file.type, dataUrl,
      type: document.querySelector('#image-type').value, alt: decorative ? '' : document.querySelector('#image-alt').value,
      decorative, caption: document.querySelector('#image-caption').value, creator: document.querySelector('#image-creator').value,
      source: document.querySelector('#image-source').value, license: document.querySelector('#image-license').value, options: imageOptions()
    }) });
    opened.assets.push(result.asset); selectedAsset = result.asset.file;
    source.setRangeText(`\n${result.markup}\n`, source.selectionStart, source.selectionEnd, 'end');
    event.target.reset(); showAssets(); renderSoon(); imageDialog.close();
  } catch (error) { message.textContent = `Image not added: ${error.message}`; }
});
document.querySelector('#image-decorative').addEventListener('change', event => {
  const alt = document.querySelector('#image-alt'); alt.disabled = event.target.checked; alt.required = !event.target.checked;
});
document.querySelector('#apply-image').addEventListener('click', async () => {
  if (!selectedAsset) return void (message.textContent = 'Select an image first.');
  try { await insertAsset(selectedAsset); } catch (error) { message.textContent = error.message; }
});
document.querySelector('#remove-image').addEventListener('click', () => {
  const figure = selectedFigure();
  if (!figure) return void (message.textContent = 'Place the source cursor inside a figure first.');
  source.setRangeText('', figure.start, figure.end, 'start'); renderSoon(); imageDialog.close();
});
document.querySelector('#delete-image').addEventListener('click', async () => {
  if (!selectedAsset || !confirm(`Permanently delete ${selectedAsset}?`)) return;
  const figure = selectedFigure();
  if (figure?.file === selectedAsset) source.setRangeText('', figure.start, figure.end, 'start');
  if (source.value.includes(`../assets/handouts/${opened.code}/${selectedAsset}`)) return void (message.textContent = 'Remove every use of this image from the source before deleting it.');
  if (dirty() && !await save()) return;
  try {
    await request('/api/assets', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: select.value, file: selectedAsset }) });
    opened.assets = opened.assets.filter(asset => asset.file !== selectedAsset); selectedAsset = ''; showAssets(); renderSoon(); imageDialog.close(); message.textContent = 'Asset deleted.';
  } catch (error) { message.textContent = `Asset not deleted: ${error.message}`; }
});
document.querySelector('#toolbar').addEventListener('click', event => {
  if (!event.target.matches('button:not(#images):not(#visual-mode):not(#source-mode)')) return;
  if (editorMode === 'visual') {
    const commands = { '**|**': 'bold', '*|*': 'italic', '- ': 'insertUnorderedList', '## ': 'formatBlock' };
    const key = event.target.dataset.wrap || event.target.dataset.before;
    if (commands[key]) {
      visual.contentDocument.execCommand(commands[key], false, key === '## ' ? 'h2' : null);
      visual.contentDocument.body.dispatchEvent(new Event('input', { bubbles: true }));
      visual.contentWindow.focus(); return;
    }
    showEditorMode('source');
    message.textContent = 'Switched to Source for this structural editing tool.';
  }
  insert(event.target);
});
visualMode.addEventListener('click', () => showEditorMode('visual'));
sourceMode.addEventListener('click', () => showEditorMode('source'));
document.querySelector('#save').addEventListener('click', save);
document.querySelector('#revert').addEventListener('click', () => openHandout({ discardCurrentDraft: true }));
select.addEventListener('change', openHandout); source.addEventListener('input', renderSoon);
source.addEventListener('input', updateStatusControl);
documentStatus.addEventListener('change', () => {
  const updated = setHandoutStatus(source.value, documentStatus.value);
  if (updated === source.value) return updateStatusControl();
  const start = source.selectionStart;
  const end = source.selectionEnd;
  source.value = updated;
  source.setSelectionRange(start, end);
  renderSoon();
  message.textContent = `Status changed to ${documentStatus.selectedOptions[0].textContent}. Save to keep this change.`;
});
needsFixing.addEventListener('change', async () => {
  const previous = select.value;
  populateHandouts(previous);
  if (!select.value && handouts.length) {
    needsFixing.checked = false;
    populateHandouts(previous);
    message.textContent = 'No handouts currently need fixing.';
  } else if (select.value !== previous) await openHandout();
});
source.addEventListener('click', updateCursorStatus);
source.addEventListener('keyup', updateCursorStatus);
source.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  const change = indentSelection(source.value, source.selectionStart, source.selectionEnd, event.shiftKey);
  source.setRangeText(change.replacement, change.start, change.end, 'select');
  source.setSelectionRange(change.selectionStart, change.selectionEnd);
  renderSoon();
});
document.querySelector('#restore-draft').addEventListener('click', () => {
  const draft = readDraft(opened.path);
  if (!draft || draftRecovery.dataset.path !== opened.path) return;
  source.value = draft.source; draftRecovery.hidden = true; renderSoon(); source.focus();
  message.textContent = 'Browser draft restored. Review and save when ready.';
});
document.querySelector('#discard-draft').addEventListener('click', () => { clearDraft(); message.textContent = 'Browser draft discarded.'; });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } });
window.addEventListener('beforeunload', event => { if (dirty()) event.preventDefault(); });

handouts = await request('/api/handouts');
populateHandouts();
if (handouts.length) {
  await openHandout();
  scanHandouts();
}
