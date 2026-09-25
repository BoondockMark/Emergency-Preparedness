import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateAssetEntry } from '../scripts/lib/asset-validation.mjs';
import { escapeHtml, renderHandout, renderMarkdown } from '../scripts/lib/content-rendering.mjs';
import { discoverDocuments } from '../scripts/lib/filesystem-discovery.mjs';
import { generateBinderIndex } from '../scripts/lib/index-generation.mjs';
import { loadDocument, MetadataError } from '../scripts/lib/metadata.mjs';
import { formatLayoutIssue } from '../scripts/lib/layout-validation.mjs';
import { imageReferences, validateLocalLinks } from '../scripts/lib/page-validation.mjs';

const fixture = name => fs.readFile(new URL(`./unit-fixtures/${name}`, import.meta.url), 'utf8');

test('front matter fixture is loaded separately from content', async () => {
  const document = loadDocument(await fixture('front-matter.md'), 'front-matter.md');
  assert.equal(document.data.code, 'STH-001');
  assert.equal(document.content.trim(), 'Fixture body.');
});

test('handout code prefix must identify its binder section', async () => {
  const source = (await fixture('front-matter.md')).replace('code: STH-001', 'code: COM-001');
  assert.throws(
    () => loadDocument(source, 'wrong-section-code.md'),
    error => error instanceof MetadataError && /code: must use the STH prefix/.test(error.message)
  );
});

test('discovery derives canonical metadata for one-, two-, and three-page sources', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'handouts'));
  const base = (await fixture('front-matter.md')).replace('pageCount: 1\n', '');
  for (const count of [1, 2, 3]) {
    const body = Array.from({ length: count }, (_, index) => `Page ${index + 1}.`).join('\n<!-- pagebreak -->\n');
    const source = base
      .replace('code: STH-001', `code: STH-00${count}`)
      .replace('Fixture body.', body);
    await fs.writeFile(path.join(root, 'handouts', `${count}-pages.md`), source);
  }
  const documents = await discoverDocuments(root, new Map());
  assert.deepEqual(documents.map(({ meta }) => meta.pageCount), [1, 2, 3]);
  assert.deepEqual(documents[2].chunks.map(chunk => chunk.trim()), ['Page 1.', 'Page 2.', 'Page 3.']);
  assert.deepEqual(documents[2].chunkStartLines, [19, 21, 23]);
});

test('an optional declared pageCount must be a positive integer', async () => {
  const source = await fixture('front-matter.md');
  assert.equal(loadDocument(source.replace('pageCount: 1', 'pageCount: 3'), 'three-pages.md').data.pageCount, 3);
  for (const invalid of ['0', '-1', '1.5']) {
    assert.throws(
      () => loadDocument(source.replace('pageCount: 1', `pageCount: ${invalid}`), 'invalid-page-count.md'),
      error => error instanceof MetadataError && /pageCount: must be a positive integer when declared/.test(error.message)
    );
  }
});

test('a declared pageCount mismatch reports declared and derived values', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'page-count-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'handouts'));
  const source = (await fixture('front-matter.md'))
    .replace('pageCount: 1', 'pageCount: 2');
  await fs.writeFile(path.join(root, 'handouts/example.md'), source);
  await assert.rejects(
    discoverDocuments(root, new Map()),
    /pageCount: declared 2, derived 1 from page chunks/
  );
});

test('duplicate handout codes are rejected', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'duplicate-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'handouts'));
  const source = await fixture('front-matter.md');
  await Promise.all(['one.md', 'two.md'].map(name => fs.writeFile(path.join(root, 'handouts', name), source)));
  await assert.rejects(discoverDocuments(root, new Map()), /code: duplicates STH-001/);
});

