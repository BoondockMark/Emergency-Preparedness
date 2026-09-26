import { loadDocument } from './metadata.mjs';
import { validateImages } from './page-validation.mjs';

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

function tableCells(line) {
  const content = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cell = '';
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\\' && content[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (content[index] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += content[index];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isTableDivider(line, columns) {
  if (!line?.includes('|')) return false;
  const cells = tableCells(line);
  return cells.length === columns && cells.every(cell => /^:?-{3,}:?$/.test(cell));
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
  const lines = source.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
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
    const headerCells = line.includes('|') ? tableCells(line) : [];
    if (headerCells.length > 1 && isTableDivider(lines[index + 1]?.trim(), headerCells.length)) {
      if (list) output += `</${list}>`;
      list = null;
      output += `<table${attributes}><thead><tr>`;
      output += headerCells.map(cell => `<th scope="col"${attributes}>${inlineMarkdown(cell)}</th>`).join('');
      output += '</tr></thead><tbody>';
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        const rowAttributes = sourceAttributes(sourcePath, startLine + index);
        const cells = tableCells(lines[index]);
        if (cells.length !== headerCells.length) break;
        output += `<tr${rowAttributes}>${cells.map(cell => `<td${rowAttributes}>${inlineMarkdown(cell)}</td>`).join('')}</tr>`;
        index += 1;
      }
      output += '</tbody></table>';
      index -= 1;
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

/** Parse a complete handout source exactly as the build does. */
export function parseHandoutSource(source, sourcePath, manifests = new Map()) {
  const { data: meta, content, contentStartLine } = loadDocument(source, sourcePath);
  const chunks = content.split(/\n<!--\s*pagebreak\s*-->\n/i);
  const chunkStartLines = [];
  let cursor = contentStartLine;
  for (const chunk of chunks) {
    chunkStartLines.push(cursor);
    cursor += (chunk.match(/\n/g) ?? []).length + 2;
  }
  const declaredPageCount = meta.pageCount;
  if (declaredPageCount !== undefined && declaredPageCount !== chunks.length) {
    throw Error(`${sourcePath}: pageCount: declared ${declaredPageCount}, derived ${chunks.length} from page chunks`);
  }
  meta.pageCount = chunks.length;
  validateImages(content, meta.code, manifests);
  return { meta, chunks, chunkStartLines, sourcePath };
}

export function renderHandoutSource(template, source, { sourcePath, manifests = new Map() } = {}) {
  return renderHandout(template, parseHandoutSource(source, sourcePath, manifests));
}
