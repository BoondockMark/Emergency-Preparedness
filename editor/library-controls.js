export function createLibraryControls({ request, context, install, message }) {
  const dialog = document.querySelector('#create-dialog');
  const form = document.querySelector('#create-form');
  const section = form.elements.sectionNumber;
  const library = form.elements.library;
  const template = form.elements.template;
  const error = document.querySelector('#create-error');
  let options;
  let original;
  let busy = false;

  function describe() {
    const item = options.sections.find(item => item.number === Number(section.value));
    document.querySelector('#create-code').textContent = item?.nextCode ? `Next code: ${item.nextCode}. The code is assigned when you create the draft.` : 'This section has no remaining codes.';
    document.querySelector('#create-library-note').textContent = library.value === 'private'
      ? 'Content and images stay in the private library. A generic public placeholder is created for binder alignment.'
      : 'Creates a draft in the local public library. Review it before publishing.';
  }
  async function open(duplicate) {
    const current = context();
    if (current.unsaved) { message.textContent = 'Save or revert the current handout and pending uploads before creating a handout.'; document.querySelector('#save').focus(); return; }
    if (duplicate && !current.path) { message.textContent = 'Choose a handout to duplicate.'; return; }
    try {
      const results = await Promise.all([
        request('/api/library-options'),
        duplicate ? request('/api/details', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: current.path, source: current.source }) }) : Promise.resolve(null)
      ]);
      if (context().path !== current.path || context().unsaved) { message.textContent = 'The document changed. Save it and try again.'; return; }
      options = results[0]; original = duplicate ? current : null;
      section.replaceChildren(...options.sections.map(item => new Option(item.title, item.number)));
      library.replaceChildren(...options.libraries.map(value => new Option(value === 'private' ? 'Private library' : 'Public library', value)));
      template.replaceChildren(...options.templates.map(item => new Option(`${item.title} — ${item.description}`, item.id)));
      const metadata = results[1]?.metadata;
      if (duplicate && metadata.private && !options.libraries.includes('private')) { message.textContent = 'Open the private editor to duplicate this handout.'; return; }
      section.value = metadata?.sectionNumber || 1;
      library.value = current.private && options.libraries.includes('private') ? 'private' : 'public';
      library.disabled = Boolean(duplicate && current.private);
      form.elements.title.value = duplicate ? `${[...metadata.title].slice(0, 65).join('')} (copy)` : '';
      const today = new Date();
      form.elements.reviewDate.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      document.querySelector('#create-template-label').hidden = duplicate;
      document.querySelector('#create-title').textContent = duplicate ? 'Duplicate handout' : 'New handout';
      document.querySelector('#create-submit').textContent = duplicate ? 'Create draft copy' : 'Create draft';
      error.textContent = ''; describe(); dialog.showModal(); form.elements.title.focus();
    } catch (failure) { message.textContent = failure.message; }
  }
  document.querySelector('#new-handout').addEventListener('click', () => open(false));
  document.querySelector('#duplicate-handout').addEventListener('click', () => open(true));
  section.addEventListener('change', describe); library.addEventListener('change', describe);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.querySelector('.dialog-heading').addEventListener('submit', event => { if (busy) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    if (context().unsaved || (original && context().path !== original.path)) { error.textContent = 'The original changed. Save it and reopen this dialog.'; return; }
    busy = true; document.querySelector('#create-submit').disabled = true; error.textContent = '';
    try {
      const payload = {
        title: form.elements.title.value, sectionNumber: Number(section.value), library: library.value,
        reviewDate: form.elements.reviewDate.value, template: template.value, session: context().session,
        ...(original ? { sourcePath: original.path, revision: original.revision } : {})
      };
      const result = await request('/api/handouts/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      dialog.close(); await install(result, result.path);
      message.textContent = `Created ${result.code} in the ${result.library} library. This is a draft.`;
    } catch (failure) { error.textContent = failure.message; }
    finally { busy = false; document.querySelector('#create-submit').disabled = false; }
  });
  document.querySelector('#refresh-handouts').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      const result = await request('/api/library/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: context().session }) });
      const missing = context().path && !result.handouts.some(item => item.path === context().path);
      await install(result);
      message.textContent = missing ? 'The open handout is no longer on disk. Your text remains in the editor.' : 'Handout list refreshed. Your open edits are preserved.';
    } catch (failure) { message.textContent = `Library not refreshed: ${failure.message}. Your open edits are preserved.`; }
    finally { button.disabled = false; }
  });
}