test('local link fixture accepts existing files and rejects missing files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'link-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const htmlFile = path.join(root, 'page.html');
  const html = await fixture('local-links.html');
  await fs.writeFile(path.join(root, 'target.txt'), 'target');
  await validateLocalLinks(html, htmlFile, 'STH-001');
  await assert.rejects(validateLocalLinks('<a href="missing.txt">x</a>', htmlFile, 'STH-001'), /broken local link/);
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

test('overflow diagnostics identify Markdown and raw HTML source lines', () => {
  const markdown = renderMarkdown('AReallyLongUnbrokenValueThatCannotFit', {
    sourcePath: 'handouts/test.md', startLine: 17
  });
  const rawHtml = renderMarkdown('<div class="too-wide">Raw HTML</div>', {
    sourcePath: 'handouts/test.md', startLine: 24
  });
  assert.match(markdown, /<p data-source-path="handouts\/test\.md" data-source-line="17">/);
  assert.match(rawHtml, /<div data-source-path="handouts\/test\.md" data-source-line="24" class="too-wide">/);
  const issue = sourceLine => ({
    code: 'TST-001', page: 1, type: 'horizontal-overflow', selector: 'p',
    bounds: {}, region: {}, sourcePath: 'handouts/test.md', sourceLine
  });
  const markdownIssue = issue(17);
  const rawHtmlIssue = issue(24);
  assert.match(formatLayoutIssue(markdownIssue), /handouts\/test\.md:17.*long unbroken text/);
  assert.match(formatLayoutIssue(rawHtmlIssue), /handouts\/test\.md:24.*long unbroken text/);
});

test('vertical layout remediation recommends shortening content or a page break', () => {
  const message = formatLayoutIssue({
    code: 'TST-001', page: 1, type: 'footer-overlap', selector: 'p',
    bounds: {}, region: {}, sourcePath: 'handouts/test.md', sourceLine: 31
  });
  assert.match(message, /handouts\/test\.md:31.*Shorten the content or add a page break/);
});

test('handout pages use their section slot and show the document code', () => {
  const html = renderHandout('{{title}} {{cssPath}} {{pages}}', {
    meta: {
      code: 'EVS-001', title: 'Fixture', section: 'Evacuation & Shelter', sectionNumber: 3,
      status: 'draft', version: '1.0', lastReviewed: '2026-09-24', pageCount: 2
    },
    chunks: ['First page.', 'Second page.']
  });
  assert.equal((html.match(/style="--section-index: 2"/g) ?? []).length, 2);
  assert.equal((html.match(/>EVS-001<\/div>/g) ?? []).length, 2);
  assert.equal((html.match(/aria-label="EVS-001: Evacuation &amp; Shelter"/g) ?? []).length, 2);
});

test('continued handout pages use compact headings with fully escaped titles', () => {
  const html = renderHandout('{{title}} {{cssPath}} {{pages}}', {
    meta: {
      code: 'EVS-001', title: 'Prepare & <Leave>', section: 'Evacuation & Shelter', sectionNumber: 3,
      status: 'draft', version: '1.0', lastReviewed: '2026-09-24', pageCount: 4
    },
    chunks: ['First page.', 'Second page.', 'Third page.', 'Fourth page.']
  });
  assert.match(html, /<h1>Prepare &amp; &lt;Leave&gt;<\/h1>/);
  assert.equal((html.match(/<h1 class="title--compact">Prepare &amp; &lt;Leave&gt; — continued<\/h1>/g) ?? []).length, 3);
  assert.equal((html.match(/<article class="sheet front"/g) ?? []).length, 2);
  assert.equal((html.match(/<article class="sheet back"/g) ?? []).length, 2);
  assert.match(html, /<article class="sheet front"[\s\S]*?<span>3 of 4<\/span>/);
  assert.match(html, /<span>1 of 4<\/span>[\s\S]*?<article class="sheet back"[\s\S]*?<span>2 of 4<\/span>[\s\S]*?<article class="sheet front"[\s\S]*?<span>3 of 4<\/span>[\s\S]*?<article class="sheet back"[\s\S]*?<span>4 of 4<\/span>/);
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
  validateAssetEntry(JSON.parse(await fixture('image-metadata.json')), 'STH-001');
  assert.deepEqual(imageReferences('<img src="x.svg" alt="Route">', 'STH-001'), [{ src: 'x.svg', alt: 'Route' }]);
  assert.throws(() => imageReferences('<img src="x.svg">', 'STH-001'), /must have alt/);
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
  const index = generateBinderIndex([{ meta: meta('STH-020') }, { meta: meta('STH-003') }]);
  assert.ok(index.indexOf('| STH-003 |') < index.indexOf('| STH-020 |'));
});
