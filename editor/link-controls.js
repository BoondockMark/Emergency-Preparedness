import { checkedLinkUrl, escapeLinkText, linkOpeningWithUrl, linkOpeningWithoutUrl, sourceLinkSelection } from './link-model.js';

export function createLinkControls({ source, visual, context, applySource, commitVisual, message }) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#link-dialog'), label = $('#link-text'), url = $('#link-url'), error = $('#link-error');
  const attached = new WeakSet();
  let editing;
  function nodeElement(node) { return node?.nodeType === 1 ? node : node?.parentElement; }
  function current() {
    if (!editing) return false;
    const now = context();
    return ['path', 'source', 'mode', 'private'].every(key => now[key] === editing.snapshot[key])
      && (now.mode !== 'visual' || visual.contentDocument === editing.doc && editing.block?.isConnected);
  }
  function validate() {
    try {
      if (!current()) throw Error('The editor changed. Close this window and select the link again.');
      checkedLinkUrl(url.value);
      if (!label.disabled && !label.value.trim()) throw Error('Enter descriptive link text.');
      if (/[\r\n]/.test(label.value)) throw Error('Keep link text on one line.');
      error.textContent = ''; $('#link-apply').disabled = false;
    } catch (failure) { error.textContent = failure.message; $('#link-apply').disabled = true; }
  }
  function open(target) {
    if (document.querySelector('dialog[open]')) return;
    try {
      const snapshot = context();
      let anchor, range, block, sourceRange, selectedText = '', imageOnly = false;
      if (snapshot.mode === 'visual') {
        if (snapshot.renderedSource !== snapshot.source) throw Error('The Visual editor is refreshing. Wait for it to finish, or switch to Source to edit the link.');
        const doc = visual.contentDocument;
        const selection = doc?.getSelection();
        range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
        anchor = target || nodeElement(range?.startContainer)?.closest('a');
        if (anchor) {
          if (!target && range && !anchor.contains(range.endContainer)) throw Error('Select text within one link, or click the link to edit it.');
          block = anchor.closest('[data-visual-block]');
          selectedText = anchor.textContent; imageOnly = !selectedText.trim() && Boolean(anchor.querySelector('img'));
        } else {
          block = nodeElement(range?.startContainer)?.closest('[data-visual-block]');
          if (!range || !block || block !== nodeElement(range.endContainer)?.closest('[data-visual-block]')) throw Error('Select text or place the cursor within one paragraph or component first.');
          const fragment = range.cloneContents();
          if (nodeElement(range.endContainer)?.closest('a') || fragment.querySelector('a, p, div, h1, h2, h3, h4, h5, h6, li, table, figure, br')) throw Error('Select text within one paragraph, outside existing links.');
          selectedText = range.toString(); imageOnly = !selectedText.trim() && Boolean(fragment.querySelector('img'));
        }
        if (!block) throw Error('This link cannot be mapped to the handout. Edit it directly in Source.');
        editing = { snapshot, doc, block, range, anchor, selectedText };
      } else {
        const start = source.selectionStart, end = source.selectionEnd;
        sourceRange = sourceLinkSelection(source.value, start, end);
        if (sourceRange) {
          const template = document.createElement('template'); template.innerHTML = source.value.slice(sourceRange.start, sourceRange.end);
          anchor = template.content.querySelector('a'); selectedText = anchor.textContent;
          imageOnly = !selectedText.trim() && Boolean(anchor.querySelector('img'));
        } else selectedText = source.value.slice(start, end);
        editing = { snapshot, start, end, sourceRange, selectedText };
      }
      editing.imageOnly = imageOnly;
      editing.preserveAnchor = anchor?.hasAttribute('id') || anchor?.hasAttribute('name');
      label.disabled = imageOnly; label.value = selectedText; editing.selectedText = label.value;
      url.value = anchor?.getAttribute('href') || '';
      $('#link-title').textContent = anchor ? 'Edit link' : 'Insert link';
      $('#link-remove').hidden = !anchor;
      $('#link-note').textContent = imageOnly ? 'This is an image link. Change its address or remove the link; use image tools to edit the image.' : 'Changing the address keeps existing text formatting. Changing link text replaces formatting inside the link.';
      if (editing.preserveAnchor) $('#link-note').textContent += ' Removing the link keeps its named anchor for existing cross-references.';
      dialog.showModal(); validate();
      (anchor || selectedText ? url : label).focus();
    } catch (failure) { editing = undefined; message.textContent = failure.message; }
  }
  function apply(remove = false) {
    if (!current()) { error.textContent = 'The editor changed. Close this window and select the link again.'; return; }
    if (!remove) { validate(); if ($('#link-apply').disabled) return; }
    try {
      const address = remove ? undefined : checkedLinkUrl(url.value);
      if (editing.snapshot.mode === 'source') {
        const { sourceRange: link, start, end, snapshot } = editing;
        let replacement;
        if (link) {
          const inner = snapshot.source.slice(link.openEnd, link.closeStart);
          replacement = remove ? (editing.preserveAnchor ? linkOpeningWithoutUrl(snapshot.source.slice(link.start, link.openEnd)) + inner + snapshot.source.slice(link.closeStart, link.end) : inner) : linkOpeningWithUrl(snapshot.source.slice(link.start, link.openEnd), address)
            + (label.value === editing.selectedText || editing.imageOnly ? inner : escapeLinkText(label.value)) + snapshot.source.slice(link.closeStart, link.end);
        } else replacement = `<a href="${escapeLinkText(address)}">${escapeLinkText(label.value)}</a>`;
        const from = link?.start ?? start, to = link?.end ?? end;
        const next = snapshot.source.slice(0, from) + replacement + snapshot.source.slice(to);
        dialog.close(); applySource(next, from, from + replacement.length);
      } else {
        const { block, doc, range } = editing;
        let anchor = editing.anchor;
        if (remove) {
          if (editing.preserveAnchor) anchor.removeAttribute('href');
          else anchor.replaceWith(...anchor.childNodes);
        }
        else if (anchor) {
          anchor.setAttribute('href', address);
          if (label.value !== editing.selectedText && !editing.imageOnly) anchor.textContent = label.value;
        } else {
          anchor = doc.createElement('a'); anchor.setAttribute('href', address);
          if (!range.collapsed && (label.value === editing.selectedText || editing.imageOnly)) anchor.append(range.extractContents());
          else { range.deleteContents(); anchor.textContent = label.value; }
          range.insertNode(anchor);
        }
        dialog.close();
        // Existing block serialization updates source, history, drafts and proofs.
        commitVisual(block);
      }
      message.textContent = remove ? 'Removed link; its contents are preserved. Save to keep this change.' : 'Applied link. Save to keep this change.';
    } catch (failure) { error.textContent = failure.message; }
  }
  $('#links').addEventListener('click', () => open());
  $('#link-form').addEventListener('submit', event => { event.preventDefault(); apply(); });
  $('#link-remove').addEventListener('click', () => apply(true));
  label.addEventListener('input', validate); url.addEventListener('input', validate);
  dialog.addEventListener('close', () => { editing = undefined; label.value = url.value = error.textContent = ''; $('#link-note').textContent = ''; });
  return {
    attach(doc) {
      if (attached.has(doc)) return; attached.add(doc);
      doc.addEventListener('click', event => {
        const anchor = event.target.closest?.('.content a[href]');
        if (!anchor) return;
        event.preventDefault(); event.stopImmediatePropagation(); anchor.focus({ preventScroll: true }); open(anchor);
      });
    }
  };
}
