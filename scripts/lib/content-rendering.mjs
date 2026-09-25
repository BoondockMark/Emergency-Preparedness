export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]
  );
}

function inlineMarkdown(source) {
  return source
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

const sourceAttributes = (sourcePath, line) => sourcePath
  ? ` data-source-path="${escapeHtml(sourcePath)}" data-source-line="${line}"`
  : '';

function annotateAuthorHtml(rawLine, sourcePath, line) {
  if (!sourcePath || /^\s*<\//.test(rawLine)) return rawLine;
  return rawLine.replace(/^(\s*<[A-Za-z][^\s/>]*)/, `$1${sourceAttributes(sourcePath, line)}`);
}

export function renderMarkdown(source, { sourcePath, startLine = 1 } = {}) {
  let output = '';
  let list = null;

  for (const [index, rawLine] of source.split('\n').entries()) {
    const sourceLine = startLine + index;
    const attributes = sourceAttributes(sourcePath, sourceLine);
    const line = rawLine.trim();
    if (!line) {
      if (list) output += `</${list}>`;
      list = null;
      continue;
    }
    if (line.startsWith('<') || line.startsWith('</')) {
      output += `${annotateAuthorHtml(rawLine, sourcePath, sourceLine)}\n`;
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      if (list) output += `</${list}>`;
      list = null;
      const level = heading[1].length;
      output += `<h${level}${attributes}>${inlineMarkdown(heading[2])}</h${level}>`;
      continue;
    }
    const item = line.match(/^[-*]\s+(.*)$/);
    if (item) {
      if (list !== 'ul') {
        if (list) output += `</${list}>`;
        output += `<ul${attributes}>`;
        list = 'ul';
      }
      output += `<li${attributes}>${inlineMarkdown(item[1])}</li>`;
      continue;
    }
    output += `<p${attributes}>${inlineMarkdown(line)}</p>`;
  }
  if (list) output += `</${list}>`;
  return output;
}

export function renderHandout(template, document) {
  const { meta, chunks, sourcePath, chunkStartLines = [] } = document;
  const pages = chunks.map((chunk, index) => `
<article class="sheet ${index % 2 === 0 ? 'front' : 'back'}" style="--section-index: ${meta.sectionNumber - 1}">
  <div class="edge" aria-label="${escapeHtml(meta.code)}: ${escapeHtml(meta.section)}">${escapeHtml(meta.code)}</div>
  <main class="content">
    <header class="kicker">La Habra Heights Fire Watch · Emergency Preparedness Binder <span class="status">${escapeHtml(meta.status.toUpperCase())}</span></header>
    <h1${index ? ' class="title--compact"' : ''}>${escapeHtml(index ? `${meta.title} — continued` : meta.title)}</h1>
    ${renderMarkdown(chunk, { sourcePath, startLine: chunkStartLines[index] ?? 1 })}
    <footer class="footer">
      <span>${escapeHtml(meta.code)} · v${escapeHtml(meta.version)}</span>
      <span>Last reviewed: ${escapeHtml(meta.lastReviewed)}</span>
      <span>${index + 1} of ${meta.pageCount}</span>
    </footer>
  </main>
</article>`).join('');

  return template
    .replace('{{title}}', escapeHtml(meta.title))
    .replace('{{cssPath}}', '../assets/print.css')
    .replace('{{pages}}', pages);
}
