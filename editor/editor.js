import { createProofControls } from './proof-controls.js';
import { createLibraryControls } from './library-controls.js';
import { createPreviewControls } from './preview-controls.js';
import { EditHistory, updateMetadataFields, figureAtOffset, figureRanges, handoutNeedsFixing, handoutOptionLabel, indentSelection, prefixLines, readHandoutStatus, selectionDetails, setHandoutStatus } from './editor-model.js';

const select = document.querySelector('#handout');
const handoutSearch = document.querySelector('#handout-search');
const handoutResults = document.querySelector('#handout-results');
const needsFixing = document.querySelector('#needs-fixing');
const source = document.querySelector('#source');
const visual = document.querySelector('#visual');
const visualMode = document.querySelector('#visual-mode');
const sourceMode = document.querySelector('#source-mode');
const editorLabel = document.querySelector('#editor-label');
const visualHelp = document.querySelector('#visual-help');
const preview = document.querySelector('#preview');
const previewControls = createPreviewControls(preview);
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
let proofControls;
let selectedAsset = '';
let imageContext;
let imageBusy = false;
let uploadPreviewUrl;
let visualSelection;
let pendingVisualFocus;
let previewTimer;
let validationTimer;
let validationSequence = 0;
// This cache describes a completed request, not whatever happens to be rendered
// in the Validation panel. Background validation may finish out of order, so
// callers must compare the complete buffer snapshot before reusing it.
let completedSyntaxValidation;
let renderSequence = 0;
let renderController;
let visualRenderSequence = 0;
let visualRenderController;
const session = sessionStorage.getItem('handout-editor:session') || crypto.randomUUID();
sessionStorage.setItem('handout-editor:session', session);
let handouts = [];
let scanGeneration = 0;
let editorMode = 'visual';
const history = new EditHistory();
const attachedVisualDocuments = new WeakSet();

