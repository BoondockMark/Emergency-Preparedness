import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer';
import { renderHandout, parseHandoutSource, renderHandoutSource } from '../scripts/lib/content-rendering.mjs';
import { createEditorServer } from '../scripts/lib/editor-server.mjs';
import { browserOptions, prepareDocumentValidation } from '../scripts/lib/artifact-generation.mjs';
import { figureMarkup, safeAssetName } from '../scripts/lib/editor-support.mjs';
import { indentSelection, prefixLines, selectionDetails } from '../editor/editor-model.js';

const repository = path.resolve(import.meta.dirname, '..');
const fixture = () => fs.readFile(path.join(repository, 'test/unit-fixtures/front-matter.md'), 'utf8');

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'handout-editor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const directory of ['handouts/section', 'templates', 'editor', 'assets/styles']) await fs.mkdir(path.join(root, directory), { recursive: true });
  const source = (await fixture()).replace('Fixture body.', '<div class="custom">Keep **raw** HTML</div>\n\nFirst page.\n<!-- pagebreak -->\nSecond page.').replace('pageCount: 1', 'pageCount: 2');
  await fs.writeFile(path.join(root, 'handouts/section/example.md'), source);
  const secondSource = source.replace('code: STH-001', 'code: STH-002').replace('title: Fixture', 'title: Second fixture');
  await fs.writeFile(path.join(root, 'handouts/section/second.md'), secondSource);
  await fs.copyFile(path.join(repository, 'templates/handout.html'), path.join(root, 'templates/handout.html'));
  for (const name of ['index.html', 'editor.js', 'editor.css', 'editor-model.js']) await fs.copyFile(path.join(repository, 'editor', name), path.join(root, 'editor', name));
  await fs.copyFile(path.join(repository, 'assets/styles/print.css'), path.join(root, 'assets/styles/print.css'));
  await fs.cp(path.join(repository, 'assets/fonts'), path.join(root, 'assets/fonts'), { recursive: true });
  const assetDirectory = path.join(root, 'assets/handouts/STH-001');
  await fs.mkdir(assetDirectory, { recursive: true });
  await fs.writeFile(path.join(assetDirectory, 'route.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Route</title><desc>A route marker</desc><circle cx="5" cy="5" r="4"/></svg>');
  await fs.writeFile(path.join(assetDirectory, 'manifest.json'), JSON.stringify({ assets: [{
    file: 'route.svg', type: 'diagram', creator: 'Test', source: 'Test fixture', license: 'Test license',
    alt: 'A route marker.', caption: 'Route marker.', decorative: false
  }] }));
  const server = await createEditorServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { root, source, base: `http://127.0.0.1:${server.address().port}`, file: path.join(root, 'handouts/section/example.md') };
}

