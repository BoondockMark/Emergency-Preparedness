// Commands call the same controls as the toolbar, preserving their validation,
// confirmations, disabled states, and save/recovery behavior.
export function createCommandControls({ context, capture, message, showEditor }) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#commands-dialog');
  const input = $('#command-query');
  const results = $('#command-results');
  const status = $('#command-count');
  const help = $('#shortcuts-dialog');
  const frames = new WeakSet();
  let snapshot, selection, previousFocus, visible = [], active = -1;
  let executing = false;
  const button = (id, title, group, keywords = '', shortcut = '', needsSelection = false) => ({
    id, title, group, keywords, shortcut, needsSelection,
    available: () => Boolean($(id)) && !$(id).disabled && !$(id).hidden,
    reason: () => ({
      '#undo': 'No earlier edit in this handout’s history.',
      '#redo': 'No later edit to restore.',
      '#save': 'Wait for the current save to finish.',
      '#revert': 'Wait for the current save to finish.',
      '#table-row': 'Select a table in Visual mode.',
      '#table-column': 'Select a table in Visual mode.',
      '#remove-component': 'Select a removable component in Visual mode.',
      '#preview-previous': 'At the first page, or the preview is loading.',
      '#preview-next': 'At the last page, or the preview is loading.'
    })[id] || $(id)?.title || 'Unavailable for the current selection or while an operation is running.',
    run: () => $(id).click()
  });
  const commands = [
    button('#save', 'Save handout', 'Handout', 'write disk keep', 'Ctrl/Cmd+S'),
    button('#undo', 'Undo last edit', 'Editing', 'history restore', 'Ctrl/Cmd+Z'),
    button('#redo', 'Redo edit', 'Editing', 'history', 'Ctrl/Cmd+Shift+Z'),
    button('#details', 'Edit handout details', 'Handout', 'title version reviewers sources metadata'),
    button('#review-dashboard', 'Open review dashboard', 'Library', 'overdue reviewers validation queue dates'),
    button('#review-changes', 'Review unsaved changes', 'Handout', 'diff compare merge disk conflict'),
    button('#revert', 'Revert handout from disk', 'Handout', 'reload discard edits'),
    button('#new-handout', 'Create new handout', 'Library', 'template draft'),
    button('#duplicate-handout', 'Duplicate handout', 'Library', 'copy draft'),
    button('#refresh-handouts', 'Refresh handout list', 'Library', 'discover files disk'),
    { id: 'search-handouts', title: 'Search handouts', group: 'Library', keywords: 'code title open switch', run() { showEditor(); $('#handout-search').focus(); $('#handout-search').select(); } },
    button('#source-mode', 'Switch to Source mode', 'View', 'markdown html raw'),
    button('#visual-mode', 'Switch to Visual mode', 'View', 'canvas wysiwyg'),
    { id: 'find', title: 'Find and replace in handout', group: 'Editing', keywords: 'search text replace all', shortcut: 'Ctrl/Cmd+F', run() { showEditor(); if ($('#find-panel').hidden) $('#find-toggle').click(); else { $('#find-query').focus(); $('#find-query').select(); } } },
    { id: 'outline', title: 'Open document outline', group: 'Navigation', keywords: 'heading section move duplicate', run() { showEditor(); $('#document-outline').open = true; $('#outline-headings').focus(); } },
    { id: 'validation', title: 'Show validation findings', group: 'Navigation', keywords: 'issues errors fix', run() { $('#validation').focus(); $('#validation').scrollIntoView({ block: 'center' }); } },
    button('#links', 'Insert or edit link', 'Insert', 'url address hyperlink remove', '', true),
    button('#images', 'Insert or edit image', 'Insert', 'photo asset upload picture resize', '', true),
    button('[data-wrap="**|**"]', 'Make selection bold', 'Formatting', 'strong text', '', true),
    button('[data-wrap="*|*"]', 'Emphasize selection', 'Formatting', 'italic text', '', true),
    button('[data-before="## "]', 'Make heading', 'Formatting', 'title section', '', true),
    button('[data-before="- "]', 'Make list', 'Formatting', 'bullets', '', true),
    button('[data-insert^="| Heading"]', 'Insert table', 'Insert', 'rows columns'),
    ...['warning', 'checklist', 'procedure', 'local-info', 'sources', 'grid'].map(kind => button(`[data-block="${kind}"]`, `Insert ${kind.replace('-', ' ')} component`, 'Insert', kind === 'grid' ? 'columns layout' : 'block')),
    button('[data-insert*="pagebreak"]', 'Insert page break', 'Insert', 'pagination next page'),
    button('#table-row', 'Add table row', 'Editing', 'cells table', '', true),
    button('#table-column', 'Add table column', 'Editing', 'cells table', '', true),
    button('#section-up', 'Move outlined section up', 'Editing', 'heading reorder'),
    button('#section-down', 'Move outlined section down', 'Editing', 'heading reorder'),
    button('#section-duplicate', 'Duplicate outlined section', 'Editing', 'heading copy'),
    button('#remove-component', 'Remove selected component', 'Editing', 'delete block', '', true),
    button('#build-proof', 'Build PDF proof', 'Proof', 'download export print validate'),
    { id: 'preview-only', title: 'Toggle preview only', group: 'View', keywords: 'expand show editor full screen', run: () => $('#preview-only').click() },
    button('#preview-previous', 'Previous preview page', 'Navigation', 'print proof back'),
    button('#preview-next', 'Next preview page', 'Navigation', 'print proof forward'),
    { id: 'fit-width', title: 'Fit preview to width', group: 'View', keywords: 'zoom reset scale', run() { $('#preview-zoom').value = 'fit'; $('#preview-zoom').dispatchEvent(new Event('change', { bubbles: true })); } },
    { id: 'shortcuts', title: 'Keyboard shortcuts and help', group: 'Help', keywords: 'guide keys commands', run: () => help.showModal() }
  ];
  function current() { return JSON.stringify(context()) === JSON.stringify(snapshot); }
  function available(command) { return (!command.available || command.available()) && (!command.needsSelection || selection?.usable !== false); }
  function highlight(index) {
    active = index;
    [...results.children].forEach((option, at) => option.setAttribute('aria-selected', String(at === active)));
    if (active < 0) input.removeAttribute('aria-activedescendant');
    else {
      input.setAttribute('aria-activedescendant', results.children[active].id);
      results.children[active].scrollIntoView({ block: 'nearest' });
    }
  }
  function render() {
    const terms = input.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    visible = commands.filter(command => terms.every(term => `${command.title} ${command.group} ${command.keywords || ''} ${command.shortcut || ''}`.toLocaleLowerCase().includes(term)));
    results.replaceChildren(...visible.map((command, index) => {
      const option = document.createElement('li');
      option.id = `command-option-${index}`; option.role = 'option';
      const enabled = available(command);
      option.setAttribute('aria-disabled', String(!enabled));
      const title = document.createElement('strong'); title.textContent = command.title;
      const detail = document.createElement('small');
      const reason = enabled ? '' : command.needsSelection && selection?.usable === false
        ? 'Click or select content in the editor first.' : command.reason?.() || 'Select text in the editor first.';
      detail.textContent = [command.group, command.shortcut, reason].filter(Boolean).join(' · ');
      option.append(title, detail);
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('click', () => execute(index));
      return option;
    }));
    const count = visible.filter(available).length;
    status.textContent = visible.length ? `${visible.length} commands · ${count} available` : 'No matching commands. Try “image”, “PDF”, “outline”, or “save”.';
    highlight(visible.findIndex(available));
  }
  function restore(required = false, forAction = false) {
    if (!current()) return false;
    return selection?.restore(required, forAction) !== false;
  }
  function execute(index) {
    const command = visible[index];
    if (!command || !available(command)) return;
    if (!current()) { dialog.close(); message.textContent = 'The handout changed while Commands was open. Open Commands again.'; return; }
    // Restore selections only after closing the modal, when its focus trap ends.
    executing = true; dialog.close();
    if (['Formatting', 'Insert', 'Editing'].includes(command.group) || ['#source-mode', '#visual-mode'].includes(command.id)) showEditor();
    const ready = restore(command.needsSelection, true);
    snapshot = selection = previousFocus = undefined;
    input.value = ''; results.replaceChildren();
    if (!ready && command.needsSelection) { message.textContent = 'The editor refreshed. Select the text or component again, then reopen Commands.'; return; }
    if (!command.available || command.available()) command.run();
  }
  function open() {
    if (dialog.open) { dialog.close(); return; }
    if (document.querySelector('dialog[open]')) return;
    previousFocus = document.activeElement;
    snapshot = context(); selection = capture(); executing = false;
    input.value = ''; dialog.showModal(); render(); input.focus();
  }
  dialog.addEventListener('close', () => {
    // A queued close event can arrive after a command opens another dialog.
    if (executing) { executing = false; return; }
    if (!document.querySelector('dialog[open]')) {
      if (!restore()) previousFocus?.focus?.({ preventScroll: true });
    }
    snapshot = selection = previousFocus = undefined;
    input.value = ''; results.replaceChildren(); input.removeAttribute('aria-activedescendant'); status.textContent = '';
  });
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); return; }
    if (event.key === 'Enter') { event.preventDefault(); execute(active); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const candidates = visible.map((command, index) => available(command) ? index : -1).filter(index => index >= 0);
    if (!candidates.length) { highlight(-1); return; }
    const at = candidates.indexOf(active);
    highlight(candidates[(at + (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length]);
  });
  function shortcut(event) {
    if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
    if (document.querySelector('dialog[open]') && !dialog.open) return;
    event.preventDefault(); open();
  }
  document.addEventListener('keydown', shortcut);
  const observer = new MutationObserver(() => { if (dialog.open) render(); });
  for (const command of commands) {
    const control = command.id.startsWith('#') || command.id.startsWith('[') ? $(command.id) : null;
    if (control) observer.observe(control, { attributes: true, attributeFilter: ['disabled', 'hidden', 'title'] });
  }
  function attach(frame) {
    const install = () => {
      const doc = frame.contentDocument;
      if (!doc || frames.has(doc)) return;
      frames.add(doc); doc.addEventListener('keydown', shortcut);
    };
    frame.addEventListener('load', install); install();
  }
  attach($('#visual')); attach($('#preview'));
  $('#commands').addEventListener('click', open);
  return { open };
}