function authoredHtml(element) {
  const clone = element.cloneNode(true);
  [clone, ...clone.querySelectorAll('*')].forEach(candidate => {
    if (candidate.hasAttribute('data-editor-tabindex')) candidate.removeAttribute('tabindex');
    candidate.removeAttribute('data-editor-tabindex');
    candidate.removeAttribute('data-image-editable');
    candidate.removeAttribute('data-source-path');
    candidate.removeAttribute('data-source-line');
    candidate.removeAttribute('data-visual-block');
    candidate.removeAttribute('contenteditable');
    if (candidate.matches('img') && candidate.getAttribute('src')?.startsWith('../assets/handouts/')) {
      candidate.setAttribute('src', candidate.getAttribute('src').split('?')[0]);
    }
  });
  return clone.outerHTML;
}
function lineOffset(value, line) {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = value.indexOf('\n', offset);
    if (newline < 0) return value.length;
    offset = newline + 1;
  }
  return offset;
}
function visualBlocks(document, sourceText) {
  const elements = [...document.querySelectorAll('.sheet .content')]
    .flatMap(content => [...content.children])
    .filter(element => !element.matches('.kicker, h1:not([data-source-line]), .footer'));
  const identifiers = new Map();
  const records = elements.map(element => {
    const annotations = [element, ...element.querySelectorAll('[data-source-line]')]
      .filter(candidate => candidate.dataset.sourcePath === opened.path && Number(candidate.dataset.sourceLine));
    const line = Math.min(...annotations.map(candidate => Number(candidate.dataset.sourceLine)));
    if (!Number.isFinite(line)) return null;
    const key = `${opened.path}:${line}`;
    const occurrence = identifiers.get(key) ?? 0;
    identifiers.set(key, occurrence + 1);
    const identifier = `${key}:${occurrence}`;
    element.dataset.visualBlock = identifier;
    return { element, identifier, start: lineOffset(sourceText, line), end: sourceText.length };
  }).filter(Boolean);
  records.forEach((record, index) => {
    let boundary = records[index + 1]?.start ?? sourceText.length;
    const pageBreak = sourceText.slice(record.start, boundary).search(/^<!--\s*pagebreak\s*-->\s*$/mi);
    if (pageBreak >= 0) boundary = record.start + pageBreak;
    const candidate = sourceText.slice(record.start, boundary);
    record.end = record.start + candidate.trimEnd().length;
  });
  return records;
}
function attachVisualEditor() {
  const document = visual.contentDocument;
  if (!document || attachedVisualDocuments.has(document)) return;
  attachedVisualDocuments.add(document);
  const blocks = visualBlocks(document, source.value);
  visualSelection = undefined; updateComponentTools();
  const blockByIdentifier = new Map(blocks.map(block => [block.identifier, block]));
  document.querySelectorAll('.content').forEach(content => {
    content.contentEditable = 'false';
  });
  blocks.forEach(block => { block.element.contentEditable = 'true'; });
  const style = document.createElement('style');
  style.textContent = '[data-visual-block][contenteditable="true"] { outline: 2px solid transparent; } [data-visual-block][contenteditable="true"]:focus { outline-color: #2563eb; outline-offset: 2px; } figure[data-image-editable] { cursor: pointer; outline: 2px solid transparent; outline-offset: 2px; } figure[data-image-editable]:hover, figure[data-image-editable]:focus { outline-color: #2563eb; }';
  document.head.append(style);
  const imageRange = figure => {
    const block = blockByIdentifier.get(figure.closest('[data-visual-block]')?.dataset.visualBlock);
    if (!block) return null;
    const figures = [block.element, ...block.element.querySelectorAll('figure')].filter(element => element.matches('figure'));
    return figureRanges(source.value).filter(range => range.start >= block.start && range.start < block.end)[figures.indexOf(figure)] || null;
  };
  document.querySelectorAll('.content figure').forEach(figure => {
    figure.contentEditable = 'false';
    figure.dataset.imageEditable = 'true';
    if (!figure.hasAttribute('tabindex')) { figure.tabIndex = 0; figure.dataset.editorTabindex = 'true'; }
  });
  document.addEventListener('focusin', event => {
    const block = blockByIdentifier.get(event.target.closest?.('[data-visual-block]')?.dataset.visualBlock);
    if (block) { visualSelection = block; updateComponentTools(); }
  });
  document.addEventListener('click', event => {
    const block = blockByIdentifier.get(event.target.closest?.('[data-visual-block]')?.dataset.visualBlock);
    if (block) { visualSelection = block; updateComponentTools(); }
    const figure = event.target.closest?.('figure[data-image-editable]');
    if (!figure) return;
    event.preventDefault();
    const range = imageRange(figure);
    if (range) openImageDialog(range);
    else message.textContent = 'This image could not be located. Switch to Source to edit it.';
  });
  document.addEventListener('beforeinput', historyInput);
  document.body.addEventListener('input', event => {
    const element = event.target.nodeType === Node.ELEMENT_NODE ? event.target : event.target.parentElement;
    const blockElement = element?.closest('[data-visual-block]');
    const block = blockByIdentifier.get(blockElement?.dataset.visualBlock);
    if (!block) {
      message.textContent = 'This Visual edit could not be mapped safely. Switch to Source to make this change.';
      renderVisual();
      return;
    }
    const replacement = authoredHtml(block.element);
    source.value = source.value.slice(0, block.start) + replacement + source.value.slice(block.end);
    const difference = replacement.length - (block.end - block.start);
    block.end = block.start + replacement.length;
    for (const following of blocks) {
      if (following !== block && following.start > block.start) {
        following.start += difference;
        following.end += difference;
      }
    }
    updateStatusControl(); renderSoon(event);
  });
  document.addEventListener('keydown', event => {
    if (historyShortcut(event)) return;
    const figure = event.target.closest?.('figure[data-image-editable]');
    if (figure && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      const range = imageRange(figure);
      if (range) openImageDialog(range);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });
  if (pendingVisualFocus !== undefined) {
    const figure = [...document.querySelectorAll('.content figure')].find(element => imageRange(element)?.start === pendingVisualFocus);
    pendingVisualFocus = undefined;
    figure?.focus({ preventScroll: true });
    figure?.scrollIntoView({ block: 'center' });
  }
}
function showEditorMode(mode) {
  editorMode = mode; history.lastTyped = 0; updateComponentTools();
  const isVisual = mode === 'visual';
  visual.hidden = !isVisual; source.hidden = isVisual; visualHelp.hidden = !isVisual;
  visualMode.classList.toggle('active', isVisual); sourceMode.classList.toggle('active', !isVisual);
  visualMode.setAttribute('aria-pressed', String(isVisual)); sourceMode.setAttribute('aria-pressed', String(!isVisual));
  editorLabel.textContent = isVisual ? 'Visual editor' : 'Markdown / HTML source';
  cursorStatus.hidden = isVisual;
  if (isVisual) renderVisual();
  else { invalidateVisualRender(); source.focus(); }
}
function invalidateVisualRender() {
  visualSelection = undefined; updateComponentTools();
  visualRenderSequence += 1;
  visualRenderController?.abort();
  visualRenderController = undefined;
}
async function renderVisual() {
  const sequence = ++visualRenderSequence;
  const snapshot = bufferSnapshot();
  visualRenderController?.abort();
  const controller = new AbortController();
  visualRenderController = controller;
  try {
    const html = await request('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot), signal: controller.signal });
    if (sequence !== visualRenderSequence || editorMode !== 'visual' || !isCurrentBuffer(snapshot)) return;
    const scrollY = visual.contentWindow?.scrollY || 0;
    visual.addEventListener('load', () => {
      visual.contentWindow.scrollTo(0, scrollY);
      attachVisualEditor();
    }, { once: true });
    visual.srcdoc = html;
  } catch (error) {
    if (error.name !== 'AbortError' && sequence === visualRenderSequence) message.textContent = `Visual editor: ${error.message}. Switch to Source to correct the document.`;
  } finally {
    if (visualRenderController === controller) visualRenderController = undefined;
  }
}

function handoutMatchesFilters(item) {
  const query = handoutSearch.value.trim().toLocaleLowerCase();
  return (!needsFixing.checked || handoutNeedsFixing(item))
    && (!query || item.code.toLocaleLowerCase().includes(query) || item.title.toLocaleLowerCase().includes(query));
}
function populateHandouts(preferredPath = select.value) {
  const visible = handouts.filter(handoutMatchesFilters);
  const groups = new Map();
  for (const item of visible) {
    const section = item.path.split('/').slice(1, -1).join(' / ') || 'Unsectioned';
    const status = item.status === 'approved' ? 'Release' : item.status.replace('-', ' ');
    const label = `${section} · ${status}`;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  select.replaceChildren(...[...groups].map(([label, items]) => {
    const group = document.createElement('optgroup'); group.label = label;
    group.append(...items.map(item => new Option(handoutOptionLabel(item), item.path)));
    return group;
  }));
  if (visible.some(item => item.path === preferredPath)) select.value = preferredPath;
  else select.selectedIndex = -1;
  handoutResults.textContent = visible.length ? `${visible.length} handout${visible.length === 1 ? '' : 's'} found` : 'No handouts match your search.';
}
function updateHandout(path, changes) {
  const item = handouts.find(candidate => candidate.path === path);
  if (!item) return;
  const wasVisible = handoutMatchesFilters(item);
  Object.assign(item, changes);
  const option = [...select.options].find(candidate => candidate.value === path);
  const onlyIndicatorChanged = Object.keys(changes).every(key => ['formatting', 'issueCount'].includes(key));
  const isVisible = handoutMatchesFilters(item);
  if (onlyIndicatorChanged && wasVisible === isVisible) {
    // Keep the native control and its selection intact when the filters still
    // admit the same items. An off-screen result needs no DOM update at all.
    if (option) option.textContent = handoutOptionLabel(item);
    return;
  }
  populateHandouts(opened.path || path);
}

async function scanHandouts() {
  const generation = ++scanGeneration;
  const scanning = handouts.filter(item => !item.missing);
  let completed = 0;
  scanState.textContent = `Scanning handouts… 0/${scanning.length}`;
  for (const item of scanning) {
    if (generation !== scanGeneration) return;
    updateHandout(item.path, { formatting: 'checking' });
    try {
      const result = await request('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: item.path }) });
      if (generation !== scanGeneration) return;
      if (item.path !== opened.path || !dirty()) updateHandout(item.path, { formatting: result.formatting, issueCount: result.issueCount });
    } catch {
      if (generation !== scanGeneration) return;
      if (item.path !== opened.path || !dirty()) updateHandout(item.path, { formatting: 'unavailable' });
    }
    completed += 1;
    scanState.textContent = `Scanning handouts… ${completed}/${scanning.length}`;
  }
  const errors = handouts.filter(item => item.formatting === 'error').length;
  const unavailable = handouts.filter(item => item.formatting === 'unavailable').length;
  scanState.textContent = unavailable
    ? `Scan complete · ${errors} with errors · ${unavailable} unavailable`
    : `Scan complete · ${errors} with errors`;
}

const draftKey = path => `handout-editor:draft:${path}`;
function readDraft(path) {
  if (opened.private) return null;
  try { return JSON.parse(localStorage.getItem(draftKey(path))); } catch { return null; }
}
function writeDraft() {
  if (opened.private || !opened.path || !dirty()) return;
  try { localStorage.setItem(draftKey(opened.path), JSON.stringify({ source: source.value, revision: opened.revision, updatedAt: Date.now() })); } catch { /* Editing must continue if storage is unavailable. */ }
}
function clearDraft(path = opened.path) {
  try { if (!opened.private) localStorage.removeItem(draftKey(path)); } catch { /* Storage may be disabled. */ }
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
function renderSoon(event) {
  proofControls?.changed();
  history.record(source.value, event?.type === 'input');
  updateHistoryButtons();
  dirty(); writeDraft(); updateCursorStatus(); clearTimeout(previewTimer);
  previewTimer = setTimeout(render, 350);
  clearTimeout(validationTimer);
  validationState.textContent = 'Checking syntax'; validationState.className = 'checking';
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

  if (document.body.classList.contains('preview-only')) {
    if (previewElement) { message.textContent = `Navigated to ${issue.type} in the preview.`; return; }
    previewControls.showEditor();
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
  return { path: opened.path || select.value, source: source.value, session };
}
function isCurrentBuffer(snapshot) {
  return snapshot.path === (opened.path || select.value) && snapshot.source === source.value;
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
  const payload = { path: opened.path || select.value, source: source.value, session, requestId: sequence };
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
    validationState.textContent = layout.issues.length ? `${layout.issues.length} issue${layout.issues.length === 1 ? '' : 's'}` : 'No issues';
    updateHandout(payload.path, { formatting: layout.valid ? 'valid' : 'error' });
    validationState.className = '';
  } catch (error) {
    if (sequence === validationSequence && !/superseded/i.test(error.message)) { validationState.textContent = `Validation unavailable: ${error.message}`; validationState.className = ''; }
  }
}
async function render() {
  const sequence = ++renderSequence;
  const snapshot = bufferSnapshot();
  renderController?.abort();
  renderController = new AbortController();
  try {
    const html = await request('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot), signal: renderController.signal });
    if (sequence !== renderSequence || !isCurrentBuffer(snapshot)) return;
    previewControls.render(html, snapshot.path);
    message.textContent = '';
  } catch (error) { if (error.name !== 'AbortError' && sequence === renderSequence) message.textContent = `Preview: ${error.message}`; }
}
async function openHandout({ discardCurrentDraft = false } = {}) {
  const previousPath = opened.path;
  const hasPendingAssets = opened.assets?.some(asset => asset.pending);
  if ((dirty() || hasPendingAssets) && !confirm('Discard unsaved changes and pending assets?')) { select.value = opened.path; return; }
  invalidateVisualRender();
  try {
    if (previousPath && (discardCurrentDraft || select.value !== previousPath)) {
      await discardAssets(previousPath);
      if (discardCurrentDraft) clearDraft(previousPath);
    }
    opened = await request(`/api/handout?path=${encodeURIComponent(select.value)}&session=${encodeURIComponent(session)}`);
    document.querySelector('#source-library').textContent = opened.private
      ? 'Private library · Saves to private repository · Browser draft recovery off'
      : 'Public library';
    imageContext = undefined; pendingVisualFocus = undefined;
    source.value = opened.source; history.reset(opened.source); selectedAsset = ''; showAssets(); updateStatusControl(); dirty();
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
      const status = readHandoutStatus(snapshot.source);
      if (status === 'approved') {
        message.textContent = 'Not saved: Approved handouts must pass validation. Change the status to Draft or Under review, or complete the approval requirements.';
        return false;
      }
      if (!['draft', 'under-review'].includes(status)) {
        message.textContent = 'Not saved: Fix the status metadata and the remaining validation errors before saving.';
        return false;
      }
      if (!confirm(`Syntax or metadata errors remain. Save this incomplete ${status === 'draft' ? 'draft' : 'under-review handout'} anyway?`)) {
        message.textContent = 'Save canceled. Review the Validation panel.';
        return false;
      }
    }
    const result = await request('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...snapshot, revision: opened.revision }) });
    opened = { ...opened, ...snapshot, revision: result.revision, assets: opened.assets.map(asset => ({ ...asset, pending: false })) }; showAssets(); updateHandout(snapshot.path, { status: result.status }); clearDraft(); dirty(); message.textContent = 'Saved.'; return true;
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
    width: document.querySelector('#image-width').value === 'custom' ? Number(document.querySelector('#image-size').value) : document.querySelector('#image-width').value,
    align: document.querySelector('#image-align').value,
    crop: document.querySelector('#image-crop').value,
    position: `${document.querySelector('#image-x').value}% ${document.querySelector('#image-y').value}%`
  };
}
function selectedFigure() {
  return figureAtOffset(source.value, source.selectionStart);
}
function parseFigure(markup) {
  return new DOMParser().parseFromString(markup, 'text/html').querySelector('figure');
}
function assetUrl(file) {
  return `/assets/handouts/${encodeURIComponent(opened.code)}/${encodeURIComponent(file)}?session=${encodeURIComponent(session)}&path=${encodeURIComponent(opened.path)}`;
}
function imageError(error = '') {
  const output = document.querySelector('#image-error');
  output.textContent = error; output.hidden = !error;
}
function clearUploadPreview() {
  if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
  uploadPreviewUrl = undefined;
}
function refreshImageControls() {
  const target = imageContext?.figure;
  const upload = document.querySelector('#image-file').files[0];
  document.querySelector('#image-upload-details').hidden = !upload;
  imageDialog.querySelector('fieldset').disabled = imageBusy;
  document.querySelector('#image-file').disabled = imageBusy;
  document.querySelector('#apply-image').textContent = target ? (selectedAsset === target.file ? 'Apply changes' : 'Replace image') : 'Insert image';
  document.querySelector('#apply-image').disabled = imageBusy || !selectedAsset || Boolean(upload);
  document.querySelector('#upload-image').textContent = target ? 'Upload and replace' : 'Upload and insert';
  document.querySelector('#upload-image').disabled = imageBusy;
  document.querySelector('#remove-image').hidden = !target;
  document.querySelector('#remove-image').disabled = imageBusy;
  document.querySelector('#insert-another-image').hidden = !target;
  document.querySelector('#insert-another-image').disabled = imageBusy;
  const selected = opened.assets?.find(asset => asset.file === selectedAsset);
  document.querySelector('#delete-image').disabled = imageBusy || !selected || selected.pending;
  document.querySelector('#cancel-assets').disabled = imageBusy;
  const size = Number(document.querySelector('#image-size').value);
  document.querySelector('#image-size-value').textContent = `${size}%`;
  document.querySelector('#image-align').disabled = size === 100;
  const cropped = ['3x2', '4x3', 'square'].includes(document.querySelector('#image-crop').value);
  document.querySelector('#image-x').disabled = !cropped;
  document.querySelector('#image-y').disabled = !cropped;
  const figure = document.querySelector('#image-placement-preview');
  const image = document.querySelector('#image-preview');
  figure.hidden = !selected && !uploadPreviewUrl;
  document.querySelector('#image-preview-empty').hidden = !figure.hidden;
  if (!figure.hidden) {
    image.src = uploadPreviewUrl || assetUrl(selected.file);
    image.alt = upload ? document.querySelector('#image-alt').value : selected.alt;
    const authoredCaption = target?.file === selectedAsset ? parseFigure(target.text)?.querySelector('figcaption')?.textContent : undefined;
    document.querySelector('#image-preview-caption').textContent = upload ? document.querySelector('#image-caption').value : authoredCaption ?? selected.caption ?? '';
  }
  figure.style.width = `${size}%`;
  figure.style.marginLeft = size < 100 && document.querySelector('#image-align').value === 'right' ? 'auto' : '0';
  image.style.aspectRatio = ({ '3x2': '3 / 2', '4x3': '4 / 3', square: '1' })[document.querySelector('#image-crop').value] || 'auto';
  image.style.objectFit = cropped ? 'cover' : 'contain';
  image.style.objectPosition = imageOptions().position;
}
function loadImageOptions(range) {
  const figure = range && parseFigure(range.text);
  const width = figure?.style.width.match(/^(\d+(?:\.\d+)?)%$/)?.[1];
  const size = width ? Math.max(10, Math.min(100, Number(width))) : figure?.classList.contains('figure--half') ? 50 : 100;
  document.querySelector('#image-width').value = width ? 'custom' : size === 50 ? 'half' : 'full';
  document.querySelector('#image-size').value = size;
  document.querySelector('#image-align').value = figure?.classList.contains('figure--right') ? 'right' : 'left';
  document.querySelector('#image-crop').value = ['3x2', '4x3', 'square'].find(crop => figure?.classList.contains(`figure--crop-${crop}`)) || (figure?.classList.contains('figure--contain') ? 'contain' : '');
  const position = figure?.style.getPropertyValue('--crop-position').match(/(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
  document.querySelector('#image-x').value = position?.[1] || 50;
  document.querySelector('#image-y').value = position?.[2] || 50;
}
function openImageDialog(figure = null, anchor) {
  if (!opened.path || imageBusy) return;
  clearUploadPreview();
  document.querySelector('#image-form').reset();
  document.querySelector('#image-alt').disabled = false;
  document.querySelector('#image-alt').required = true;
  const block = anchor || (editorMode === 'visual' && visualSelection);
  imageContext = {
    snapshot: bufferSnapshot(), figure,
    anchor: block ? { start: block.start, end: block.end } : null,
    insertion: editorMode === 'source' && !anchor ? { start: source.selectionStart, end: source.selectionEnd } : null
  };
  selectedAsset = figure?.file || '';
  loadImageOptions(figure);
  const position = document.querySelector('#image-insert-position');
  position.value = block ? 'after' : 'end';
  position.querySelector('[value="before"]').disabled = !block;
  position.querySelector('[value="after"]').disabled = !block;
  document.querySelector('#image-insert-location').hidden = Boolean(figure) || (editorMode === 'source' && !anchor);
  document.querySelector('#image-dialog-title').textContent = figure ? 'Edit image' : 'Insert image';
  document.querySelector('#image-context').textContent = figure ? `Editing ${figure.file || 'this image'}. Choose another image to replace it, or adjust its size below.` : editorMode === 'source' ? 'The image will be inserted at the source cursor.' : block ? 'Insert beside the paragraph or section you selected.' : 'The image will be added at the end of the handout. Select a paragraph first to insert beside it.';
  imageError(); showAssets(); refreshImageControls();
  if (!imageDialog.open) imageDialog.showModal();
}
function showAssets() {
  document.querySelector('#asset-empty').hidden = Boolean(opened.assets?.length);
  assetList.replaceChildren(...(opened.assets || []).map(asset => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `asset${selectedAsset === asset.file ? ' selected' : ''}${asset.pending ? ' pending' : ''}`;
    button.setAttribute('aria-pressed', String(selectedAsset === asset.file));
    const image = document.createElement('img');
    image.src = assetUrl(asset.file); image.alt = '';
    button.append(image, document.createTextNode(asset.file));
    if (asset.pending) { const badge = document.createElement('span'); badge.className = 'pending-label'; badge.textContent = 'Pending save'; button.append(badge); }
    button.addEventListener('click', () => {
      if (imageBusy) return;
      selectedAsset = asset.file;
      document.querySelector('#image-file').value = ''; clearUploadPreview();
      imageError(); showAssets(); refreshImageControls();
    });
    return button;
  }));
}
async function figureMarkup(file, options) {
  return request('/api/figure', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: opened.path, session, file, options }) });
}
async function discardAssets(handoutPath = opened.path) {
  if (!handoutPath) return;
  await request('/api/assets/discard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: handoutPath, session }) });
}
function requireImageContext(context) {
  if (!context || imageContext !== context || !isCurrentBuffer(context.snapshot)) throw Error('The handout changed. Close this panel and select the image again.');
}
function resizeFigure(range, options) {
  const figure = parseFigure(range.text);
  const previousSize = Number.parseFloat(figure.style.width) || (figure.classList.contains('figure--half') ? 50 : 100);
  const nextSize = options.width === 'half' ? 50 : options.width === 'full' ? 100 : options.width;
  // Preserve captions, credits, accessibility relationships, and custom classes.
  [...figure.classList].filter(name => /^figure--(?:full|half|left|right|crop-3x2|crop-4x3|crop-square|contain)$/.test(name)).forEach(name => figure.classList.remove(name));
  figure.classList.add('figure', options.width === 'half' ? 'figure--half' : 'figure--full');
  figure.style.removeProperty('width');
  if (typeof options.width === 'number') figure.style.width = `${options.width}%`;
  if (options.width !== 'full' && options.width !== 100) figure.classList.add(`figure--${options.align}`);
  if (options.crop) figure.classList.add(options.crop === 'contain' ? 'figure--contain' : `figure--crop-${options.crop}`);
  figure.style.setProperty('--crop-position', options.position);
  const opening = figure.outerHTML.match(/^<figure\b[^>]*>/)[0];
  let original = range.text.slice(0, range.figureEnd - range.start);
  if (previousSize !== nextSize) {
    // Authored diagrams often have a fixed print height. Let height follow the
    // image proportions when the user explicitly changes its size.
    const image = figure.querySelector('img');
    image.style.height = 'auto';
    original = original.replace(/<img\b[^>]*>/i, image.outerHTML);
  }
  const clear = options.width !== 'full' && options.width !== 100 ? '\n<div class="figure-clear"></div>' : '';
  return original.replace(/^<figure\b[^>]*>/i, opening) + clear;
}
function replaceFigureMarkup(range, markup, options, asset) {
  if (!range) return markup;
  const resized = parseFigure(resizeFigure(range, options));
  const replacement = parseFigure(markup);
  const placementClasses = /^figure--(?:full|half|left|right|crop-3x2|crop-4x3|crop-square|contain|diagram)$/;
  for (const name of resized.classList) if (!placementClasses.test(name)) replacement.classList.add(name);
  replacement.classList.toggle('figure--diagram', asset.type === 'diagram');
  for (const property of resized.style) {
    if (!['width', '--crop-position'].includes(property)) replacement.style.setProperty(property, resized.style.getPropertyValue(property), resized.style.getPropertyPriority(property));
  }
  const imageStyle = resized.querySelector('img').getAttribute('style');
  if (imageStyle) replacement.querySelector('img').setAttribute('style', imageStyle);
  return replacement.outerHTML + (markup.includes('figure-clear') ? '\n<div class="figure-clear"></div>' : '');
}
function uniqueFigureCaption(markup, range) {
  const figure = parseFigure(markup);
  const caption = figure.querySelector('figcaption[id]');
  if (!caption) return markup;
  const remainder = range ? source.value.slice(0, range.start) + source.value.slice(range.end) : source.value;
  const existing = new DOMParser().parseFromString(remainder, 'text/html');
  const base = caption.id;
  let identifier = base;
  for (let suffix = 2; existing.getElementById(identifier); suffix += 1) identifier = `${base}-${suffix}`;
  if (identifier === base) return markup;
  caption.id = identifier;
  figure.setAttribute('aria-labelledby', identifier);
  return figure.outerHTML + (markup.includes('figure-clear') ? '\n<div class="figure-clear"></div>' : '');
}
function applyImageMarkup(markup, context) {
  requireImageContext(context);
  const range = context.figure;
  let start; let end;
  if (range) { start = range.start; end = range.end; }
  else if (context.insertion) { ({ start, end } = context.insertion); }
  else {
    const position = document.querySelector('#image-insert-position').value;
    start = end = position === 'end' ? source.value.length : context.anchor[position === 'before' ? 'start' : 'end'];
  }
  markup = uniqueFigureCaption(markup, range);
  const replacement = range ? markup : `\n\n${markup}\n\n`;
  source.setRangeText(replacement, start, end, 'end');
  pendingVisualFocus = start + (range ? 0 : 2);
  renderSoon(); imageDialog.close();
  if (editorMode === 'visual') renderVisual();
  else source.focus();
}
document.querySelector('#images').addEventListener('click', () => openImageDialog(editorMode === 'source' ? selectedFigure() : null));
document.querySelector('#insert-another-image').addEventListener('click', () => {
  const target = imageContext?.figure;
  if (target) openImageDialog(null, target);
});
document.querySelector('#image-width').addEventListener('change', event => {
  if (event.target.value !== 'custom') document.querySelector('#image-size').value = event.target.value === 'half' ? 50 : 100;
  refreshImageControls();
});
document.querySelector('#image-size').addEventListener('input', () => {
  document.querySelector('#image-width').value = 'custom'; refreshImageControls();
});
for (const id of ['image-align', 'image-crop', 'image-x', 'image-y', 'image-alt', 'image-caption']) document.querySelector(`#${id}`).addEventListener('input', refreshImageControls);
document.querySelector('#image-file').addEventListener('change', () => {
  clearUploadPreview(); imageError();
  const file = document.querySelector('#image-file').files[0];
  if (file && !['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) {
    document.querySelector('#image-file').value = ''; imageError('Choose a PNG, JPEG, or SVG image.');
  } else if (file) {
    uploadPreviewUrl = URL.createObjectURL(file);
    document.querySelector('#image-type').value = file.type === 'image/svg+xml' ? 'diagram' : 'photograph';
  }
  refreshImageControls();
});
const dropZone = document.querySelector('#image-drop-zone');
dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', event => {
  event.preventDefault(); dropZone.classList.remove('dragover');
  if (imageBusy || !event.dataTransfer.files.length) return;
  const transfer = new DataTransfer(); transfer.items.add(event.dataTransfer.files[0]);
  document.querySelector('#image-file').files = transfer.files;
  document.querySelector('#image-file').dispatchEvent(new Event('change'));
});
document.querySelector('#image-form').addEventListener('submit', async event => {
  event.preventDefault();
  const file = document.querySelector('#image-file').files[0];
  if (!file || imageBusy) return;
  const context = imageContext;
  const options = imageOptions();
  const decorative = document.querySelector('#image-decorative').checked;
  const payload = {
    path: opened.path, session, name: file.name, mimeType: file.type,
    type: document.querySelector('#image-type').value, alt: decorative ? '' : document.querySelector('#image-alt').value,
    decorative, caption: document.querySelector('#image-caption').value, creator: document.querySelector('#image-creator').value,
    source: document.querySelector('#image-source').value, license: document.querySelector('#image-license').value, options
  };
  imageBusy = true; refreshImageControls(); imageError();
  try {
    requireImageContext(context);
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const result = await request('/api/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, dataUrl }) });
    opened.assets.push(result.asset); selectedAsset = result.asset.file; showAssets();
    applyImageMarkup(replaceFigureMarkup(context.figure, result.markup, options, result.asset), context);
  } catch (error) { imageError(`Image not added: ${error.message}`); }
  finally { imageBusy = false; refreshImageControls(); }
});
document.querySelector('#image-decorative').addEventListener('change', event => {
  const alt = document.querySelector('#image-alt'); alt.disabled = event.target.checked; alt.required = !event.target.checked;
});
document.querySelector('#apply-image').addEventListener('click', async () => {
  if (!selectedAsset || imageBusy) return;
  const context = imageContext; const file = selectedAsset; const options = imageOptions();
  imageBusy = true; refreshImageControls(); imageError();
  try {
    requireImageContext(context);
    const markup = context.figure?.file === file ? resizeFigure(context.figure, options) : replaceFigureMarkup(context.figure, (await figureMarkup(file, options)).markup, options, opened.assets.find(asset => asset.file === file));
    applyImageMarkup(markup, context);
  } catch (error) { imageError(error.message); }
  finally { imageBusy = false; refreshImageControls(); }
});
document.querySelector('#remove-image').addEventListener('click', () => {
  const context = imageContext;
  try {
    requireImageContext(context);
    if (!context.figure || imageBusy) return;
    source.setRangeText('', context.figure.start, context.figure.end, 'start');
    renderSoon(); imageDialog.close();
    if (editorMode === 'visual') renderVisual(); else source.focus();
  } catch (error) { imageError(error.message); }
});
document.querySelector('#delete-image').addEventListener('click', async () => {
  if (!selectedAsset || imageBusy || !confirm(`Permanently delete ${selectedAsset}?`)) return;
  // Permanent deletion never silently removes an authored occurrence.
  if (source.value.includes(`../assets/handouts/${opened.code}/${selectedAsset}`)) return imageError('Remove every use of this image from the page before deleting its asset.');
  if (dirty() && !await save()) return imageError('Save the handout before deleting this asset.');
  try {
    await request('/api/assets', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: opened.path, file: selectedAsset }) });
    history.reset(source.value); updateHistoryButtons();
    opened.assets = opened.assets.filter(asset => asset.file !== selectedAsset); selectedAsset = ''; showAssets(); refreshImageControls();
    imageContext.snapshot = bufferSnapshot();
  } catch (error) { imageError(`Asset not deleted: ${error.message}`); }
});
imageDialog.addEventListener('cancel', event => { if (imageBusy) event.preventDefault(); });
imageDialog.querySelector('.dialog-heading').addEventListener('submit', event => { if (imageBusy) event.preventDefault(); });
imageDialog.addEventListener('close', clearUploadPreview);
document.querySelector('#toolbar').addEventListener('click', event => {
  if (!event.target.matches('button[data-wrap], button[data-before], button[data-insert], button[data-block]')) return;
  if (editorMode === 'visual') {
    const commands = { '**|**': 'bold', '*|*': 'italic', '- ': 'insertUnorderedList', '## ': 'formatBlock' };
    const key = event.target.dataset.wrap || event.target.dataset.before;
    if (commands[key]) {
      history.lastTyped = 0;
      visual.contentDocument.execCommand(commands[key], false, key === '## ' ? 'h2' : null);
      visualSelection?.element.dispatchEvent(new Event('input', { bubbles: true }));
      visual.contentWindow.focus(); return;
    }
    insertVisualComponent(event.target); return;
  }
  insert(event.target);
});
visualMode.addEventListener('click', () => showEditorMode('visual'));
sourceMode.addEventListener('click', () => showEditorMode('source'));
document.querySelector('#save').addEventListener('click', save);
document.querySelector('#revert').addEventListener('click', () => openHandout({ discardCurrentDraft: true }));
select.addEventListener('change', openHandout); source.addEventListener('input', renderSoon);
handoutSearch.addEventListener('input', () => populateHandouts(opened.path));
handoutSearch.addEventListener('keydown', async event => {
  if (event.key === 'Escape') {
    event.preventDefault(); handoutSearch.value = ''; populateHandouts(opened.path); return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) || !select.options.length) return;
  event.preventDefault();
  if (event.key === 'Enter') {
    if (select.value && select.value !== opened.path) await openHandout();
    else select.focus();
    return;
  }
  const paths = [...select.options].map(option => option.value);
  const current = paths.indexOf(select.value);
  const next = event.key === 'ArrowDown'
    ? (current + 1 + paths.length) % paths.length
    : (current <= 0 ? paths.length - 1 : current - 1);
  select.value = paths[next];
});
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
  populateHandouts(opened.path || previous);
  if (!select.options.length) message.textContent = 'No handouts currently match the filters.';
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
document.querySelector('#discard-draft').addEventListener('click', async () => {
  const pendingFiles = opened.assets.filter(asset => asset.pending).map(asset => asset.file);
  try {
    await discardAssets();
    for (const range of figureRanges(source.value).reverse()) {
      if (pendingFiles.includes(range.file)) source.value = source.value.slice(0, range.start) + source.value.slice(range.end);
    }
    if (pendingFiles.length) history.reset(source.value);
    opened.assets = opened.assets.filter(asset => !asset.pending); showAssets();
    renderSoon(); clearDraft();
    if (editorMode === 'visual' && pendingFiles.length) renderVisual();
    message.textContent = 'Browser draft and pending assets discarded.';
  } catch (error) { message.textContent = `Draft not discarded: ${error.message}`; }
});
document.querySelector('#cancel-assets').addEventListener('click', async () => {
  if (imageBusy) return;
  if (!opened.assets.some(asset => asset.pending) || confirm('Discard all pending asset uploads?')) {
    const pendingFiles = opened.assets.filter(asset => asset.pending).map(asset => asset.file);
    try {
      await discardAssets();
      for (const range of figureRanges(source.value).reverse()) {
        if (pendingFiles.includes(range.file)) source.value = source.value.slice(0, range.start) + source.value.slice(range.end);
      }
      opened.assets = opened.assets.filter(asset => !asset.pending); selectedAsset = ''; history.reset(source.value); showAssets(); renderSoon(); imageDialog.close();
      if (editorMode === 'visual') renderVisual();
      message.textContent = 'Pending assets discarded.';
    } catch (error) {
      imageError(`Pending uploads not discarded: ${error.message}`);
    }
  }
});
document.addEventListener('keydown', event => { if (historyShortcut(event)) return; if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } });
window.addEventListener('beforeunload', event => { if (dirty() || opened.assets?.some(asset => asset.pending)) event.preventDefault(); });


