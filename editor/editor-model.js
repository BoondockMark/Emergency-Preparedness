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
