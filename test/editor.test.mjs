import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { renderHandout, parseHandoutSource, renderHandoutSource } from '../scripts/lib/content-rendering.mjs';
import { createEditorServer } from '../scripts/lib/editor-server.mjs';
import { prepareDocumentValidation } from '../scripts/lib/artifact-generation.mjs';

const repository = path.resolve(import.meta.dirname, '..');
const fixture = () => fs.readFile(path.join(repository, 'test/unit-fixtures/front-matter.md'), 'utf8');

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'handout-editor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const directory of ['handouts/section', 'templates', 'editor', 'assets/styles']) await fs.mkdir(path.join(root, directory), { recursive: true });
  const source = (await fixture()).replace('Fixture body.', '<div class="custom">Keep **raw** HTML</div>\n\nFirst page.\n<!-- pagebreak -->\nSecond page.').replace('pageCount: 1', 'pageCount: 2');
  await fs.writeFile(path.join(root, 'handouts/section/example.md'), source);
  await fs.copyFile(path.join(repository, 'templates/handout.html'), path.join(root, 'templates/handout.html'));
  for (const name of ['index.html', 'editor.js', 'editor.css']) await fs.copyFile(path.join(repository, 'editor', name), path.join(root, 'editor', name));
  await fs.copyFile(path.join(repository, 'assets/styles/print.css'), path.join(root, 'assets/styles/print.css'));
  await fs.cp(path.join(repository, 'assets/fonts'), path.join(root, 'assets/fonts'), { recursive: true });
  const server = await createEditorServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { root, source, base: `http://127.0.0.1:${server.address().port}`, file: path.join(root, 'handouts/section/example.md') };
}

test('editor rejects traversal and only opens discovered markdown paths', async t => {
  const { base } = await setup(t);
  for (const attempted of ['../package.json', 'handouts/../templates/handout.html', '/etc/passwd']) {
    const response = await fetch(`${base}/api/handout?path=${encodeURIComponent(attempted)}`);
    assert.equal(response.status, 404);
  }
});

test('validation returns structured metadata errors for an unsaved buffer', async () => {
  const template = await fs.readFile(path.join(repository, 'templates/handout.html'), 'utf8');
  const result = prepareDocumentValidation({ source: 'not front matter', sourcePath: 'handouts/example.md', template });
  assert.equal(result.issues.length, 1);
  assert.deepEqual({ severity: result.issues[0].severity, type: result.issues[0].type, sourcePath: result.issues[0].sourcePath }, {
    severity: 'error', type: 'metadata', sourcePath: 'handouts/example.md'
  });
});

test('browser validation reports simultaneous, source-mapped layout and accessibility findings', async t => {
  const { base, source } = await setup(t);
  const body = `${source}\n## Skipped heading\n<h3 style="font-size:4pt;color:#eee">Tiny pale text</h3>\n${'<p>Overflow content</p>\n'.repeat(180)}`;
  const response = await fetch(`${base}/api/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'handouts/section/example.md', source: body, phase: 'layout', session: 'test' }) });
  const responseBody = await response.text();
  if (response.status === 422 && /Could not find Chrome/.test(responseBody)) return t.skip('Puppeteer browser is not installed');
  assert.equal(response.status, 200, responseBody);
  const result = JSON.parse(responseBody);
  assert.equal(result.valid, false);
  assert.ok(result.issues.length > 1);
  assert.ok(result.issues.some(issue => issue.bounds && issue.sourceLine && issue.printableRegionBounds));
  assert.ok(result.issues.some(issue => ['minimum-text-size', 'text-contrast', 'heading-order'].includes(issue.type) && issue.sourceLine));
});

test('layout CLI preserves a nonzero exit for invalid requests', () => {
  const result = spawnSync(process.execPath, ['scripts/lint-layout.mjs', 'NOT-999'], { cwd: repository, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown handout code/);
});

test('editor open/save round trip is atomic and stale writes are rejected', async t => {
  const { base, file } = await setup(t);
  const opened = await (await fetch(`${base}/api/handout?path=handouts%2Fsection%2Fexample.md`)).json();
  const changed = `${opened.source}\n`;
  const saved = await fetch(`${base}/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...opened, source: changed }) });
  assert.equal(saved.status, 200);
  assert.equal(await fs.readFile(file, 'utf8'), changed);
  const stale = await fetch(`${base}/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opened) });
  assert.equal(stale.status, 409);
  assert.deepEqual((await fs.readdir(path.dirname(file))).filter(name => name.endsWith('.tmp')), []);
});

test('front matter, custom HTML, and page breaks survive the canonical editor parse', async () => {
  const source = (await fixture()).replace('Fixture body.', '<widget data-x="1">Raw</widget>\n<!-- pagebreak -->\nNext.').replace('pageCount: 1', 'pageCount: 2');
  const document = parseHandoutSource(source, 'handouts/example.md');
  assert.equal(document.meta.title, 'Fixture');
  assert.equal(document.chunks.length, 2);
  assert.match(document.chunks[0], /<widget data-x="1">Raw<\/widget>/);
  assert.equal(source.includes('---\ncode:'), true);
});

test('editor preview HTML has exact parity with build rendering', async t => {
  const { base, source } = await setup(t);
  const template = await fs.readFile(path.join(repository, 'templates/handout.html'), 'utf8');
  const buildHtml = renderHandout(template, parseHandoutSource(source, 'handouts/section/example.md'));
  const directHtml = renderHandoutSource(template, source, { sourcePath: 'handouts/section/example.md' });
  assert.equal(directHtml, buildHtml);
  const response = await fetch(`${base}/api/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'handouts/section/example.md', source }) });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), buildHtml.replace('../assets/print.css', '/assets/styles/print.css'));
});
