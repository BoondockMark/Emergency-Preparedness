import assert from 'node:assert/strict';
import test from 'node:test';
import { diffLines, mergeText, resolveMerge } from '../editor/change-model.js';

test('line diffs retain exact newline bytes, line numbers, insertions, and deletions', () => {
  const result = diffLines('one\r\ntwo\r\nlast', 'one\r\nTWO\r\nlast\nextra');
  assert.equal(result.rows.filter(row => row.type !== 'add').map(row => row.text).join(''), 'one\r\ntwo\r\nlast');
  assert.equal(result.rows.filter(row => row.type !== 'remove').map(row => row.text).join(''), 'one\r\nTWO\r\nlast\nextra');
  assert.equal(result.rows[0].oldLine, 1); assert.equal(result.rows[0].newLine, 1);
  assert.deepEqual(diffLines('', 'new').changes, [{ start: 0, end: 0, lines: ['new'] }]);
  assert.deepEqual(diffLines('old', '').changes, [{ start: 0, end: 1, lines: [] }]);
});

test('three-way merge combines independent edits and deduplicates identical changes', () => {
  const base = 'title\nfirst\nsecond\nlast\n';
  const plan = mergeText(base, 'title\nFIRST\nsecond\nlast\n', 'title\nfirst\nSECOND\nlast\n');
  assert.equal(plan.conflicts, 0);
  assert.equal(resolveMerge(plan).source, 'title\nFIRST\nSECOND\nlast\n');
  const identical = mergeText(base, base + 'same\n', base + 'same\n');
  assert.equal(identical.conflicts, 0);
  assert.equal(resolveMerge(identical).source, base + 'same\n');
  assert.equal(resolveMerge(mergeText(base, '', base)).source, '');
  assert.equal(resolveMerge(mergeText(base, base, '')).source, '');
});

test('overlapping replacements and ambiguous insertions require explicit choices without conflict markers', () => {
  const plan = mergeText('a\nb\nc\n', 'a\nours\nc\n', 'a\ntheirs\nc\n');
  assert.equal(plan.conflicts, 1);
  assert.deepEqual(resolveMerge(plan), { remaining: 1, source: null });
  assert.equal(resolveMerge(plan, { 0: 'yours' }).source, 'a\nours\nc\n');
  assert.equal(resolveMerge(plan, { 0: 'disk' }).source, 'a\ntheirs\nc\n');
  assert.equal(resolveMerge(plan, { 0: 'both' }).source, null);
  const insertion = mergeText('a\nb\n', 'a\ninsert\nb\n', 'A\nb\n');
  assert.equal(insertion.conflicts, 1, 'Insertion at the boundary of a changed line is conservative');
});

test('unknown saved baselines require explicit review and large changes use bounded replacement blocks', () => {
  const legacy = mergeText(undefined, 'browser draft', 'disk text');
  assert.equal(legacy.unknownBase, true); assert.equal(legacy.conflicts, 1);
  assert.equal(resolveMerge(legacy).source, null);
  assert.equal(resolveMerge(legacy, { 0: 'yours' }).source, 'browser draft');
  const before = Array.from({ length: 1200 }, (_, index) => `old ${index}\n`).join('');
  const after = before.replaceAll('old', 'new');
  const diff = diffLines(before, after);
  assert.equal(diff.coarse, true);
  assert.equal(resolveMerge(mergeText(before, after, before)).source, after);
  assert.equal(mergeText(before, after, before.replaceAll('old', 'other')).conflicts, 1);
});