function updateHistoryButtons() {
  document.querySelector('#undo').disabled = !history.canUndo;
  document.querySelector('#redo').disabled = !history.canRedo;
}
function restoreHistory(redo = false) {
  if (document.querySelector('dialog[open]') || !(redo ? history.canRedo : history.canUndo)) return;
  source.value = redo ? history.redo() : history.undo();
  updateStatusControl(); renderSoon();
  if (editorMode === 'visual') renderVisual(); else source.focus();
}
function historyShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || !['z', 'y'].includes(event.key.toLowerCase())) return false;
  if (document.querySelector('dialog[open]') || (event.target !== source && event.currentTarget === document && event.target.matches?.('input, textarea'))) return false;
  event.preventDefault();
  restoreHistory(event.key.toLowerCase() === 'y' || event.shiftKey);
  return true;
}
document.querySelector('#undo').addEventListener('click', () => restoreHistory());
document.querySelector('#redo').addEventListener('click', () => restoreHistory(true));
// Retain the canvas selection while a toolbar button receives the click.
document.querySelector('#toolbar').addEventListener('mousedown', event => {
  if (editorMode === 'visual' && event.target.matches('button[data-wrap], button[data-before]')) event.preventDefault();
});
function insertVisualComponent(button) {
  const anchor = visualSelection;
  const at = anchor?.end ?? source.value.length;
  let markup;
  const kind = button.dataset.block;
  if (kind === 'procedure') markup = '<ol class="procedure"><li>Step</li></ol>';
  else if (kind === 'checklist') markup = '<div class="checklist"><ul><li>Item</li></ul></div>';
  else if (kind === 'grid') markup = '<div class="grid"><div><p>Left column</p></div><div><p>Right column</p></div></div>';
  else if (kind) markup = `<div class="${kind}"><p>Content</p></div>`;
  else if (button.dataset.insert?.includes('pagebreak')) markup = '<!-- pagebreak -->';
  else markup = '<table><thead><tr><th>Heading</th><th>Heading</th></tr></thead><tbody><tr><td>Value</td><td>Value</td></tr></tbody></table>';
  source.setRangeText(`\n\n${markup}\n\n`, at, at, 'end');
  if (markup.includes('<!-- pagebreak -->') && /^pageCount:/m.test(source.value.split(/^---\s*$/m)[1] || '')) {
    source.value = updateMetadataFields(source.value, { pageCount: (source.value.match(/^<!--\s*pagebreak\s*-->\s*$/gm) || []).length + 1 });
  }
  renderSoon(); renderVisual();
  message.textContent = anchor ? 'Inserted after the selected section. Click the new component to edit it.' : 'Inserted at the end. Click the new component to edit it.';
}

