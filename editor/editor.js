const select = document.querySelector('#handout');
const source = document.querySelector('#source');
const preview = document.querySelector('#preview');
const state = document.querySelector('#state');
const message = document.querySelector('#message');
const issues = document.querySelector('#issues');
const validationState = document.querySelector('#validation-state');
const imageDialog = document.querySelector('#image-dialog');
const assetList = document.querySelector('#asset-list');
let opened = { source: '', revision: '' };
let selectedAsset = '';
let previewTimer;
let validationTimer;
let validationSequence = 0;
const session = crypto.randomUUID();

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
  dirty(); clearTimeout(previewTimer);
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
  if (issue.sourceLine) {
    const lines = source.value.split('\n');
    const start = lines.slice(0, issue.sourceLine - 1).reduce((length, line) => length + line.length + 1, 0);
    source.focus(); source.setSelectionRange(start, start + (lines[issue.sourceLine - 1]?.length ?? 0));
  }
  const document = preview.contentDocument;
  document?.querySelectorAll('[data-validation-outline]').forEach(element => { element.style.outline = ''; element.removeAttribute('data-validation-outline'); });
  if (document && issue.sourcePath && issue.sourceLine) {
    const element = [...document.querySelectorAll('[data-source-path][data-source-line]')].find(candidate => candidate.dataset.sourcePath === issue.sourcePath && Number(candidate.dataset.sourceLine) === issue.sourceLine);
    if (element) { element.dataset.validationOutline = 'true'; element.style.outline = '3px solid #dc2626'; element.style.outlineOffset = '2px'; element.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
}
async function validate() {
  const sequence = ++validationSequence;
  const payload = { path: select.value, source: source.value, session, requestId: sequence };
  try {
    const syntax = await request('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, phase: 'syntax' }) });
    if (sequence !== validationSequence) return;
    showIssues(syntax.issues);
    if (!syntax.valid) { validationState.textContent = 'Fix syntax / metadata'; validationState.className = ''; return; }
    validationState.textContent = 'Checking layout'; validationState.className = 'checking';
    showIssues([]);
    const layout = await request('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, phase: 'layout' }) });
    if (sequence !== validationSequence) return;
    showIssues(layout.issues);
    validationState.textContent = layout.valid ? 'No issues' : `${layout.issues.length} issue${layout.issues.length === 1 ? '' : 's'}`;
    validationState.className = '';
  } catch (error) {
    if (sequence === validationSequence && !/superseded/i.test(error.message)) { validationState.textContent = `Validation unavailable: ${error.message}`; validationState.className = ''; }
  }
}
async function render() {
  try {
    preview.srcdoc = await request('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: select.value, source: source.value }) });
    message.textContent = '';
  } catch (error) { message.textContent = `Preview: ${error.message}`; }
}
async function openHandout() {
  if (dirty() && !confirm('Discard unsaved changes?')) { select.value = opened.path; return; }
  try {
    opened = await request(`/api/handout?path=${encodeURIComponent(select.value)}`);
    source.value = opened.source; selectedAsset = ''; showAssets(); dirty(); renderSoon(); source.focus();
  } catch (error) { message.textContent = error.message; }
}
async function save() {
  try {
    const result = await request('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: select.value, source: source.value, revision: opened.revision }) });
    opened = { ...opened, path: select.value, source: source.value, revision: result.revision }; dirty(); message.textContent = 'Saved atomically.'; return true;
  } catch (error) { message.textContent = `Not saved: ${error.message}`; return false; }
}
function insert(button) {
  const start = source.selectionStart; const end = source.selectionEnd; const selected = source.value.slice(start, end);
  let replacement;
  if (button.dataset.wrap) { const [before, after] = button.dataset.wrap.split('|'); replacement = before + selected + after; }
  else if (button.dataset.before) replacement = button.dataset.before + selected;
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
document.querySelector('#toolbar').addEventListener('click', event => { if (event.target.matches('button:not(#images)')) insert(event.target); });
document.querySelector('#save').addEventListener('click', save);
document.querySelector('#revert').addEventListener('click', openHandout);
select.addEventListener('change', openHandout); source.addEventListener('input', renderSoon);
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } });
window.addEventListener('beforeunload', event => { if (dirty()) event.preventDefault(); });

const handouts = await request('/api/handouts');
for (const item of handouts) select.add(new Option(`${item.code} — ${item.title}`, item.path));
if (handouts.length) openHandout();
