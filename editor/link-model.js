import { bodyStart } from './navigation-model.js';

export function checkedLinkUrl(value) {
  const url = value.trim().replace(/\*/g, '%2A');
  if (!url) throw Error('Enter a link address.');
  if (/[\u0000-\u0020\u007f-\u009f\\]/u.test(url) || /%(?![\da-f]{2})/i.test(url)) throw Error('Remove spaces, control characters, or malformed escapes from the address.');
  if (/^https?:\/\//i.test(url)) {
    let parsed;
    try { parsed = new URL(url); } catch { throw Error('Enter a complete HTTP or HTTPS address, including its host.'); }
    if (!parsed.hostname || parsed.username || parsed.password) throw Error('Use a web address with a host and without a username or password.');
    return url;
  }
  if (/^mailto:[^@\s<>"(),:;?]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?:\?[^\s]*)?$/i.test(url)) return url;
  if (/^tel:\+?[\d().-]+$/i.test(url) && /\d/.test(url.slice(4))) return url;
  if (/^(?:#.+|\.\.?\/[^\s]*|\/(?!\/)[^\s]*)$/u.test(url)) return url;
  throw Error('Use https://, http://, mailto:, tel:, #anchor, or a path starting with /, ./, or ../. Other link types are not allowed.');
}

// Numeric asterisks avoid the renderer interpreting URL or label text as emphasis.
export function escapeLinkText(value) {
  return String(value).replace(/[&<>"'*|]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '*': '&#42;', '|': '&#124;' })[character]);
}

const tagPattern = /<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z][\w-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/g;
export function sourceLinks(source) {
  const start = bodyStart(source), links = [], protectedRanges = [];
  const body = source.slice(start);
  // Treat fenced examples as source, even though they are not an editor format.
  let fence;
  for (const match of body.matchAll(/^\s*(`{3,}|~{3,})[^\n]*(?:\n|$)/gm)) {
    if (!fence) fence = { start: start + match.index, marker: match[1] };
    else if (match[1][0] === fence.marker[0] && match[1].length >= fence.marker.length) {
      protectedRanges.push({ start: fence.start, end: start + match.index + match[0].length }); fence = undefined;
    }
  }
  if (fence) protectedRanges.push({ start: fence.start, end: source.length });
  let anchor, raw;
  for (const match of body.matchAll(tagPattern)) {
    const at = start + match.index, end = at + match[0].length;
    if (protectedRanges.some(range => at >= range.start && at < range.end)) continue;
    const tag = match[0];
    if (tag.startsWith('<!--')) { protectedRanges.push({ start: at, end }); continue; }
    const name = tag.match(/^<\/?([\w-]+)/)[1].toLowerCase();
    const closing = tag.startsWith('</');
    if (raw) {
      if (closing && name === raw.name) { protectedRanges.push({ start: raw.start, end }); raw = undefined; }
      continue;
    }
    if (!closing && ['script', 'style', 'pre', 'code', 'textarea'].includes(name)) { raw = { name, start: at }; continue; }
    protectedRanges.push({ start: at, end });
    if (name !== 'a') continue;
    if (!closing) {
      if (anchor) anchor.invalid = true;
      else anchor = { start: at, openEnd: end };
    } else if (anchor) {
      if (!anchor.invalid) links.push({ ...anchor, closeStart: at, end });
      else protectedRanges.push({ start: anchor.start, end });
      anchor = undefined;
    }
  }
  if (anchor) protectedRanges.push({ start: anchor.start, end: source.length });
  if (raw) protectedRanges.push({ start: raw.start, end: source.length });
  return { links, protectedRanges };
}

export function sourceLinkSelection(source, start, end) {
  const { links, protectedRanges } = sourceLinks(source);
  const existing = links.find(link => start >= link.start && end <= link.end && start < link.end);
  if (existing) return existing;
  if (start < bodyStart(source)) throw Error('Place the cursor in the handout body first.');
  if (source.lastIndexOf('<', Math.max(0, start - 1)) > source.lastIndexOf('>', Math.max(0, start - 1))) throw Error('The cursor is inside incomplete HTML. Correct it directly in Source first.');
  if (links.some(link => start < link.end && end > link.start) || protectedRanges.some(range => start > range.start && start < range.end || end > range.start && end < range.end || start <= range.start && end >= range.end)) throw Error('Select plain text outside HTML tags, existing links, comments, and code examples.');
  if (/[\r\n<>]/.test(source.slice(start, end))) throw Error('Select text within a single line. Use Source directly for complex markup.');
  return null;
}

function hrefAttribute(opening) {
  const attributes = [...opening.matchAll(/\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)];
  const existing = attributes.filter(match => match[1].toLowerCase() === 'href');
  if (existing.length > 1) throw Error('This link has repeated href attributes. Correct it directly in Source.');
  return existing[0];
}

export function linkOpeningWithoutUrl(opening) {
  const match = hrefAttribute(opening);
  return match ? opening.slice(0, match.index) + opening.slice(match.index + match[0].length) : opening;
}

export function linkOpeningWithUrl(opening, value) {
  const href = checkedLinkUrl(value), match = hrefAttribute(opening);
  const attribute = ` href="${escapeLinkText(href)}"`;
  if (!match) return opening.replace(/\s*>$/, attribute + '>');
  return opening.slice(0, match.index) + attribute + opening.slice(match.index + match[0].length);
}
