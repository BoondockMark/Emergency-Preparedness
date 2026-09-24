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

export function renderMarkdown(source) {
  let output = '';
  let list = null;

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (list) output += `</${list}>`;
      list = null;
      continue;
    }
    if (line.startsWith('<') || line.startsWith('</')) {
      output += `${rawLine}\n`;
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      if (list) output += `</${list}>`;
      list = null;
      const level = heading[1].length;
      output += `<h${level}>${inlineMarkdown(heading[2])}</h${level}>`;
      continue;
    }
    const item = line.match(/^[-*]\s+(.*)$/);
    if (item) {
      if (list !== 'ul') {
        if (list) output += `</${list}>`;
        output += '<ul>';
        list = 'ul';
      }
      output += `<li>${inlineMarkdown(item[1])}</li>`;
      continue;
    }
    output += `<p>${inlineMarkdown(line)}</p>`;
  }
  if (list) output += `</${list}>`;
  return output;
}

export function renderHandout(template, document) {
  const { meta, chunks } = document;
  const pages = chunks.map((chunk, index) => `
<article class="sheet ${index ? 'back' : 'front'}" style="--section-index: ${meta.sectionNumber - 1}">
  <div class="edge" aria-label="${escapeHtml(meta.code)}: ${escapeHtml(meta.section)}">${escapeHtml(meta.code)}</div>
  <main class="content">
    <header class="kicker">La Habra Heights Fire Watch · Emergency Preparedness Binder <span class="status">${escapeHtml(meta.status.toUpperCase())}</span></header>
    <h1>${escapeHtml(index ? `${meta.title} — continued` : meta.title)}</h1>
    ${renderMarkdown(chunk)}
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