const detailsDialog = document.querySelector('#details-dialog');
const detailsForm = document.querySelector('#details-form');
const detailsError = document.querySelector('#details-error');
let detailsSnapshot;
let detailsMetadata;
const sourceFields = {
  web: ['title', 'organization', 'url', 'accessDate', 'publicationDate', 'updateDate'],
  'non-web': ['title', 'organization', 'citation', 'publicationDate', 'updateDate'],
  interview: ['title', 'interviewee', 'role', 'interviewDate'],
  local: ['title', 'provider', 'location', 'receivedDate']
};
const fieldLabels = { accessDate: 'Access date', publicationDate: 'Publication date', updateDate: 'Update date', interviewDate: 'Interview date', receivedDate: 'Received date', url: 'URL' };
function addSourceRow(entry = { type: 'web' }) {
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend'); legend.textContent = 'Source'; fieldset.append(legend);
  const typeLabel = document.createElement('label'); typeLabel.textContent = 'Source type';
  const type = document.createElement('select'); type.name = 'type';
  for (const value of Object.keys(sourceFields)) type.add(new Option(value, value));
  type.value = entry.type; typeLabel.append(type); fieldset.append(typeLabel);
  const fields = document.createElement('div'); fields.className = 'source-fields'; fieldset.append(fields);
  // Keep unfamiliar fields on existing records, including when switching type.
  fieldset.sourceEntry = { ...entry };
  const draw = () => {
    fields.querySelectorAll('input').forEach(input => { fieldset.sourceEntry[input.name] = input.value; });
    fields.replaceChildren();
    for (const name of sourceFields[type.value] || []) {
      const label = document.createElement('label'); label.textContent = fieldLabels[name] || name[0].toUpperCase() + name.slice(1);
      const input = document.createElement('input'); input.name = name; input.value = fieldset.sourceEntry[name] ?? '';
      input.type = /Date$/.test(name) ? 'date' : name === 'url' ? 'url' : 'text';
      input.required = name === 'title'; label.append(input); fields.append(label);
    }
  };
  type.addEventListener('change', draw); draw();
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove source'; remove.addEventListener('click', () => fieldset.remove()); fieldset.append(remove);
  document.querySelector('#details-sources').append(fieldset);
}
document.querySelector('#add-source').addEventListener('click', () => addSourceRow());
document.querySelector('#details').addEventListener('click', async () => {
  const snapshot = bufferSnapshot();
  try {
    const { metadata } = await request('/api/details', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot) });
    if (!isCurrentBuffer(snapshot)) return;
    detailsSnapshot = snapshot; detailsMetadata = metadata;
    for (const name of ['title', 'version', 'lastReviewed']) detailsForm.querySelector(`.details-fields [name="${name}"]`).value = metadata[name] ?? '';
    for (const name of ['editor', 'subjectMatter']) detailsForm.querySelector(`.details-fields [name="${name}"]`).value = metadata.reviewers?.[name] ?? '';
    document.querySelector('#details-sources').replaceChildren();
    for (const entry of Array.isArray(metadata.sources) ? metadata.sources : []) addSourceRow(entry);
    detailsError.textContent = ''; document.querySelector('#approval-result').textContent = ''; detailsDialog.showModal();
  } catch (error) { message.textContent = `Handout details: ${error.message}`; }
});
function collectDetails() {
  const sources = [...document.querySelectorAll('#details-sources fieldset')].map(row => {
    const entry = { ...row.sourceEntry, type: row.querySelector('select').value };
    row.querySelectorAll('input').forEach(input => { if (input.value) entry[input.name] = input.value; else delete entry[input.name]; });
    return entry;
  });
  if (!sources.length) throw Error('Add at least one source.');
  const fields = { reviewers: { ...detailsMetadata.reviewers }, sources };
  for (const name of ['title', 'version', 'lastReviewed']) fields[name] = detailsForm.querySelector(`.details-fields [name="${name}"]`).value;
  for (const name of ['editor', 'subjectMatter']) fields.reviewers[name] = detailsForm.querySelector(`.details-fields [name="${name}"]`).value;
  return fields;
}
detailsForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!isCurrentBuffer(detailsSnapshot)) { detailsError.textContent = 'The document changed. Close and reopen details before applying.'; return; }
  try {
    source.value = updateMetadataFields(source.value, collectDetails());
    renderSoon(); if (editorMode === 'visual') renderVisual();
    detailsDialog.close(); message.textContent = 'Details applied. Review validation and Save to keep your changes.';
  } catch (error) { detailsError.textContent = error.message; }
});

