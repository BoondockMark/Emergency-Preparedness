import { filterReviewRows, localReviewDate } from './review-model.js';

export function createReviewControls({ request, context, openHandout, message }) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#review-dialog'), tbody = $('#review-rows'), status = $('#review-state');
  const search = $('#review-search'), date = $('#review-date'), interval = $('#review-interval');
  let rows = [], epoch = 0, busy = false, loading = false, stop = false, fetchedAt = '';
  const options = () => ({ query: search.value, filter: $('#review-filter').value, status: $('#review-status').value, library: $('#review-library').value, section: $('#review-section').value, today: date.value || localReviewDate(), months: Number(interval.value) });
  const timestamp = value => value ? new Date(value).toLocaleString() : '';
  function controls() {
    $('#review-refresh').disabled = busy || loading; $('#review-check').disabled = busy || loading || !rows.length;
    $('#review-stop').hidden = !busy; $('#review-stop').disabled = stop;
  }
  function render() {
    const settings = options();
    const scoped = filterReviewRows(rows, { ...settings, filter: 'all' });
    const counts = { all: scoped.length, attention: 0, errors: 0, reviewers: 0, due: 0, unchecked: 0 };
    for (const row of scoped) {
      const flags = row.flags;
      counts.attention += Number(flags.attention); counts.errors += Number(flags.errors);
      counts.reviewers += Number(Boolean(flags.missing.length || flags.sameReviewers)); counts.due += Number(flags.overdue); counts.unchecked += Number(flags.unchecked);
    }
    for (const button of document.querySelectorAll('[data-review-filter]')) {
      button.querySelector('strong').textContent = counts[button.dataset.reviewFilter];
      button.setAttribute('aria-pressed', String(button.dataset.reviewFilter === settings.filter));
    }
    $('#review-unsaved').hidden = !context().unsaved;
    $('#review-snapshot').textContent = fetchedAt ? `Saved data read ${timestamp(fetchedAt)}. Review reminder: ${settings.months} calendar months after last reviewed, as of ${settings.today}.` : '';
    const visible = filterReviewRows(rows, settings);
    $('#review-count').textContent = `${visible.length} of ${rows.length} handouts shown`;
    tbody.replaceChildren(...visible.map(row => {
      const tr = document.createElement('tr'); tr.dataset.path = row.path;
      const cell = (name, text = '') => { const td = document.createElement('td'); td.dataset.label = name; td.textContent = text; tr.append(td); return td; };
      const title = cell('Handout');
      const strong = document.createElement('strong'); strong.textContent = `${row.code} — ${row.title}`;
      const detail = document.createElement('small'); detail.textContent = `${row.section} · ${row.private ? 'Private' : row.placeholder ? 'Public placeholder' : 'Public'}`;
      title.append(strong, detail);
      cell('Status', row.status || 'Invalid / missing');
      const reviewers = cell('Reviewers');
      for (const [role, label] of [['editor', 'Editor'], ['subjectMatter', 'Subject matter']]) {
        const line = document.createElement('div'); line.textContent = `${label}: ${row.metadataError || row.readError ? 'Unavailable' : row.reviewers?.[role] || 'Not recorded'}`; reviewers.append(line);
      }
      if (row.flags.sameReviewers) { const note = document.createElement('strong'); note.textContent = 'Two different reviewers required'; reviewers.append(note); }
      const dates = cell('Review date', `Last: ${row.metadataError || row.readError ? 'Unavailable' : row.lastReviewed || 'Not recorded'}`);
      const due = document.createElement('small'); due.textContent = row.flags.dateProblem || `Due: ${row.flags.due}${row.flags.overdue ? ' · Due for review' : ''}`; dates.append(due);
      const check = cell('Saved-file check');
      const labels = { valid: 'Last check passed', error: 'Validation errors', unchecked: 'Not checked for this saved version', unavailable: 'Check unavailable' };
      check.append(document.createTextNode(labels[row.validation?.formatting] || labels.unchecked));
      if (row.validation?.checkedAt) { const when = document.createElement('small'); when.textContent = timestamp(row.validation.checkedAt); check.append(when); }
      for (const problem of [row.metadataError, row.readError]) if (problem) { const note = document.createElement('p'); note.textContent = problem; note.className = 'review-error'; check.append(note); }
      const issues = row.validation?.issues || [];
      if (issues.length) {
        const details = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('ul');
        summary.textContent = `${row.validation.issueCount ?? issues.length} finding(s)`;
        for (const issue of issues.slice(0, 20)) { const li = document.createElement('li'); li.textContent = `${issue.type || 'Validation'}${issue.sourceLine ? ` · line ${issue.sourceLine}` : ''}: ${issue.message}`; list.append(li); }
        if (issues.length > 20) { const li = document.createElement('li'); li.textContent = 'Open the handout to review all findings.'; list.append(li); }
        details.append(summary, list); check.append(details);
      }
      const action = cell('Action'), button = document.createElement('button'); button.type = 'button'; button.textContent = 'Open handout'; button.disabled = Boolean(row.readError);
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { if (await openHandout(row)) dialog.close(); else status.textContent = 'Handout not opened. Your current editor text is preserved.'; }
        catch (error) { message.textContent = error.message; status.textContent = error.message; }
        finally { button.disabled = Boolean(row.readError); }
      });
      action.append(button); return tr;
    }));
    $('#review-empty').hidden = Boolean(visible.length); controls();
  }
  async function load(ticket = ++epoch) {
    status.textContent = 'Reading saved handouts…'; loading = true; controls();
    try {
      const result = await request('/api/review');
      if (ticket !== epoch || !dialog.open) return;
      rows = result.handouts; fetchedAt = result.fetchedAt;
      const chosen = $('#review-section').value;
      $('#review-section').replaceChildren(new Option('All sections', ''), ...[...new Set(rows.map(row => row.section))].sort().map(section => new Option(section, section)));
      if ([...$('#review-section').options].some(option => option.value === chosen)) $('#review-section').value = chosen;
      status.textContent = 'Saved data loaded.'; render();
    } catch (error) { if (ticket === epoch && dialog.open) { rows = []; fetchedAt = ''; tbody.replaceChildren(); $('#review-section').replaceChildren(new Option('All sections', '')); status.textContent = `Could not load the dashboard: ${error.message}`; render(); } }
    finally { if (ticket === epoch && dialog.open) { loading = false; controls(); } }
  }
  async function checkSaved() {
    if (busy || loading) return;
    busy = true; stop = false; const ticket = epoch;
    const checking = rows.filter(row => !row.readError); let completed = 0, failed = 0;
    controls();
    for (const row of checking) {
      if (stop || ticket !== epoch || !dialog.open) break;
      status.textContent = `Checking saved handouts… ${completed}/${checking.length} · ${row.code}`;
      try {
        const result = await request('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: row.path }) });
        if (ticket !== epoch || !dialog.open) return;
        if (result.revision === row.revision && result.private === row.private) row.validation = result;
      } catch { failed++; }
      completed++; if (ticket === epoch && dialog.open) render();
    }
    if (ticket !== epoch || !dialog.open) return;
    const stopped = stop; busy = false; stop = false;
    await load(ticket);
    if (ticket === epoch && dialog.open) status.textContent = `${stopped ? 'Stopped' : 'Checks finished'} · ${completed}/${checking.length} checked${failed ? ` · ${failed} unavailable` : ''}.`;
  }
  $('#review-dashboard').addEventListener('click', () => {
    if (document.querySelector('dialog[open]')) return;
    date.value = localReviewDate(); interval.value = '12'; dialog.showModal(); load();
  });
  $('#review-refresh').addEventListener('click', () => load());
  $('#review-check').addEventListener('click', checkSaved);
  $('#review-stop').addEventListener('click', () => { stop = true; controls(); status.textContent = 'Stopping after the current handout finishes…'; });
  for (const id of ['review-search', 'review-filter', 'review-status', 'review-library', 'review-section', 'review-date', 'review-interval']) $(`#${id}`).addEventListener('input', render);
  for (const button of document.querySelectorAll('[data-review-filter]')) button.addEventListener('click', () => { $('#review-filter').value = button.dataset.reviewFilter; render(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); } });
  dialog.addEventListener('close', () => {
    epoch++; stop = true; busy = false; loading = false; rows = []; fetchedAt = ''; tbody.replaceChildren(); search.value = ''; status.textContent = '';
    $('#review-section').replaceChildren(new Option('All sections', ''));
    for (const id of ['review-status', 'review-library']) $(`#${id}`).value = '';
    $('#review-filter').value = 'attention'; $('#review-snapshot').textContent = ''; $('#review-count').textContent = '';
    for (const button of document.querySelectorAll('[data-review-filter]')) button.querySelector('strong').textContent = '0';
  });
}
