// Presentation-only controls. The renderer and authored source stay unscaled.
export function createPreviewControls(frame) {
  const root = document.querySelector('main');
  const zoom = document.querySelector('#preview-zoom');
  const pageInput = document.querySelector('#preview-page');
  const pageCount = document.querySelector('#preview-page-count');
  const previous = document.querySelector('#preview-previous');
  const next = document.querySelector('#preview-next');
  const toggle = document.querySelector('#preview-only');
  const splitter = document.querySelector('#pane-splitter');
  let pending;
  let readyDocument;
  let readyPath;
  let revision = 0;
  let scale = 1;
  let resizeFrame;
  let pageAtRest = 0;

  const sheets = () => readyDocument === frame.contentDocument && readyDocument?.documentElement.dataset.previewRevision === String(pending?.revision)
    ? [...readyDocument.querySelectorAll('.sheet')] : [];
  const pageTop = sheet => sheet.getBoundingClientRect().top + frame.contentWindow.scrollY;
  function position() {
    const pages = sheets();
    if (!pages.length) return pending?.position ?? { page: 0, offset: 0, left: 0, start: true };
    const view = frame.contentWindow;
    if (readyDocument.documentElement.scrollHeight <= view.innerHeight + 1) {
      const page = Math.min(pageAtRest, pages.length - 1);
      return { page, offset: 0, left: 0, start: page === 0 };
    }
    let page = 0;
    let largestVisible = -1;
    pages.forEach((sheet, index) => {
      const bounds = sheet.getBoundingClientRect();
      const visible = Math.max(0, Math.min(bounds.bottom, view.innerHeight) - Math.max(bounds.top, 0));
      if (visible > largestVisible) { largestVisible = visible; page = index; }
    });
    pageAtRest = page;
    const height = pages[page].getBoundingClientRect().height;
    return { page, offset: (view.scrollY - pageTop(pages[page])) / height, left: view.scrollX / scale };
  }
  function restore(saved) {
    const pages = sheets();
    if (!pages.length) return;
    pageAtRest = Math.min(saved.page, pages.length - 1);
    const sheet = pages[pageAtRest];
    frame.contentWindow.scrollTo(saved.left * scale, saved.start ? 0 : pageTop(sheet) + saved.offset * sheet.getBoundingClientRect().height);
    updatePages();
  }
  function updatePages() {
    const pages = sheets();
    const page = pages.length ? position().page + 1 : 1;
    pageInput.value = page;
    pageInput.max = Math.max(1, pages.length);
    pageInput.disabled = !pages.length;
    pageCount.textContent = `of ${pages.length}`;
    previous.disabled = !pages.length || page <= 1;
    next.disabled = !pages.length || page >= pages.length;
  }
  function applyZoom(saved = position()) {
    const pages = sheets();
    if (!pages.length) return;
    // offsetWidth is the unscaled print page width, independent of browser zoom.
    const width = Math.max(...pages.map(sheet => sheet.offsetWidth)) + 32;
    scale = zoom.value === 'fit' ? Math.max(.1, Math.min(2, (readyDocument.documentElement.clientWidth - 2) / width)) : Number(zoom.value) / 100;
    readyDocument.body.style.setProperty('--preview-width', `${width}px`);
    readyDocument.body.style.setProperty('--preview-scale', String(scale));
    document.querySelector('#preview-scale').textContent = `${Math.round(scale * 100)}%`;
    restore(saved);
  }
  function navigate(value) {
    const pages = sheets();
    if (!pages.length) return;
    const index = Math.max(0, Math.min(pages.length - 1, Math.round(Number(value) || 1) - 1));
    pageAtRest = index;
    frame.contentWindow.scrollTo(frame.contentWindow.scrollX, Math.max(0, pageTop(pages[index]) - 12));
    updatePages();
  }
  function previewOnly(enabled) {
    document.body.classList.toggle('preview-only', enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = enabled ? 'Show editor' : 'Preview only';
  }
  function escapePreview(event) {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]') && document.body.classList.contains('preview-only')) {
      previewOnly(false); toggle.focus();
    }
  }
  zoom.addEventListener('change', () => {
    const saved = position();
    // A partially visible page can start below the viewport. Zoom into that
    // page rather than magnifying the tail of the preceding page.
    applyZoom({ ...saved, offset: Math.max(0, saved.offset) });
  });
  previous.addEventListener('click', () => navigate(Number(pageInput.value) - 1));
  next.addEventListener('click', () => navigate(Number(pageInput.value) + 1));
  pageInput.addEventListener('change', () => navigate(pageInput.value));
  pageInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); navigate(pageInput.value); } });
  toggle.addEventListener('click', () => previewOnly(!document.body.classList.contains('preview-only')));
  document.addEventListener('keydown', escapePreview);
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => applyZoom());
  }).observe(frame);

  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc?.body || doc.documentElement.dataset.previewRevision !== String(pending?.revision)) return;
    readyDocument = doc; readyPath = pending.path;
    const style = doc.createElement('style');
    style.textContent = '@media screen { html { overflow-y: scroll; overflow-x: auto; scroll-behavior: auto; } body { display: flow-root; margin: 0 auto; padding: 0; width: var(--preview-width, auto); zoom: var(--preview-scale, 1); } .sheet { margin: 16px auto; } }';
    doc.head.append(style);
    doc.addEventListener('scroll', updatePages, { passive: true });
    doc.addEventListener('keydown', escapePreview);
    applyZoom(pending.position);
  });

  function setSplit(value) {
    const percent = Math.max(25, Math.min(75, Math.round(value)));
    root.style.setProperty('--editor-width', `${percent}%`);
    splitter.setAttribute('aria-valuenow', String(percent));
    splitter.setAttribute('aria-valuetext', `${percent}% editor, ${100 - percent}% preview`);
  }
  function drag(event) {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    const bounds = root.getBoundingClientRect();
    const styles = getComputedStyle(root);
    const left = Number.parseFloat(styles.paddingLeft);
    const width = bounds.width - left - Number.parseFloat(styles.paddingRight);
    setSplit((event.clientX - bounds.left - left) / width * 100);
  }
  splitter.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); splitter.focus(); splitter.setPointerCapture(event.pointerId);
  });
  splitter.addEventListener('pointermove', drag);
  splitter.addEventListener('pointerup', event => { if (splitter.hasPointerCapture(event.pointerId)) splitter.releasePointerCapture(event.pointerId); });
  splitter.addEventListener('dblclick', () => setSplit(47));
  splitter.addEventListener('keydown', event => {
    const value = Number(splitter.getAttribute('aria-valuenow'));
    const changes = { ArrowLeft: value - 2, ArrowRight: value + 2, Home: 25, End: 75 };
    if (!(event.key in changes)) return;
    event.preventDefault(); setSplit(changes[event.key]);
  });
  updatePages();

  return {
    showEditor() { previewOnly(false); },
    render(html, path) {
      const samePath = (pending?.path ?? readyPath) === path;
      const saved = samePath ? position() : { page: 0, offset: 0, left: 0, start: true };
      pending = { path, position: saved, revision: ++revision };
      // Ignore load events from a navigation replaced by a more recent render.
      frame.srcdoc = html.replace(/<html\b/i, `<html data-preview-revision="${revision}"`);
      updatePages();
    }
  };
}
