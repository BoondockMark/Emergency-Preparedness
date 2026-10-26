export function selectionDetails(value, start, end = start) {
  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  return {
    line: before.split('\n').length,
    column: start - before.lastIndexOf('\n'),
    characters: value.length,
    words: (value.match(/\S+/g) || []).length,
    selected: selected.length
  };
}

export function prefixLines(value, start, end, prefix) {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const lineEndIndex = value.indexOf('\n', effectiveEnd);
  const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex;
  const replacement = value.slice(lineStart, lineEnd).split('\n').map(line => prefix + line).join('\n');
  return { start: lineStart, end: lineEnd, replacement, selectionStart: start + prefix.length, selectionEnd: end + prefix.length * replacement.split('\n').length };
}

export function indentSelection(value, start, end, unindent = false) {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const lineEndIndex = value.indexOf('\n', effectiveEnd);
  const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  let removedBeforeStart = 0;
  let totalDelta = 0;
  const replacement = lines.map((line, index) => {
    if (!unindent) { totalDelta += 2; return `  ${line}`; }
    const removed = line.startsWith('\t') ? 1 : Math.min(2, line.match(/^ */)[0].length);
    totalDelta -= removed;
    if (index === 0) removedBeforeStart = removed;
    return line.slice(removed);
  }).join('\n');
  return {
    start: lineStart, end: lineEnd, replacement,
    selectionStart: Math.max(lineStart, start + (unindent ? -removedBeforeStart : 2)),
    selectionEnd: Math.max(lineStart, end + totalDelta)
  };
}

export function handoutNeedsFixing(handout) {
  return handout.status !== 'approved' || handout.formatting !== 'valid';
}

export function handoutOptionLabel(handout) {
  const indicator = handout.formatting === 'error' ? '🔴' : handout.formatting === 'valid' ? '🟢' : handout.formatting === 'checking' ? '🟡' : handout.formatting === 'unavailable' ? '⚠️' : '⚪';
  const status = handout.status === 'approved' ? 'release' : handout.status;
  const formatting = handout.formatting === 'error' ? `formatting errors${Number.isInteger(handout.issueCount) ? ` (${handout.issueCount} issue${handout.issueCount === 1 ? '' : 's'})` : ''}`
    : handout.formatting === 'valid' ? 'formatting valid'
      : handout.formatting === 'checking' ? 'formatting check in progress'
        : handout.formatting === 'unavailable' ? 'formatting check unavailable' : 'formatting not checked';
  return `${indicator} ${handout.code} — ${handout.title} · ${status} · ${formatting}`;
}

export const HANDOUT_STATUSES = ['draft', 'under-review', 'approved'];

export function readHandoutStatus(source) {
  const frontMatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontMatter) return '';
  return frontMatter[1].match(/^status:\s*(draft|under-review|approved)\s*$/m)?.[1] || '';
}

export function setHandoutStatus(source, status) {
  if (!HANDOUT_STATUSES.includes(status)) return source;
  const frontMatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontMatter || !/^status:\s*.*$/m.test(frontMatter[1])) return source;
  const updated = frontMatter[0].replace(/^status:\s*.*$/m, `status: ${status}`);
  return updated + source.slice(frontMatter[0].length);
}

// Keep image operations tied to an exact occurrence, including repeated uses
// of the same asset and figures nested in authored component wrappers.
export function figureRanges(source) {
  return [...source.matchAll(/<figure\b[^>]*>[\s\S]*?<\/figure\s*>/gi)].map(match => {
    const start = match.index;
    const figureEnd = start + match[0].length;
    const clear = source.slice(figureEnd).match(/^\s*<div\s+class=["']figure-clear["']\s*>\s*<\/div>/i);
    const end = figureEnd + (clear?.[0].length || 0);
    const file = match[0].match(/\bsrc\s*=\s*["']\.\.\/assets\/handouts\/[^/]+\/([^"'?#]+)["']/i)?.[1];
    return { start, end, figureEnd, text: source.slice(start, end), file };
  });
}

export function figureAtOffset(source, offset) {
  return figureRanges(source).find(figure => offset >= figure.start && offset < figure.end) || null;
}

// Replace only named top-level fields; preserve the body and unrelated metadata verbatim.
export function updateMetadataFields(source, fields) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw Error('Missing front matter');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const scalar = value => {
    if (/[\r\n]/.test(String(value))) throw Error('Metadata fields must fit on one line.');
    return typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(String(value ?? ''));
  };
  const serialize = (value, indent) => {
    const pad = ' '.repeat(indent);
    if (Array.isArray(value)) return value.map(item => {
      const lines = serialize(item, indent + 2).split(newline);
      return pad + '- ' + lines[0].slice(indent + 2) + (lines.length > 1 ? newline + lines.slice(1).join(newline) : '');
    }).join(newline);
    return Object.entries(value).map(([key, entry]) => {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) throw Error('Unsupported metadata field');
      return entry && typeof entry === 'object' ? `${pad}${key}:${newline}${serialize(entry, indent + 2)}` : `${pad}${key}: ${scalar(entry)}`;
    }).join(newline);
  };
  let header = match[1];
  for (const [key, value] of Object.entries(fields)) {
    const replacement = serialize({ [key]: value }, 0);
    const pattern = new RegExp(`^${key}:[^\\r\\n]*(?:\\r?\\n(?![A-Za-z][A-Za-z0-9]*:)[^\\r\\n]*)*`, 'm');
    header = pattern.test(header) ? header.replace(pattern, block => {
      const trailing = block.match(/(?:\r?\n(?:[ \t]*|#[^\r\n]*))+$/)?.[0] || '';
      return replacement + trailing;
    }) : header + newline + replacement;
  }
  return `---${newline}${header}${newline}---${newline}` + source.slice(match[0].length);
}

export class EditHistory {
  constructor(value = '') { this.reset(value); }
  reset(value) { this.entries = [value]; this.index = 0; this.lastTyped = 0; }
  record(value, typing = false, now = Date.now()) {
    if (value === this.entries[this.index]) return;
    const merge = typing && this.lastTyped && now - this.lastTyped < 750 && this.index === this.entries.length - 1 && this.index > 0;
    this.entries.splice(this.index + 1);
    if (merge) this.entries[this.index] = value;
    else { this.entries.push(value); this.index++; }
    if (this.entries.length > 150) { this.entries.shift(); this.index--; }
    this.lastTyped = typing ? now : 0;
  }
  undo() { this.lastTyped = 0; if (this.index > 0) this.index--; return this.entries[this.index]; }
  redo() { this.lastTyped = 0; if (this.index + 1 < this.entries.length) this.index++; return this.entries[this.index]; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index + 1 < this.entries.length; }
}
