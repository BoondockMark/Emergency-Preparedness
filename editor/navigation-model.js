// Offsets always refer to the original source, including front matter and CRLF.
export function bodyStart(source) {
  const header = source.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return header ? header[0].length : /^---\r?\n/.test(source) ? source.length : 0;
}

export function documentOutline(source) {
  const headings = [], breaks = [];
  const start = bodyStart(source);
  let offset = start, line = source.slice(0, start).split('\n').length, page = 1;
  let comment = false, fence = '', broken = false;
  const stack = [];
  const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  for (const raw of source.slice(start).match(/[^\n]*\n|[^\n]+$/g) || []) {
    const text = raw.replace(/\r?\n$/, '');
    if (!comment && /^\s*<!--\s*pagebreak\s*-->\s*$/i.test(text)) {
      breaks.push({ start: offset, page }); page++;
      if (stack.length) broken = true;
    }
    const fenceMatch = !comment && text.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch && (!fence || fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)) {
      fence = fence ? '' : fenceMatch[1];
    } else if (!fence) {
      let clean = '', cursor = 0;
      while (cursor < text.length) {
        if (comment) {
          const end = text.indexOf('-->', cursor);
          const next = end < 0 ? text.length : end + 3;
          clean += ' '.repeat(next - cursor); cursor = next;
          if (end >= 0) comment = false;
        } else {
          const begin = text.indexOf('<!--', cursor);
          if (begin < 0) { clean += text.slice(cursor); break; }
          clean += text.slice(cursor, begin); cursor = begin; comment = true;
        }
      }
      if (!comment && !stack.some(tag => ['pre', 'code', 'script', 'style', 'textarea'].includes(tag))) {
        const markdown = clean.match(/^\s*(#{2,3})\s+(.+)$/);
        const html = clean.match(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/i);
        const match = markdown || html;
        if (match) headings.push({
          start: offset, line, page, level: markdown ? markdown[1].length : Number(html[1]),
          title: match[2].replace(/<[^>]*>/g, '').replace(/\*\*/g, '').replace(/\*/g, '').trim() || '(Untitled heading)',
          safe: !broken && !stack.length && (Boolean(markdown) || /^\s*<h[1-6]\b[^>]*>.*<\/h[1-6]\s*>\s*$/i.test(clean))
        });
      }
      // Ignore inline text when tracking containers. Malformed nesting disables moves.
      const tags = [...clean.matchAll(/<\/?([A-Za-z][\w-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/g)];
      const withoutTags = clean.replace(/<\/?([A-Za-z][\w-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/g, '');
      if (/<\/?[A-Za-z]/.test(withoutTags)) broken = true;
      for (const tag of tags) {
        const name = tag[1].toLowerCase();
        if (voidTags.has(name) || /\/\s*>$/.test(tag[0])) continue;
        if (tag[0].startsWith('</')) {
          if (stack.at(-1) === name) stack.pop();
          else broken = true;
        } else stack.push(name);
      }
    }
    offset += raw.length; line++;
  }
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const next = headings.slice(index + 1).find(item => item.page !== heading.page || item.level <= heading.level);
    const pageBreak = breaks.find(item => item.page === heading.page);
    heading.end = Math.min(next?.start ?? source.length, pageBreak?.start ?? source.length);
    heading.parent = headings.slice(0, index).reverse().find(item => item.page === heading.page && item.level < heading.level)?.start ?? null;
    // A section boundary must leave every HTML wrapper intact.
    if (next && next.start === heading.end && !next.safe) heading.safe = false;
    if (broken || stack.length || comment || fence) heading.safe = false;
  }
  return headings;
}

export function sectionEdit(source, start, action, headings = documentOutline(source)) {
  const heading = headings.find(item => item.start === start);
  if (!heading?.safe) throw Error('This section is inside HTML or has an uncertain boundary. Edit its structure in Source.');
  const section = source.slice(heading.start, heading.end);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const separated = text => text + (/\n\s*\n$/.test(text) ? '' : text.endsWith('\n') ? newline : newline + newline);
  if (action === 'duplicate') {
    if (/\bid\s*=/i.test(section)) throw Error('This section contains HTML IDs. Copy it in Source and give the copy unique IDs.');
    const copy = separated(section);
    const at = heading.start + copy.length;
    return { source: source.slice(0, heading.start) + copy + section + source.slice(heading.end), start: at, end: at + section.length };
  }
  const peers = headings.filter(item => item.page === heading.page && item.level === heading.level && item.parent === heading.parent);
  const peer = peers[peers.indexOf(heading) + (action === 'up' ? -1 : 1)];
  if (!['up', 'down'].includes(action) || !peer?.safe) throw Error('No movable sibling section in that direction on this page.');
  const first = action === 'up' ? peer : heading;
  const second = action === 'up' ? heading : peer;
  if (first.end !== second.start) throw Error('These sections do not share a safe boundary. Edit their structure in Source.');
  const secondText = separated(source.slice(second.start, second.end));
  const firstText = source.slice(first.start, first.end);
  const at = action === 'up' ? first.start : first.start + secondText.length;
  return { source: source.slice(0, first.start) + secondText + firstText + source.slice(second.end), start: at, end: at + section.length };
}

export function findMatches(source, query, { matchCase = false, wholeWord = false, allSource = false } = {}) {
  if (!query) return { matches: [], truncated: false };
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu');
  const start = allSource ? 0 : bodyStart(source);
  const matches = [];
  for (const match of source.slice(start).matchAll(pattern)) {
    const at = start + match.index;
    const before = Array.from(source.slice(Math.max(0, at - 2), at)).at(-1) || '';
    const after = String.fromCodePoint(source.codePointAt(at + match[0].length) || 0);
    if (wholeWord && (/[\p{L}\p{N}_]/u.test(before) || /[\p{L}\p{N}_]/u.test(after))) continue;
    if (matches.length === 10000) return { matches, truncated: true };
    matches.push({ start: at, end: at + match[0].length });
  }
  return { matches, truncated: false };
}

export function replaceMatches(source, matches, replacement) {
  let result = '', at = 0;
  for (const match of matches) { result += source.slice(at, match.start) + replacement; at = match.end; }
  return result + source.slice(at);
}
