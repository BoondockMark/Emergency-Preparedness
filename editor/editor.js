const select = document.querySelector('#handout');
const source = document.querySelector('#source');
const preview = document.querySelector('#preview');
const state = document.querySelector('#state');
const message = document.querySelector('#message');
let opened = { source: '', revision: '' };
let previewTimer;

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
    source.value = opened.source; dirty(); renderSoon(); source.focus();
  } catch (error) { message.textContent = error.message; }
}
async function save() {
  try {
    const result = await request('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: select.value, source: source.value, revision: opened.revision }) });
    opened = { path: select.value, source: source.value, revision: result.revision }; dirty(); message.textContent = 'Saved atomically.';
  } catch (error) { message.textContent = `Not saved: ${error.message}`; }
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
document.querySelector('#toolbar').addEventListener('click', event => { if (event.target.matches('button')) insert(event.target); });
document.querySelector('#save').addEventListener('click', save);
document.querySelector('#revert').addEventListener('click', openHandout);
select.addEventListener('change', openHandout); source.addEventListener('input', renderSoon);
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } });
window.addEventListener('beforeunload', event => { if (dirty()) event.preventDefault(); });

const handouts = await request('/api/handouts');
for (const item of handouts) select.add(new Option(`${item.code} — ${item.title}`, item.path));
if (handouts.length) openHandout();
