import { diffLines, mergeText, resolveMerge } from './change-model.js';

export function createChangeControls({ request, context, adopt, message }) {
  const dialog = document.querySelector('#changes-dialog');
  const banner = document.querySelector('#conflict-banner');
  const status = document.querySelector('#changes-status');
  const diff = document.querySelector('#changes-diff');
  const conflicts = document.querySelector('#changes-conflicts');
  const proposed = document.querySelector('#changes-proposed');
  const apply = document.querySelector('#changes-apply');
  const useDisk = document.querySelector('#changes-use-disk');
  const compare = document.querySelector('#changes-compare');
  let snapshot; let disk; let plan; let choices = {}; let generation = 0;
  const current = () => {
    const value = context();
    return snapshot && value.path === snapshot.path && value.source === snapshot.source && value.revision === snapshot.revision && value.private === snapshot.private;
  };
  function showDiff(before, after) {
    const result = diffLines(before, after);
    const visible = new Set();
    result.rows.forEach((row, index) => { if (row.type !== 'equal') for (let i = Math.max(0, index - 3); i <= Math.min(result.rows.length - 1, index + 3); i++) visible.add(i); });
    const showAll = document.querySelector('#changes-show-unchanged').checked;
    const elements = []; let gap = false;
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      if (!showAll && !visible.has(i)) { if (!gap) { const omitted = document.createElement('div'); omitted.textContent = '… unchanged lines …'; omitted.className = 'diff-gap'; elements.push(omitted); } gap = true; continue; }
      gap = false;
      const line = document.createElement('div'); line.className = `diff-line diff-${row.type}`;
      const numbers = document.createElement('span'); numbers.className = 'diff-numbers'; numbers.textContent = `${row.oldLine ?? '–'} / ${row.newLine ?? '–'}`;
      const text = document.createElement('code'); text.textContent = `${row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '} ${row.text.replace(/\r?\n$/, '')}`;
      line.append(numbers, text); elements.push(line);
    }
    const fragment = document.createDocumentFragment();
    for (const element of elements) fragment.append(element);
    diff.replaceChildren(fragment);
    const added = result.rows.filter(row => row.type === 'add').length; const removed = result.rows.filter(row => row.type === 'remove').length;
    document.querySelector('#changes-summary').textContent = `${added} added line${added === 1 ? '' : 's'} · ${removed} removed line${removed === 1 ? '' : 's'}${result.coarse ? ' · Large edits are grouped into blocks.' : ''}`;
  }
  function choicesChanged() {
    const result = resolveMerge(plan, choices);
    proposed.disabled = result.remaining > 0;
    document.querySelector('#changes-proposal').hidden = result.remaining > 0;
    if (result.source !== null) proposed.value = result.source;
    status.textContent = result.remaining ? `Choose which text to keep for ${result.remaining} overlapping change${result.remaining === 1 ? '' : 's'}.` : 'Review the proposed text, then apply it to the editor. Save is separate.';
    apply.disabled = result.remaining > 0 || !current();
  }
  function drawConflicts() {
    conflicts.replaceChildren(...plan.segments.filter(segment => segment.conflict !== undefined).map(segment => {
      const section = document.createElement('section'); section.className = 'merge-conflict';
      const heading = document.createElement('h3'); heading.textContent = `Overlapping change near original line ${segment.startLine}`; section.append(heading);
      if (!plan.unknownBase) {
        const baseline = document.createElement('details'); const label = document.createElement('summary'); label.textContent = 'Last saved text';
        const text = document.createElement('pre'); text.tabIndex = 0; text.textContent = segment.base || '(No text)'; baseline.append(label, text); section.append(baseline);
      }
      const columns = document.createElement('div'); columns.className = 'merge-columns';
      for (const [key, title] of [['yours', 'Your edits'], ['disk', 'Disk text']]) {
        const column = document.createElement('section'); const label = document.createElement('strong'); label.textContent = title;
        const text = document.createElement('pre'); text.tabIndex = 0; text.textContent = segment[key] || '(No text)';
        const button = document.createElement('button'); button.type = 'button'; button.textContent = key === 'yours' ? 'Keep yours' : 'Use disk'; button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
          choices[segment.conflict] = key;
          columns.querySelectorAll('button').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
          choicesChanged();
        });
        column.append(label, text, button); columns.append(column);
      }
      section.append(columns); return section;
    }));
    choicesChanged();
  }
  function initialize() {
    snapshot = { ...context() }; disk = undefined; plan = undefined; choices = {}; generation++;
    document.querySelector('#changes-title').textContent = 'Review changes';
    document.querySelector('#changes-show-unchanged').checked = false;
    document.querySelector('#changes-proposal').hidden = true;
    conflicts.replaceChildren(); proposed.value = ''; apply.disabled = true; useDisk.hidden = true; useDisk.disabled = false; compare.disabled = false;
    const pending = snapshot.assets?.filter(asset => asset.pending).length || 0;
    document.querySelector('#changes-assets').textContent = pending ? `${pending} pending image upload${pending === 1 ? '' : 's'} will be kept. This comparison changes text only.` : 'This compares the handout text and metadata. Image files are not modified.';
    document.querySelector('#changes-diff-label').textContent = 'Last saved text → Your edits';
    status.textContent = snapshot.baseSource === snapshot.source ? 'No text changes since the last save.' : 'Changes since the last saved version.';
    showDiff(snapshot.baseSource ?? '', snapshot.source);
    if (!dialog.open) dialog.showModal();
  }
  async function compareDisk() {
    if (!dialog.open) initialize();
    if (!current()) { status.textContent = 'The editor changed. Close and reopen this comparison to use the latest text.'; return; }
    const sequence = ++generation; compare.disabled = true; status.textContent = 'Reading the disk version…';
    try {
      const result = await request(`/api/handout?path=${encodeURIComponent(snapshot.path)}&session=${encodeURIComponent(snapshot.session)}`);
      if (sequence !== generation || !dialog.open) return;
      if (!current()) throw Error('The editor changed. Close and reopen the comparison.');
      if (Boolean(result.private) !== Boolean(snapshot.private)) throw Error('This path now belongs to a different library. Close this comparison and open the intended handout. Your editor text is preserved.');
      disk = result; plan = mergeText(snapshot.baseSource, snapshot.source, disk.source); choices = {};
      document.querySelector('#changes-title').textContent = 'Compare with disk';
      document.querySelector('#changes-diff-label').textContent = 'Disk text → Your edits';
      showDiff(disk.source, snapshot.source);
      document.querySelector('#changes-proposal').hidden = false; useDisk.hidden = false;
      drawConflicts();
      if (plan.unknownBase) status.textContent = 'This older browser draft has no saved baseline. Choose which version to start with, then edit the proposal to keep any other changes.';
    } catch (error) { if (sequence === generation) { status.textContent = error.message; compare.disabled = false; } }
  }
  async function applyText(text) {
    if (!disk || !current()) { status.textContent = 'The editor changed. Close and reopen this comparison.'; return; }
    try { await adopt(snapshot, disk, text); banner.hidden = true; dialog.close(); message.textContent = 'Comparison applied to the editor. Review validation and Save to keep the text on disk.'; }
    catch (error) { status.textContent = error.message; }
  }
  document.querySelector('#review-changes').addEventListener('click', () => { if (!context().path) return; initialize(); if (snapshot.baseSource === undefined) compareDisk(); });
  document.querySelector('#compare-disk').addEventListener('click', compareDisk);
  document.querySelector('#dismiss-conflict').addEventListener('click', () => { banner.hidden = true; });
  compare.addEventListener('click', compareDisk);
  document.querySelector('#changes-show-unchanged').addEventListener('change', () => { if (snapshot) showDiff(disk?.source ?? snapshot.baseSource ?? '', snapshot.source); });
  proposed.addEventListener('input', () => { conflicts.querySelectorAll('button').forEach(button => { button.disabled = true; }); });
  apply.addEventListener('click', () => applyText(proposed.value));
  useDisk.addEventListener('click', () => applyText(disk.source));
  dialog.addEventListener('close', () => { generation++; snapshot = undefined; disk = undefined; plan = undefined; proposed.value = ''; diff.replaceChildren(); conflicts.replaceChildren(); status.textContent = ''; document.querySelector('#changes-summary').textContent = ''; document.querySelector('#changes-assets').textContent = ''; });
  return {
    conflict() { banner.hidden = false; },
    clear() { banner.hidden = true; },
    changed() { if (dialog.open && !current()) { apply.disabled = true; useDisk.disabled = true; status.textContent = 'The editor changed. Close and reopen this comparison.'; } }
  };
}
