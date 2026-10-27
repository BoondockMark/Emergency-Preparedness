const lines = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];

// Bound the LCS table. Large, heavily changed sections become conservative
// replacement blocks rather than consuming quadratic memory in the browser.
export function diffLines(before, after) {
  const a = lines(before); const b = lines(after);
  let prefix = 0; let suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const old = a.slice(prefix, a.length - suffix); const next = b.slice(prefix, b.length - suffix);
  const operations = a.slice(0, prefix).map(text => ({ type: 'equal', text }));
  const coarse = (old.length + 1) * (next.length + 1) > 1_000_000;
  if (coarse) {
    for (const text of old) operations.push({ type: 'remove', text });
    for (const text of next) operations.push({ type: 'add', text });
  } else {
    const width = next.length + 1;
    const table = new Uint32Array((old.length + 1) * width);
    for (let i = old.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--) {
      table[i * width + j] = old[i] === next[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
    let i = 0; let j = 0;
    while (i < old.length || j < next.length) {
      if (i < old.length && j < next.length && old[i] === next[j]) { operations.push({ type: 'equal', text: old[i++] }); j++; }
      else if (i < old.length && (j === next.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) operations.push({ type: 'remove', text: old[i++] });
      else operations.push({ type: 'add', text: next[j++] });
    }
  }
  for (const text of a.slice(a.length - suffix)) operations.push({ type: 'equal', text });
  const changes = []; let change; let oldLine = 1; let newLine = 1;
  const rows = operations.map(operation => {
    const row = { ...operation, oldLine: operation.type === 'add' ? null : oldLine, newLine: operation.type === 'remove' ? null : newLine };
    if (operation.type === 'equal') { if (change) { changes.push(change); change = undefined; } oldLine++; newLine++; }
    else {
      change ??= { start: oldLine - 1, end: oldLine - 1, lines: [] };
      if (operation.type === 'remove') change.end = oldLine++;
      else { change.lines.push(operation.text); newLine++; }
    }
    return row;
  });
  if (change) changes.push(change);
  return { rows, changes, coarse };
}

function overlaps(a, b) {
  if (a.start === a.end || b.start === b.end) return a.start <= b.end && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}

export function mergeText(base, yours, disk) {
  if (base === undefined) {
    return { segments: yours === disk ? [{ text: yours }] : [{ conflict: 0, startLine: 1, base: '', yours, disk }], conflicts: yours === disk ? 0 : 1, coarse: false, unknownBase: true };
  }
  const original = lines(base);
  const local = diffLines(base, yours); const remote = diffLines(base, disk);
  const edits = [...local.changes.map(change => ({ ...change, side: 'yours' })), ...remote.changes.map(change => ({ ...change, side: 'disk' }))].sort((a, b) => a.start - b.start || a.end - b.end);
  const groups = [];
  for (const edit of edits) {
    const last = groups.at(-1);
    if (last?.some(item => overlaps(item, edit))) last.push(edit); else groups.push([edit]);
  }
  const segments = []; let cursor = 0; let conflicts = 0;
  for (const group of groups) {
    const start = Math.min(...group.map(edit => edit.start)); const end = Math.max(...group.map(edit => edit.end));
    segments.push({ text: original.slice(cursor, start).join('') });
    const project = side => {
      let position = start; const parts = [];
      for (const edit of group.filter(edit => edit.side === side)) {
        parts.push(original.slice(position, edit.start).join(''), edit.lines.join('')); position = edit.end;
      }
      return parts.join('') + original.slice(position, end).join('');
    };
    const oldText = original.slice(start, end).join('');
    const localText = project('yours'); const diskText = project('disk');
    if (localText === diskText) segments.push({ text: localText });
    else if (localText === oldText) segments.push({ text: diskText });
    else if (diskText === oldText) segments.push({ text: localText });
    else segments.push({ conflict: conflicts++, startLine: start + 1, base: oldText, yours: localText, disk: diskText });
    cursor = end;
  }
  segments.push({ text: original.slice(cursor).join('') });
  return { segments, conflicts, coarse: local.coarse || remote.coarse, unknownBase: false };
}

export function resolveMerge(plan, choices = {}) {
  const unresolved = plan.segments.filter(segment => segment.conflict !== undefined && !['yours', 'disk'].includes(choices[segment.conflict]));
  return { remaining: unresolved.length, source: unresolved.length ? null : plan.segments.map(segment => segment.conflict === undefined ? segment.text : segment[choices[segment.conflict]]).join('') };
}
