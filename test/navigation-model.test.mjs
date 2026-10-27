import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyStart, documentOutline, sectionEdit, findMatches, replaceMatches } from '../editor/navigation-model.js';

const header = '---\r\ntitle: Example\r\nstatus: draft\r\n---\r\n';

test('outline maps Markdown and HTML headings to exact lines and ignores metadata, comments and code', () => {
  const source = header + '## First\r\nText\r\n### Child\r\n<!--\r\n## Hidden\r\n-->\r\n```\r\n## Code\r\n```\r\n<!-- pagebreak -->\r\n<h2>Second <em>page</em></h2>\r\n<div>\r\n<h3>Nested</h3>\r\n</div>\r\n';
  const outline = documentOutline(source);
  assert.equal(bodyStart(source), header.length);
  assert.deepEqual(outline.map(item => [item.title, item.line, item.page, item.safe]), [
    ['First', 5, 1, true], ['Child', 7, 1, true], ['Second page', 15, 2, true], ['Nested', 17, 2, false]
  ]);
  for (const item of outline) assert.equal(source.slice(item.start).split(/\r?\n/)[0].includes(item.title.split(' ')[0]), true);
});

test('section moves preserve subheadings, metadata, images and page boundaries', () => {
  const prefix = header + 'Introduction\r\n\r\n';
  const a = '## A\r\nText\r\n### A child\r\n<figure><img src="a.png"></figure>\r\n\r\n';
  const b = '<h2>B</h2>\r\nText B\r\n\r\n';
  const suffix = '<!-- pagebreak -->\r\n## C\r\nLast';
  const source = prefix + a + b + suffix;
  const moved = sectionEdit(source, prefix.length, 'down');
  assert.equal(moved.source, prefix + b + a + suffix);
  assert.equal(moved.start, prefix.length + b.length);
  assert.equal(sectionEdit(moved.source, moved.start, 'up').source, source);
  const duplicate = sectionEdit(source, prefix.length, 'duplicate');
  assert.equal(duplicate.source, prefix + a + a + b + suffix);
  assert.throws(() => sectionEdit(source, source.indexOf('## C'), 'up'), /sibling/);
  assert.throws(() => sectionEdit(source, source.indexOf('### A'), 'down'), /sibling/);
});

test('section controls reject nested, malformed and ID-bearing HTML and separate EOF headings', () => {
  for (const source of ['<div>\n<h2>Nested</h2>\n</div>\n', '## A\n<div>\n## B\n', '## A\n</aside>\n## B']) {
    assert.throws(() => sectionEdit(source, documentOutline(source)[0].start, 'duplicate'), /uncertain/);
  }
  assert.throws(() => sectionEdit('## A\n<p id="anchor">Text</p>', 0, 'duplicate'), /unique IDs/);
  assert.equal(sectionEdit('## A\nText A\n\n## B\nText B', 0, 'down').source, '## B\nText B\n\n## A\nText A\n\n');
});

test('literal find uses exact Unicode offsets, case and word filters, and excludes metadata by default', () => {
  const source = header + 'Example example examples préexample exampleé EXAMPLE [$] 😀example';
  assert.equal(findMatches(source, 'example').matches.length, 7);
  assert.equal(findMatches(source, 'example', { wholeWord: true }).matches.length, 4);
  assert.equal(findMatches(source, 'example', { matchCase: true, wholeWord: true }).matches.length, 2);
  assert.equal(findMatches(source, 'Example', { allSource: true }).matches.length, 8);
  const matches = findMatches(source, '[$]').matches;
  assert.equal(matches.length, 1);
  assert.equal(replaceMatches(source, matches, '$&$1'), source.replace('[$]', () => '$&$1'));
  assert.equal(findMatches(source, '').matches.length, 0);
  assert.equal(findMatches('a'.repeat(10001), 'a').truncated, true);
});