async function openEditor(t) {
  const context = await setup(t);
  const browser = await puppeteer.launch(browserOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(context.base, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#source').value.includes('code: STH-001'));
  return { ...context, page };
}

const value = (page, selector) => page.$eval(selector, element => element.value);
const text = (page, selector) => page.$eval(selector, element => element.textContent);
async function replaceSource(page, contents) {
  await page.$eval('#source', (element, next) => {
    element.value = next;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, contents);
}
async function appendSource(page, contents) {
  await page.$eval('#source', (element, suffix) => {
    element.value += suffix;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, contents);
}
async function waitForText(page, selector, expected) {
  await page.waitForFunction((target, pattern) => document.querySelector(target)?.textContent.includes(pattern), {}, selector, expected);
}
async function saveWithShortcut(page, modifier) {
  await page.keyboard.down(modifier);
  await page.keyboard.press('s');
  await page.keyboard.up(modifier);
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
}

test('editor source helpers report position and transform complete line selections', () => {
  assert.deepEqual(selectionDetails('one\ntwo words', 6, 9), { line: 2, column: 3, characters: 13, words: 3, selected: 3 });
  assert.deepEqual(prefixLines('one\ntwo\nthree', 1, 6, '- '), {
    start: 0, end: 7, replacement: '- one\n- two', selectionStart: 3, selectionEnd: 10
  });
  assert.deepEqual(indentSelection('one\n  two\nthree', 0, 9, true), {
    start: 0, end: 9, replacement: 'one\ntwo', selectionStart: 0, selectionEnd: 7
  });
  assert.equal(prefixLines('one\ntwo\nthree', 0, 8, '- ').replacement, '- one\n- two');
});

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

test('browser editor validates valid buffers before saving', { timeout: 45_000 }, async t => {
  const { page, file } = await openEditor(t);
  await appendSource(page, '\nA valid saved change.');
  await page.click('#save');
  await waitForText(page, '#message', 'Saved atomically.');
  assert.match(await fs.readFile(file, 'utf8'), /A valid saved change\.$/);
});

test('browser editor saves invalid drafts only after explicit confirmation', { timeout: 45_000 }, async t => {
  const { page, file } = await openEditor(t);
  await replaceSource(page, 'not valid front matter');
  const confirmation = new Promise(resolve => page.once('dialog', async dialog => {
    assert.match(dialog.message(), /Save this incomplete draft anyway/);
    await dialog.accept();
    resolve();
  }));
  await page.click('#save');
  await confirmation;
  await waitForText(page, '#message', 'Saved atomically.');
  assert.equal(await fs.readFile(file, 'utf8'), 'not valid front matter');
});

test('browser editor cancels invalid saves and focuses Validation', { timeout: 45_000 }, async t => {
  const { page, file, source: original } = await openEditor(t);
  await replaceSource(page, 'not valid front matter');
  page.once('dialog', dialog => dialog.dismiss());
  await page.click('#save');
  await waitForText(page, '#message', 'Save canceled');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'validation');
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('browser editor validates edits made while an older validation is pending', { timeout: 45_000 }, async t => {
  const { page, file, source: original } = await openEditor(t);
  await page.evaluate(() => {
    const actualFetch = window.fetch.bind(window);
    let release;
    window.releaseDelayedValidation = () => release?.();
    window.fetch = (url, options) => {
      const body = options?.body && JSON.parse(options.body);
      if (url === '/api/validate' && body?.phase === 'syntax' && body.source.includes('delayed validation')) {
        window.delayedValidationStarted = true;
        return new Promise(resolve => { release = () => resolve(actualFetch(url, options)); });
      }
      return actualFetch(url, options);
    };
  });
  await appendSource(page, '\ndelayed validation');
  await page.waitForFunction(() => window.delayedValidationStarted);
  await replaceSource(page, 'new invalid buffer');
  page.once('dialog', dialog => dialog.dismiss());
  await page.click('#save');
  await waitForText(page, '#message', 'Save canceled');
  await page.evaluate(() => window.releaseDelayedValidation());
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(await text(page, '#validation-state'), /Fix syntax \/ metadata/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
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

test('image helpers normalize names and generate supported crop and alignment markup', () => {
  assert.equal(safeAssetName('../../My Photo.PNG', 'image/png'), 'my-photo.png');
  const markup = figureMarkup('STH-001', { file: 'my-photo.png', alt: 'A <safe> route', caption: 'Look & leave.' }, {
    width: 'half', align: 'right', crop: 'square', position: '25% 70%'
  });
  assert.match(markup, /figure--half figure--right figure--crop-square/);
  assert.match(markup, /--crop-position: 25% 70%/);
  assert.match(markup, /alt="A &lt;safe&gt; route"/);
  assert.match(markup, /Look &amp; leave/);
  assert.match(markup, /figure-clear/);
});

test('editor uploads, manifests, serves, and safely deletes an image asset', async t => {
  const { base, root } = await setup(t);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Dot</title><desc>A dot</desc><circle cx="5" cy="5" r="4"/></svg>';
  const upload = await fetch(`${base}/api/assets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    path: 'handouts/section/example.md', name: 'Route Dot.svg', mimeType: 'image/svg+xml',
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    type: 'diagram', creator: 'Test creator', source: 'Original test art', license: 'Test license',
    alt: 'A route dot.', caption: 'Route marker.', decorative: false,
    options: { width: 'half', align: 'left', crop: 'contain' }
  }) });
  const uploadBody = await upload.text();
  assert.equal(upload.status, 201, uploadBody);
  const uploaded = JSON.parse(uploadBody);
  assert.equal(uploaded.asset.file, 'route-dot.svg');
  assert.match(uploaded.markup, /figure--half figure--left figure--contain/);
  assert.equal((await fetch(`${base}/assets/handouts/STH-001/route-dot.svg`)).status, 200);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'assets/handouts/STH-001/manifest.json')));
  assert.equal(manifest.assets.find(asset => asset.file === 'route-dot.svg').alt, 'A route dot.');
  const removed = await fetch(`${base}/api/assets`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'handouts/section/example.md', file: 'route-dot.svg' }) });
  assert.equal(removed.status, 200, await removed.text());
  await assert.rejects(fs.access(path.join(root, 'assets/handouts/STH-001/route-dot.svg')));
});

test('browser editor opens, switches, saves, reverts, reports conflicts, and recovers drafts', { timeout: 45_000 }, async t => {
  const { page, file } = await openEditor(t);
  assert.match(await value(page, '#source'), /title: Fixture/);

  await appendSource(page, '\nSaved with button.');
  await waitForText(page, '#state', 'Unsaved changes');
  await page.click('#save');
  await waitForText(page, '#message', 'Saved atomically.');
  assert.match(await fs.readFile(file, 'utf8'), /Saved with button\.$/);
  assert.equal(await text(page, '#state'), 'Saved');

  await appendSource(page, '\nSaved with shortcut.');
  await saveWithShortcut(page, 'Control');
  assert.match(await fs.readFile(file, 'utf8'), /Saved with shortcut\.$/);

  await appendSource(page, '\nSaved with Command shortcut.');
  await saveWithShortcut(page, 'Meta');
  assert.match(await fs.readFile(file, 'utf8'), /Saved with Command shortcut\.$/);

  await appendSource(page, '\nDiscard this edit.');
  page.once('dialog', dialog => dialog.accept());
  await page.click('#revert');
  await page.waitForFunction(() => !document.querySelector('#source').value.includes('Discard this edit.'));
  assert.equal(await text(page, '#state'), 'Saved');

  await fs.appendFile(file, '\nChanged outside the editor.');
  await appendSource(page, '\nConflicting browser edit.');
  await page.click('#save');
  await waitForText(page, '#message', 'File changed on disk');
  assert.doesNotMatch(await fs.readFile(file, 'utf8'), /Conflicting browser edit/);
  page.once('dialog', dialog => dialog.accept());
  await page.click('#revert');
  await page.waitForFunction(() => document.querySelector('#source').value.includes('Changed outside the editor.'));

  await appendSource(page, '\nRecover this browser draft.');
  page.once('dialog', dialog => dialog.accept());
  await page.select('#handout', 'handouts/section/second.md');
  await page.waitForFunction(() => document.querySelector('#source').value.includes('code: STH-002'));
  assert.equal(await value(page, '#handout'), 'handouts/section/second.md');
  assert.match(await value(page, '#source'), /title: Second fixture/);
  await page.select('#handout', 'handouts/section/example.md');
  await page.waitForFunction(() => !document.querySelector('#draft-recovery').hidden);
  assert.equal(await value(page, '#handout'), 'handouts/section/example.md');
  assert.equal(await text(page, '#draft-recovery span'), 'A newer browser draft is available.');
  await page.click('#restore-draft');
  assert.match(await value(page, '#source'), /Recover this browser draft\.$/);
  assert.match(await text(page, '#message'), /Browser draft restored/);

  page.once('dialog', dialog => dialog.accept());
  await page.click('#revert');
  await page.waitForFunction(() => !document.querySelector('#source').value.includes('Recover this browser draft.'));
  await page.evaluate(sourceText => localStorage.setItem('handout-editor:draft:handouts/section/example.md', JSON.stringify({ source: `${sourceText}\nDismiss this draft.`, revision: 'old', updatedAt: Date.now() })), await value(page, '#source'));
  await page.select('#handout', 'handouts/section/second.md');
  await page.waitForFunction(() => document.querySelector('#source').value.includes('code: STH-002'));
  await page.select('#handout', 'handouts/section/example.md');
  await page.waitForFunction(() => !document.querySelector('#draft-recovery').hidden);
  await page.click('#discard-draft');
  assert.equal(await page.$eval('#draft-recovery', element => element.hidden), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('handout-editor:draft:handouts/section/example.md')), null);
  assert.doesNotMatch(await value(page, '#source'), /Dismiss this draft/);
  assert.match(await fs.readFile(file, 'utf8'), /Changed outside the editor\.$/);
});

test('browser editor toolbar and keyboard operations transform and save Markdown', { timeout: 45_000 }, async t => {
  const { page, file } = await openEditor(t);
  const initial = await value(page, '#source');
  const phraseStart = initial.indexOf('First page.');
  await page.$eval('#source', (element, start) => { element.focus(); element.setSelectionRange(start, start + 'First page.'.length); }, phraseStart);
  await page.click('#toolbar [data-wrap="**|**"]');
  assert.match(await value(page, '#source'), /\*\*First page\.\*\*/);

  const withBold = await value(page, '#source');
  const twoLines = 'Alpha\nBeta';
  await replaceSource(page, `${withBold}\n${twoLines}`);
  const selectionStart = (await value(page, '#source')).lastIndexOf(twoLines);
  await page.$eval('#source', (element, start) => { element.focus(); element.setSelectionRange(start, element.value.length); }, selectionStart);
  await page.keyboard.press('Tab');
  assert.match(await value(page, '#source'), /\n  Alpha\n  Beta$/);
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  assert.match(await value(page, '#source'), /\nAlpha\nBeta$/);

  await page.$eval('#source', element => { element.focus(); element.setSelectionRange(element.value.length, element.value.length); });
  await page.click('#toolbar [data-block="warning"]');
  assert.match(await value(page, '#source'), /<div class="warning">\nContent\n<\/div>$/);
  await page.click('#save');
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
  const saved = await fs.readFile(file, 'utf8');
  assert.match(saved, /\*\*First page\.\*\*/);
  assert.match(saved, /\nAlpha\nBeta/);
  assert.match(saved, /<div class="warning">/);
});

test('browser editor navigates validation results and inserts and removes figures', { timeout: 60_000 }, async t => {
  const { page, file } = await openEditor(t);
  const original = await value(page, '#source');
  await replaceSource(page, original.replace('title: Fixture', 'title:'));
  await page.waitForFunction(() => document.querySelector('#validation-state').textContent.includes('Fix syntax / metadata'));
  await page.waitForSelector('#issues button');
  assert.match(await text(page, '#validation-state'), /Fix syntax \/ metadata/);
  await page.click('#issues button');
  const selectedLine = await page.$eval('#source', element => element.value.slice(element.selectionStart, element.selectionEnd));
  assert.equal(selectedLine, 'title:');

  await replaceSource(page, `${original}\n### Skipped heading`);
  await page.waitForFunction(() => {
    const state = document.querySelector('#validation-state').textContent;
    return state !== 'Checking layout' && (state.includes('issue') || state.includes('No issues') || state.includes('Validation unavailable'));
  }, { timeout: 30_000 });
  const layoutState = await text(page, '#validation-state');
  if (/Validation unavailable:.*Could not find Chrome/.test(layoutState)) {
    t.diagnostic('Puppeteer browser for layout validation is not installed; source navigation remains covered above');
  } else {
    assert.match(layoutState, /issue/);
    const headingIssueIndex = await page.$$eval('#issues button', buttons => buttons.findIndex(button => button.textContent.includes('heading-order')));
    assert.notEqual(headingIssueIndex, -1);
    const headingIssues = await page.$$('#issues button');
    await headingIssues[headingIssueIndex].click();
    assert.match(await page.$eval('#source', element => element.value.slice(element.selectionStart, element.selectionEnd)), /Skipped heading/);
    await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.querySelector('[data-validation-outline="true"]'));
  }

  await replaceSource(page, original);
  await page.$eval('#source', element => { element.focus(); element.setSelectionRange(element.value.length, element.value.length); });
  await page.click('#images');
  assert.equal(await page.$eval('#image-dialog', element => element.open), true);
  await page.click('#asset-list .asset');
  await page.select('#image-width', 'half');
  await page.select('#image-align', 'right');
  await page.select('#image-crop', 'square');
  await page.click('#apply-image');
  assert.equal(await page.$eval('#image-dialog', element => element.open), false);
  const inserted = await value(page, '#source');
  assert.match(inserted, /<figure class="figure figure--half figure--right figure--crop-square"/);
  assert.match(inserted, /\.\.\/assets\/handouts\/STH-001\/route\.svg/);

  const figurePosition = inserted.indexOf('<figure') + 10;
  await page.$eval('#source', (element, position) => { element.focus(); element.setSelectionRange(position, position); }, figurePosition);
  await page.click('#images');
  await page.click('#remove-image');
  assert.equal(await page.$eval('#image-dialog', element => element.open), false);
  assert.doesNotMatch(await value(page, '#source'), /<figure/);
  await page.click('#save');
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
  assert.doesNotMatch(await fs.readFile(file, 'utf8'), /route\.svg/);
});
