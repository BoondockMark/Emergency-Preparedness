export function createGitControls({ request, context, save }) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#git-dialog'), status = $('#git-state'), title = $('#git-title'), notes = $('#git-notes');
  let plan, snapshot, busy = false;
  const current = () => snapshot && ['path', 'source', 'private', 'revision'].every(key => context()[key] === snapshot[key]) && !context().pending;
  function controls() {
    $('#git-prepare').disabled = busy; $('#git-publish').disabled = busy || !plan || !current() || title.value.trim().length < 3 || title.value.length > 120 || notes.value.length > 8000;
    dialog.querySelector('.dialog-heading button').disabled = busy; title.disabled = notes.disabled = busy;
  }
  $('#save-pr').addEventListener('click', () => {
    if (document.querySelector('dialog[open]')) return;
    plan = snapshot = undefined; status.textContent = 'Save locally, then review the files before committing and publishing.';
    title.value = `Update ${context().code || 'handout'}`; dialog.showModal(); controls();
  });
  $('#git-prepare').addEventListener('click', async () => {
    if (busy) return; busy = true; plan = undefined; $('#git-result').replaceChildren(); $('#git-files').replaceChildren(); $('#git-summary').textContent = $('#git-patch').textContent = $('#git-target').textContent = ''; controls();
    try {
      status.textContent = 'Saving the current handout…';
      const before = context();
      if (!await save() || context().path !== before.path || context().private !== before.private) throw Error('Publication paused. Finish saving this handout, then prepare it again.');
      snapshot = context(); status.textContent = 'Saved locally. Checking GitHub access and preparing the handout branch…';
      const prepared = await request('/api/git/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: snapshot.path, revision: snapshot.revision, private: snapshot.private, session: snapshot.session }) });
      if (!current()) throw Error('The editor changed while preparing. Save and prepare it again.');
      plan = prepared;
      $('#git-target').textContent = `${prepared.repository} · ${prepared.private ? 'Private' : 'Public'} repository · ${prepared.branch} → ${prepared.base}`;
      $('#git-files').replaceChildren(...prepared.files.map(file => { const li = document.createElement('li'); li.textContent = file; return li; }));
      $('#git-summary').textContent = prepared.summary; $('#git-patch').textContent = prepared.patch;
      $('#git-publish').textContent = prepared.updating ? 'Commit, push and update PR' : 'Commit, push and create draft PR';
      status.textContent = 'Ready to publish the reviewed saved snapshot. Only the files below will be included.';
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; controls(); }
  });
  $('#git-publish').addEventListener('click', async () => {
    if (busy || !plan || !current()) return;
    busy = true; controls(); status.textContent = 'Creating the commit, pushing the editor branch, and opening the pull request…';
    try {
      const result = await request('/api/git/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: plan.token, session: snapshot.session, title: title.value, notes: notes.value }) });
      const link = document.createElement('a'); link.href = result.url; link.textContent = `Open pull request #${result.number}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
      $('#git-result').replaceChildren(link); status.textContent = `Published commit ${result.commit.slice(0, 8)}. Your checkout and other staged files are preserved.`;
      plan = undefined;
    } catch (error) { plan = undefined; status.textContent = `${error.message} Choose Save and review again to retry. Any completed commit or push is retained.`; }
    finally { busy = false; controls(); }
  });
  title.addEventListener('input', controls); notes.addEventListener('input', controls);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    plan = snapshot = undefined; title.value = notes.value = status.textContent = ''; $('#git-files').replaceChildren(); $('#git-result').replaceChildren(); $('#git-summary').textContent = $('#git-patch').textContent = $('#git-target').textContent = '';
  });
  return { changed() { if (dialog.open && plan && !current()) { plan = undefined; status.textContent = 'The editor changed. Save and review again before publishing.'; controls(); } } };
}
