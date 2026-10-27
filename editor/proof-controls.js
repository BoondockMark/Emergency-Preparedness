export function createProofControls({ request, context, selectIssue }) {
  const dialog = document.querySelector('#proof-dialog');
  const state = document.querySelector('#proof-state');
  const progress = document.querySelector('#proof-progress');
  const download = document.querySelector('#proof-download');
  const rebuild = document.querySelector('#proof-rebuild');
  const cancel = document.querySelector('#proof-cancel');
  const issues = document.querySelector('#proof-issues');
  const labels = { queued: 'Starting build…', checking: 'Checking source and metadata…', preparing: 'Preparing images and fonts…', rendering: 'Checking print layout…', encoding: 'Generating PDF…', verifying: 'Verifying approval records…', ready: 'PDF proof ready.', failed: 'PDF proof could not be built.', cancelled: 'Build cancelled.' };
  const finished = new Set(['ready', 'failed', 'cancelled']);
  let snapshot;
  let job;
  let poll;
  let generation = 0;
  let starting = false;
  let invalidated = false;
  let downloadError;
  function current() { const value = context(); return !invalidated && snapshot?.path === value.path && snapshot.source === value.source; }
  function draw() {
    const matching = current();
    const running = starting || (job && !finished.has(job.state));
    state.textContent = starting ? 'Starting build…' : job?.error || downloadError || labels[job?.state] || 'Build a proof from the current text and images.';
    progress.value = job?.progress || 0;
    progress.hidden = !running;
    download.disabled = starting || job?.state !== 'ready' || !matching;
    rebuild.disabled = Boolean(starting || (running && matching));
    cancel.hidden = !running || starting;
    document.querySelector('#proof-stale').hidden = !snapshot || matching;
    document.querySelector('#proof-summary').textContent = job?.state === 'ready'
      ? `${job.filename} · ${job.pageCount} page${job.pageCount === 1 ? '' : 's'} · ${Math.ceil(job.size / 1024)} KB · ${job.private ? 'Private library' : 'Public library'}${snapshot?.unsaved ? ' · Built from unsaved edits' : ''}` : '';
    issues.replaceChildren(...(job?.issues || []).map(issue => {
      const item = document.createElement('li');
      const label = `${issue.severity === 'warning' ? 'Warning' : 'Error'}: ${issue.message}`;
      if (matching && issue.sourceLine) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', () => { dialog.close(); selectIssue(issue); }); item.append(button);
      } else item.textContent = label;
      return item;
    }));
  }
  async function post(endpoint, payload) {
    return request(`/api/proofs/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  }
  async function watch(sequence) {
    if (!job || sequence !== generation) return;
    const id = job.id;
    try {
      const result = await post('status', { id, session: snapshot.session });
      if (sequence !== generation || job?.id !== id) return;
      job = result; draw();
      if (!finished.has(job.state)) poll = setTimeout(() => watch(sequence), 350);
    } catch (error) {
      if (sequence !== generation) return;
      job = { ...job, state: 'failed', error: error.message }; draw();
    }
  }
  async function start() {
    if (starting) return;
    const value = context();
    if (!value.path) { state.textContent = 'Choose a handout first.'; return; }
    const sequence = ++generation; clearTimeout(poll);
    snapshot = { ...value }; job = undefined; downloadError = undefined; invalidated = false; starting = true; draw();
    try {
      const result = await post('start', snapshot);
      if (sequence !== generation) return;
      job = result; starting = false; draw(); watch(sequence);
    } catch (error) {
      if (sequence !== generation) return;
      starting = false; job = { state: 'failed', error: error.message }; draw();
    }
  }
  document.querySelector('#build-proof').addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
    if (!job || (!current() && !starting)) start(); else draw();
  });
  rebuild.addEventListener('click', start);
  cancel.addEventListener('click', async () => {
    const id = job?.id; const session = snapshot?.session;
    generation++; clearTimeout(poll); job = { state: 'cancelled' }; starting = false; draw();
    if (id) try { await post('cancel', { id, session }); } catch (error) { state.textContent = error.message; }
  });
  download.addEventListener('click', async () => {
    if (!current() || job?.state !== 'ready') return draw();
    const sequence = generation;
    downloadError = undefined;
    download.disabled = true;
    try {
      const response = await fetch('/api/proofs/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: job.id, session: snapshot.session }), cache: 'no-store' });
      if (!response.ok) throw Error((await response.json()).error || 'PDF download failed');
      const blob = await response.blob();
      if (sequence !== generation || !current()) return draw();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = job.filename;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { downloadError = error.message; }
    finally { draw(); }
  });
  return {
    changed: draw,
    invalidate() {
      invalidated = true; draw();
    }
  };
}
