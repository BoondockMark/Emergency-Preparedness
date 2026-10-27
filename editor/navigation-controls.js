import { documentOutline, findMatches, replaceMatches, sectionEdit } from './navigation-model.js';

export function createNavigationControls({ source, context, apply, navigate, message }) {
  const $ = selector => document.querySelector(selector);
  const outline = $('#document-outline');
  const list = $('#outline-headings');
  const panel = $('#find-panel');
  const query = $('#find-query');
  const replacement = $('#find-replacement');
  let currentPath, selectedStart, matches = [], index = -1, truncated = false;
  const options = () => ({ matchCase: $('#find-case').checked, wholeWord: $('#find-word').checked, allSource: $('#find-metadata').checked });
  function refreshFind(reset = false) {
    ({ matches, truncated } = findMatches(source.value, query.value, options()));
    if (reset) index = -1;
    if (index >= matches.length) index = matches.length - 1;
    $('#find-count').textContent = !query.value ? 'Enter text to find in the source.' : !matches.length ? 'No matches' : `${index < 0 ? '' : `${index + 1} of `}${matches.length}${truncated ? '+' : ''} matches`;
    for (const id of ['find-previous', 'find-next', 'find-replace']) $(`#${id}`).disabled = !matches.length;
    $('#find-replace-all').disabled = !matches.length || truncated;
  }
  function selectMatch(direction = 1) {
    refreshFind();
    if (!matches.length) return;
    if (index < 0) {
      index = matches.findIndex(match => match.start >= source.selectionStart);
      if (index < 0) index = 0;
      if (direction < 0) index = (index + matches.length - 1) % matches.length;
    } else index = (index + direction + matches.length) % matches.length;
    const match = matches[index];
    navigate(match.start, match.end, true);
    refreshFind();
  }
  function openFind() {
    if (document.querySelector('dialog[open]')) return;
    panel.hidden = false; $('#find-toggle').setAttribute('aria-expanded', 'true');
    const selected = source.value.slice(source.selectionStart, source.selectionEnd);
    if (!source.hidden && selected && selected.length < 200 && !selected.includes('\n')) query.value = selected;
    refreshFind(true); query.focus(); query.select();
  }
  function closeFind() { panel.hidden = true; $('#find-toggle').setAttribute('aria-expanded', 'false'); $('#find-toggle').focus(); }
  function shortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f' || document.querySelector('dialog[open]')) return false;
    event.preventDefault(); openFind(); return true;
  }
  $('#find-toggle').addEventListener('click', () => panel.hidden ? openFind() : closeFind());
  $('#find-close').addEventListener('click', closeFind);
  document.addEventListener('keydown', shortcut);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeFind(); }
    if (event.key === 'Enter' && event.target === query) { event.preventDefault(); selectMatch(event.shiftKey ? -1 : 1); query.focus(); }
  });
  for (const element of [query, $('#find-case'), $('#find-word'), $('#find-metadata')]) element.addEventListener('input', () => refreshFind(true));
  $('#find-next').addEventListener('click', () => selectMatch());
  $('#find-previous').addEventListener('click', () => selectMatch(-1));
  $('#find-replace').addEventListener('click', () => {
    refreshFind();
    const match = matches[index];
    if (!match || source.selectionStart !== match.start || source.selectionEnd !== match.end) { index = -1; selectMatch(); return; }
    const at = match.start + replacement.value.length;
    apply(replaceMatches(source.value, [match], replacement.value), at, at);
    index = -1; selectMatch();
    message.textContent = 'Replaced one source match. Undo restores the previous text.';
  });
  $('#find-replace-all').addEventListener('click', () => {
    refreshFind();
    if (!matches.length || truncated) return;
    const count = matches.length;
    if (!confirm(`Replace all ${count} source matches${options().allSource ? ', including front matter' : ' in the handout body'}?`)) return;
    const at = matches[0].start;
    apply(replaceMatches(source.value, matches, replacement.value), at, at + replacement.value.length);
    refreshFind(true); message.textContent = `Replaced ${count} source matches. Undo restores them together.`;
  });
  function updateButtons(headings = documentOutline(source.value)) {
    const start = Number(list.value);
    for (const action of ['up', 'down', 'duplicate']) {
      let available = Boolean(list.options.length), reason = '';
      try { sectionEdit(source.value, start, action, headings); } catch (error) { available = false; reason = error.message; }
      $(`#section-${action}`).disabled = !available;
      $(`#section-${action}`).title = reason;
    }
    const heading = headings.find(item => item.start === start);
    $('#outline-help').textContent = heading && !heading.safe ? 'This heading is inside HTML or has an uncertain boundary. Use Source for structural changes.' : 'Moves stay on the same page and heading level. Sections include their subheadings. Changes are undoable.';
    $('#outline-go').disabled = !heading;
  }
  list.addEventListener('change', () => { selectedStart = Number(list.value); updateButtons(); go(); });
  function go() {
    const heading = documentOutline(source.value).find(item => item.start === Number(list.value));
    if (heading) navigate(heading.start, heading.start + source.value.slice(heading.start).split('\n')[0].length, false);
  }
  $('#outline-go').addEventListener('click', go);
  for (const action of ['up', 'down', 'duplicate']) $(`#section-${action}`).addEventListener('click', () => {
    try {
      const edit = sectionEdit(source.value, Number(list.value), action);
      selectedStart = edit.start; apply(edit.source, edit.start, edit.end); changed();
      message.textContent = action === 'duplicate' ? 'Duplicated section. Review the copy and validation before saving.' : 'Moved section. Review the layout before saving.';
    } catch (error) { message.textContent = error.message; }
  });
  function changed() {
    const current = context();
    const path = `${Boolean(current.private)}:${current.path || ''}`;
    if (path !== currentPath) {
      currentPath = path; selectedStart = undefined; query.value = ''; replacement.value = ''; index = -1;
    }
    const headings = documentOutline(source.value);
    const selected = headings.find(item => item.start === selectedStart) || headings[0];
    selectedStart = selected?.start;
    list.replaceChildren(...headings.map(item => {
      const option = document.createElement('option'); option.value = item.start;
      option.textContent = `${'— '.repeat(Math.max(0, item.level - 2))}${item.title} · page ${item.page}, line ${item.line}`;
      return option;
    }));
    if (selected) list.value = selected.start;
    $('#outline-count').textContent = `${headings.length} heading${headings.length === 1 ? '' : 's'}`;
    list.disabled = !headings.length; updateButtons(headings);
    if (!panel.hidden) refreshFind(true);
  }
  // Refresh again when the native details panel opens.
  outline.addEventListener('toggle', () => { if (outline.open) changed(); });
  return { changed, shortcut };
}