function historyInput(event) {
  if (!['historyUndo', 'historyRedo'].includes(event.inputType)) return;
  event.preventDefault(); restoreHistory(event.inputType === 'historyRedo');
}
source.addEventListener('beforeinput', historyInput);


function updateComponentTools() {
  const block = editorMode === 'visual' && visualSelection?.element;
  const table = block && (block.matches('table') ? block : block.querySelector('table'));
  for (const id of ['table-row', 'table-column']) document.querySelector(`#${id}`).disabled = !table;
  document.querySelector('#remove-component').disabled = !block || !block.matches('.warning, .checklist, .procedure, .local-info, .sources, .grid, table');
}
for (const action of ['row', 'column']) document.querySelector(`#table-${action}`).addEventListener('click', () => {
  const block = visualSelection?.element;
  const table = block?.matches('table') ? block : block?.querySelector('table');
  if (!table) return;
  if (action === 'row') {
    const body = table.tBodies[0] || table.createTBody();
    const row = body.insertRow();
    const columns = Math.max(1, ...[...table.rows].map(row => row.cells.length));
    for (let i = 0; i < columns; i++) row.insertCell().textContent = 'Value';
  } else {
    for (const row of table.rows) {
      const cell = table.ownerDocument.createElement(row.parentElement.tagName === 'THEAD' ? 'th' : 'td');
      cell.textContent = cell.tagName === 'TH' ? 'Heading' : 'Value'; row.append(cell);
    }
  }
  block.dispatchEvent(new Event('input', { bubbles: true }));
});
document.querySelector('#remove-component').addEventListener('click', () => {
  if (!visualSelection || document.querySelector('#remove-component').disabled) return;
  source.setRangeText('', visualSelection.start, visualSelection.end, 'end'); renderSoon(); renderVisual();
});
document.querySelector('#check-approval').addEventListener('click', async () => {
  const output = document.querySelector('#approval-result');
  output.textContent = 'Checking approval requirements…';
  try {
    const result = await request('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...detailsSnapshot, source: setHandoutStatus(updateMetadataFields(detailsSnapshot.source, collectDetails()), 'approved'), phase: 'syntax', session: `${session}-approval` }) });
    output.textContent = result.valid ? 'These details pass source approval checks. The publishing build must also verify the proof record and layout.' : result.issues.map(issue => issue.message).join(' ');
    output.textContent += ' This check does not change the document status or save changes.';
  } catch (error) { output.textContent = error.message; }
});

document.querySelector('.tool-toggle').addEventListener('click', event => {
  const expanded = document.querySelector('.tool-overflow').toggleAttribute('open');
  event.currentTarget.setAttribute('aria-expanded', String(expanded));
});

proofControls = createProofControls({
  request, selectIssue,
  context: () => ({ ...bufferSnapshot(), private: opened.private, unsaved: source.value !== opened.source || opened.assets?.some(asset => asset.pending) })
});

createLibraryControls({
  request, message,
  context: () => ({ ...opened, session, unsaved: dirty() || opened.assets?.some(asset => asset.pending) }),
  install: async (result, createdPath) => {
    proofControls.invalidate();
    scanGeneration++;
    const previous = handouts.find(item => item.path === opened.path);
    handouts = result.handouts;
    if (!createdPath && previous && !handouts.some(item => item.path === opened.path)) handouts.push({ ...previous, title: `${previous.title} (removed from disk)`, missing: true, formatting: 'unavailable' });
    if (createdPath) { handoutSearch.value = ''; needsFixing.checked = false; previewControls.showEditor(); }
    populateHandouts(createdPath || opened.path);
    if (createdPath) { select.value = createdPath; await openHandout(); }
    scanHandouts();
  }
});

handouts = await request('/api/handouts');
populateHandouts();
if (handouts.length) {
  select.selectedIndex = 0;
  await openHandout();
  scanHandouts();
}
