import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateAssetEntry } from '../scripts/lib/asset-validation.mjs';
import { escapeHtml, renderMarkdown } from '../scripts/lib/content-rendering.mjs';
import { discoverDocuments } from '../scripts/lib/filesystem-discovery.mjs';
import { generateBinderIndex } from '../scripts/lib/index-generation.mjs';
import { loadDocument, MetadataError } from '../scripts/lib/metadata.mjs';
import { imageReferences, validateLocalLinks } from '../scripts/lib/page-validation.mjs';

const fixture = name => fs.readFile(new URL(`./unit-fixtures/${name}`, import.meta.url), 'utf8');

test('front matter fixture is loaded separately from content', async () => {
  const document = loadDocument(await fixture('front-matter.md'), 'front-matter.md');
  assert.equal(document.data.code, 'TST-01');
  assert.equal(document.content.trim(), 'Fixture body.');
});

test('page break fixture produces two chunks during discovery', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'handouts'));
  const metadata = (await fixture('front-matter.md'))
    .replace('pageCount: 1', 'pageCount: 2')
    .replace('Fixture body.\n', await fixture('page-breaks.md'));
  await fs.writeFile(path.join(root, 'handouts/example.md'), metadata);
  const [document] = await discoverDocuments(root, new Map());
  assert.deepEqual(document.chunks.map(chunk => chunk.trim()), ['First page.', 'Second page.']);
});

test('duplicate handout codes are rejected', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'duplicate-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'handouts'));
  const source = await fixture('front-matter.md');
  await Promise.all(['one.md', 'two.md'].map(name => fs.writeFile(path.join(root, 'handouts', name), source)));
  await assert.rejects(discoverDocuments(root, new Map()), /code: duplicates TST-01/);
});

test('local link fixture accepts existing files and rejects missing files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'link-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const htmlFile = path.join(root, 'page.html');
  const html = await fixture('local-links.html');
  await fs.writeFile(path.join(root, 'target.txt'), 'target');
  await validateLocalLinks(html, htmlFile, 'TST-01');
  await assert.rejects(validateLocalLinks('<a href="missing.txt">x</a>', htmlFile, 'TST-01'), /broken local link/);
});

test('HTML escaping fixture covers publication-sensitive characters', async () => {
  const { input, expected } = JSON.parse(await fixture('html-escaping.json'));
  assert.equal(escapeHtml(input), expected);
});

test('component markup is preserved while Markdown is rendered', () => {
  const markup = '<aside class="warning"><strong>Leave now</strong></aside>';
  assert.equal(renderMarkdown(markup), `${markup}\n`);
  assert.equal(renderMarkdown('**Bold**'), '<p><strong>Bold</strong></p>');
});

test('approved content rejects unresolved approval placeholders', async () => {
  const approved = (await fixture('front-matter.md'))
    .replace('status: draft', 'status: approved')
    .replace('editor: Unassigned', 'editor: Editor One')
    .replace('subjectMatter: Unassigned', 'subjectMatter: Reviewer Two')
    .replace('Fixture body.', '[VERIFY local evacuation route]');
  assert.throws(
    () => loadDocument(approved, 'approval-placeholder.md'),
    error => error instanceof MetadataError && /body: contains sample text/.test(error.message)
  );
});

test('image metadata fixture validates and image markup requires alt text', async () => {
  validateAssetEntry(JSON.parse(await fixture('image-metadata.json')), 'TST-01');
  assert.deepEqual(imageReferences('<img src="x.svg" alt="Route">', 'TST-01'), [{ src: 'x.svg', alt: 'Route' }]);
  assert.throws(() => imageReferences('<img src="x.svg">', 'TST-01'), /must have alt/);
});

test('generated binder index orders codes consistently', () => {
  const meta = code => ({
    code,
    title: code,
    section: 'Start Here',
    status: 'draft',
    version: '1.0',
    lastReviewed: '2026-01-01',
    pageCount: 1
  });
  const index = generateBinderIndex([{ meta: meta('TST-20') }, { meta: meta('TST-03') }]);
  assert.ok(index.indexOf('| TST-03 |') < index.indexOf('| TST-20 |'));
});
