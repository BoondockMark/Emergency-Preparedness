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
import { figureAtOffset, figureRanges, HANDOUT_STATUSES, handoutNeedsFixing, handoutOptionLabel, indentSelection, prefixLines, readHandoutStatus, selectionDetails, setHandoutStatus } from '../editor/editor-model.js';

const repository = path.resolve(import.meta.dirname, '..');
const fixture = () => fs.readFile(path.join(repository, 'test/unit-fixtures/front-matter.md'), 'utf8');

async function setup(t, { gitPublisher } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'handout-editor-'));
  let server;
  t.after(async () => { if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); await fs.rm(root, { recursive: true, force: true }); });
  for (const directory of ['handouts/section', 'templates', 'editor', 'assets/styles']) await fs.mkdir(path.join(root, directory), { recursive: true });
  const source = (await fixture()).replace('Fixture body.', '<div class="custom">Keep **raw** HTML</div>\n\nFirst page.\n<!-- pagebreak -->\nSecond page.').replace('pageCount: 1', 'pageCount: 2');
  await fs.writeFile(path.join(root, 'handouts/section/example.md'), source);
  const secondSource = source.replace('code: STH-001', 'code: STH-002').replace('title: Fixture', 'title: Second fixture');
  await fs.writeFile(path.join(root, 'handouts/section/second.md'), secondSource);
  await fs.copyFile(path.join(repository, 'templates/handout.html'), path.join(root, 'templates/handout.html'));
  for (const name of ['index.html', 'editor.js', 'editor.css', 'editor-model.js', 'preview-controls.js', 'library-controls.js', 'proof-controls.js', 'change-controls.js', 'change-model.js', 'navigation-controls.js', 'navigation-model.js', 'command-controls.js', 'link-controls.js', 'link-model.js', 'review-controls.js', 'review-model.js', 'git-controls.js']) await fs.copyFile(path.join(repository, 'editor', name), path.join(root, 'editor', name));
  await fs.copyFile(path.join(repository, 'assets/styles/print.css'), path.join(root, 'assets/styles/print.css'));
  await fs.cp(path.join(repository, 'assets/fonts'), path.join(root, 'assets/fonts'), { recursive: true });
  const assetDirectory = path.join(root, 'assets/handouts/STH-001');
  await fs.mkdir(assetDirectory, { recursive: true });
  await fs.writeFile(path.join(assetDirectory, 'route.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Route</title><desc>A route marker</desc><circle cx="5" cy="5" r="4"/></svg>');
  await fs.writeFile(path.join(assetDirectory, 'manifest.json'), JSON.stringify({ assets: [{
    file: 'route.svg', type: 'diagram', creator: 'Test', source: 'Test fixture', license: 'Test license',
    alt: 'A route marker.', caption: 'Route marker.', decorative: false
  }] }));
  server = await createEditorServer({ root, gitPublisher });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { root, source, server, base: `http://127.0.0.1:${server.address().port}`, file: path.join(root, 'handouts/section/example.md') };
}

async function openEditor(t, { mode = 'source', gitPublisher } = {}) {
  const context = await setup(t, { gitPublisher });
  const browser = await puppeteer.launch(browserOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.on('pageerror', error => t.diagnostic(`Browser error: ${error.message}`));
  await page.goto(context.base, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#source').value.includes('code: STH-001'));
  if (mode === 'source') await page.click('#source-mode');
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

test('editor handout labels expose release and formatting state and can filter work', () => {
  const release = { code: 'STH-001', title: 'Ready', status: 'approved', formatting: 'valid' };
  const draft = { code: 'STH-002', title: 'Work', status: 'draft', formatting: 'valid' };
  const broken = { code: 'STH-003', title: 'Broken', status: 'approved', formatting: 'error' };
  assert.equal(handoutOptionLabel(release), '🟢 STH-001 — Ready · release · formatting valid');
  assert.equal(handoutNeedsFixing(release), false);
  assert.equal(handoutNeedsFixing(draft), true);
  assert.equal(handoutNeedsFixing(broken), true);
  assert.equal(handoutOptionLabel({ ...release, formatting: 'checking' }), '🟡 STH-001 — Ready · release · formatting check in progress');
  assert.equal(handoutNeedsFixing({ ...release, formatting: 'checking' }), true);
  assert.equal(handoutNeedsFixing({ ...release, formatting: 'unavailable' }), true);
  assert.equal(handoutOptionLabel({ ...broken, issueCount: 2 }), '🔴 STH-003 — Broken · release · formatting errors (2 issues)');
});

test('editor status helpers expose every workflow option and only edit front matter', async () => {
  const source = await fixture();
  assert.deepEqual(HANDOUT_STATUSES, ['draft', 'under-review', 'approved']);
  assert.equal(readHandoutStatus(source), 'draft');
  const updated = setHandoutStatus(`${source}\nstatus: body text`, 'under-review');
  assert.equal(readHandoutStatus(updated), 'under-review');
  assert.match(updated, /\nstatus: body text$/);
  assert.equal(setHandoutStatus(source, 'published'), source);
  assert.equal(readHandoutStatus('No front matter'), '');
});

test('handout list includes workflow and formatting state', async t => {
  const { base } = await setup(t);
  const response = await fetch(`${base}/api/handouts`);
  assert.equal(response.status, 200);
  const handouts = await response.json();
  assert.deepEqual(handouts.map(({ status, formatting }) => ({ status, formatting })), [
    { status: 'draft', formatting: 'unchecked' }, { status: 'draft', formatting: 'unchecked' }
  ]);
});

test('browser handout search filters, groups, navigates, and preserves selection while scans update', { timeout: 45_000 }, async t => {
  const { page } = await openEditor(t);
  assert.equal(await page.$eval('#handout-search', input => input.getAttribute('aria-label') || document.querySelector(`label[for="${input.id}"]`)?.textContent), 'Search handouts by code or title');
  assert.equal(await page.$eval('#handout', element => element.getAttribute('aria-label')), 'Handout search results');
  assert.ok((await page.$$eval('#handout optgroup', groups => groups.map(group => group.label))).some(label => label === 'section · draft'));

  await page.focus('#handout-search');
  await page.keyboard.type('sEcOnD FIXTURE');
  assert.deepEqual(await page.$$eval('#handout option', options => options.map(option => option.value)), ['handouts/section/second.md']);
  assert.match(await text(page, '#handout-results'), /1 handout found/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#source').value.includes('STH-002'));

  await page.$eval('#handout-search', input => { input.value = 'nothing matches'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await text(page, '#handout-results'), 'No handouts match your search.');
  assert.equal(await page.$$eval('#handout option', options => options.length), 0);
  assert.ok((await value(page, '#source')).includes('STH-002'));

  await page.$eval('#handout-search', input => { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await waitForText(page, '#scan-state', 'Scan complete');
  assert.equal(await value(page, '#handout'), 'handouts/section/second.md');
  assert.match(await page.$eval('#handout option:checked', option => option.textContent), /formatting (?:valid|errors)/);

  await page.focus('#handout-search');
  await page.keyboard.press('ArrowUp');
  assert.equal(await value(page, '#handout'), 'handouts/section/example.md', 'ArrowUp moves to the previous result');
});

test('editor scan validates a handout from disk without opening it', async t => {
  const { base, file } = await setup(t);
  await fs.writeFile(file, 'not valid front matter');
  const invalid = await fetch(`${base}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'handouts/section/example.md' }) });
  assert.equal(invalid.status, 200);
  const scanned = await invalid.json();
  assert.deepEqual({ path: scanned.path, formatting: scanned.formatting, issueCount: scanned.issueCount }, { path: 'handouts/section/example.md', formatting: 'error', issueCount: 1 });
  assert.equal(typeof scanned.revision, 'string');
  assert.equal(scanned.issues.length, 1);
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
  const saved = await fetch(`${base}/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...opened, session: 'test-session', source: changed }) });
  assert.equal(saved.status, 200);
  assert.equal(await fs.readFile(file, 'utf8'), changed);
  const stale = await fetch(`${base}/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...opened, session: 'test-session' }) });
  assert.equal(stale.status, 409);
  assert.deepEqual((await fs.readdir(path.dirname(file))).filter(name => name.endsWith('.tmp')), []);
});

test('save validation override follows each workflow status', async t => {
  const { base, file, source: original } = await setup(t);
  for (const [status, expectedStatus] of [['draft', 200], ['under-review', 200], ['approved', 422]]) {
    await t.test(status, async () => {
      const opened = await (await fetch(`${base}/api/handout?path=handouts%2Fsection%2Fexample.md`)).json();
      const invalid = opened.source.replace(/^status:.*$/m, `status: ${status}`).replace(/^title:.*$/m, 'title:');
      const response = await fetch(`${base}/api/save`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...opened, source: invalid, session: `status-${status}` })
      });
      const responseBody = await response.text();
      assert.equal(response.status, expectedStatus, responseBody);
      if (status === 'approved') assert.match(JSON.parse(responseBody).error, /Approved handouts must pass validation/);
      assert.equal(await fs.readFile(file, 'utf8'), expectedStatus === 200 ? invalid : original);
      if (expectedStatus === 200) await fs.writeFile(file, original);
    });
  }
});

test('save validation override rejects crafted requests without a valid workflow status', async t => {
  const { base, file, source: original } = await setup(t);
  const opened = await (await fetch(`${base}/api/handout?path=handouts%2Fsection%2Fexample.md`)).json();
  const invalid = opened.source.replace(/^status:.*$/m, 'status: bypassed').replace(/^title:.*$/m, 'title:');
  const response = await fetch(`${base}/api/save`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...opened, source: invalid, session: 'invalid-status' })
  });
  const responseBody = await response.text();
  assert.equal(response.status, 422, responseBody);
  assert.match(JSON.parse(responseBody).error, /invalid or missing status metadata/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('browser editor defaults to a visual canvas and synchronizes edits to source', { timeout: 45_000 }, async t => {
  const { page, source } = await openEditor(t, { mode: 'visual' });
  assert.equal(await page.$eval('#visual-mode', button => button.getAttribute('aria-pressed')), 'true');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelector('[data-visual-block][contenteditable="true"]'));
  await page.$eval('#visual', frame => {
    const paragraph = [...frame.contentDocument.querySelectorAll('.content p')].find(element => element.textContent.includes('First page.'));
    paragraph.textContent = 'Visually edited first page.';
    paragraph.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#source-mode');
  assert.equal(await value(page, '#source'), source.replace('First page.', '<p>Visually edited first page.</p>'));
});

test('browser editor controls remain reachable without horizontal overflow at responsive widths', { timeout: 60_000 }, async t => {
  const { page } = await openEditor(t, { mode: 'visual' });
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 900, height: 800 },
    { name: 'mobile', width: 390, height: 844 }
  ];

  for (const viewport of viewports) {
    await page.setViewport(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `${viewport.name} page has horizontal overflow`);

    for (const selector of ['#save', '#revert', '#document-status', '.mode-switch', '#validation']) {
      const bounds = await page.$eval(selector, element => {
        element.scrollIntoView({ block: 'nearest' });
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, display: getComputedStyle(element).display };
      });
      assert.notEqual(bounds.display, 'none', `${selector} is hidden at ${viewport.name}`);
      assert.ok(bounds.width > 0 && bounds.left >= 0 && bounds.right <= viewport.width, `${selector} is not horizontally reachable at ${viewport.name}`);
      assert.ok(bounds.bottom > 0 && bounds.top < viewport.height, `${selector} cannot be scrolled into view at ${viewport.name}`);
    }
  }

  await page.setViewport({ width: 1440, height: 900 });
  const desktopShell = await page.evaluate(() => {
    const main = document.querySelector('main').getBoundingClientRect();
    return { bodyHeight: document.body.getBoundingClientRect().height, mainBottom: main.bottom, viewportHeight: innerHeight };
  });
  assert.equal(desktopShell.bodyHeight, desktopShell.viewportHeight, 'desktop shell matches the viewport height');
  assert.equal(desktopShell.mainBottom, desktopShell.viewportHeight, 'editor consumes the actual remaining viewport height');

  await page.setViewport({ width: 900, height: 800 });
  const tabletRows = await page.$eval('header', header => {
    const picker = header.querySelector('.handout-picker').getBoundingClientRect();
    const save = header.querySelector('#save').getBoundingClientRect();
    return { pickerTop: picker.top, saveBottom: save.bottom };
  });
  assert.ok(tabletRows.pickerTop >= tabletRows.saveBottom, 'tablet handout picker wraps below primary actions');

  await page.setViewport({ width: 390, height: 844 });
  const mobilePicker = await page.$eval('.handout-picker', picker => {
    const search = picker.querySelector('#handout-search').getBoundingClientRect();
    const select = picker.querySelector('#handout').getBoundingClientRect();
    return { pickerWidth: picker.getBoundingClientRect().width, searchTop: search.top, selectTop: select.top };
  });
  assert.ok(mobilePicker.pickerWidth > 300, 'mobile handout controls occupy their own full-width row');
  assert.ok(mobilePicker.selectTop > mobilePicker.searchTop, 'mobile search and handout selection stack without squeezing');
  assert.equal(await page.$eval('.tool-overflow .tool-toggle', summary => getComputedStyle(summary).display !== 'none'), true, 'mobile lower-frequency tools use an overflow disclosure');
  assert.equal(await page.$eval('.tool-overflow-menu', menu => getComputedStyle(menu).display), 'none', 'mobile lower-frequency tools start collapsed');
  assert.equal(await page.$eval('#images', button => button.closest('.tool-overflow') === null), true, 'Images is hidden in the overflow menu');
  const imageButtonBounds = await page.$eval('#images', element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, display: getComputedStyle(element).display };
  });
  assert.notEqual(imageButtonBounds.display, 'none');
  assert.ok(imageButtonBounds.width > 0 && imageButtonBounds.left >= 0 && imageButtonBounds.right <= 390, 'Images is not visible at mobile width');
  await page.click('.tool-toggle');
  await page.click('#images');
  assert.equal(await page.$eval('#image-dialog', element => element.scrollWidth <= element.clientWidth), true, 'mobile image dialog has horizontal overflow');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'open mobile dialog causes page overflow');
});

test('an isolated Visual edit preserves unrelated Markdown, custom HTML, and page breaks verbatim', { timeout: 45_000 }, async t => {
  const { page, source } = await openEditor(t, { mode: 'visual' });
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelector('[data-visual-block][contenteditable="true"]'));
  await page.$eval('#visual', frame => {
    const paragraph = [...frame.contentDocument.querySelectorAll('.content p')].find(element => element.textContent === 'Second page.');
    paragraph.textContent = 'Only this block changed.';
    paragraph.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const changed = await value(page, '#source');
  assert.equal(changed, source.replace('Second page.', '<p>Only this block changed.</p>'));
  assert.ok(changed.includes('<div class="custom">Keep **raw** HTML</div>'));
  assert.ok(changed.includes('\n<!-- pagebreak -->\n'));
});

test('a real contenteditable Visual input updates only its source block', { timeout: 45_000 }, async t => {
  const { page, source } = await openEditor(t, { mode: 'visual' });
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelector('[data-visual-block][contenteditable="true"]'));
  await page.$eval('#visual', frame => {
    const paragraph = [...frame.contentDocument.querySelectorAll('.content p')].find(element => element.textContent === 'First page.');
    paragraph.focus();
    const selection = frame.contentWindow.getSelection();
    selection.removeAllRanges();
    selection.selectAllChildren(paragraph);
  });
  await page.keyboard.type('Typed in Visual mode.');
  const changed = await value(page, '#source');
  assert.equal(changed, source.replace('First page.', '<p>Typed in Visual mode.</p>'));
});

test('browser visual editor ignores a delayed render from an older buffer', { timeout: 45_000 }, async t => {
  const { page, source } = await openEditor(t);
  await page.evaluate(() => {
    const actualFetch = window.fetch.bind(window);
    let release;
    window.releaseDelayedVisualRender = () => release?.();
    window.fetch = (url, options) => {
      const body = options?.body && JSON.parse(options.body);
      if (url === '/api/render' && body?.source.includes('Older visual buffer')) {
        window.delayedVisualRenderStarted = true;
        const response = actualFetch(url, { ...options, signal: undefined });
        return new Promise((resolve, reject) => {
          release = () => response.then(resolve, reject);
        });
      }
      return actualFetch(url, options);
    };
  });

  await replaceSource(page, `${source}\nOlder visual buffer`);
  await page.click('#visual-mode');
  await page.waitForFunction(() => window.delayedVisualRenderStarted);
  await page.click('#source-mode');
  await replaceSource(page, `${source}\nNewer visual buffer`);
  await page.click('#visual-mode');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.body?.textContent.includes('Newer visual buffer'));
  await page.evaluate(() => window.releaseDelayedVisualRender());
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await page.$eval('#visual', frame => frame.contentDocument.body.textContent.includes('Newer visual buffer')), true);
  assert.equal(await page.$eval('#visual', frame => frame.contentDocument.body.textContent.includes('Older visual buffer')), false);
});

test('browser visual editor ignores a delayed render after changing handouts', { timeout: 45_000 }, async t => {
  const { page } = await openEditor(t, { mode: 'visual' });
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.body?.textContent.includes('Fixture'));
  await page.evaluate(() => {
    const actualFetch = window.fetch.bind(window);
    let release;
    window.delayFirstHandoutRender = true;
    window.releaseDelayedHandoutRender = () => release?.();
    window.fetch = (url, options) => {
      const body = options?.body && JSON.parse(options.body);
      if (window.delayFirstHandoutRender && url === '/api/render' && body?.path.endsWith('/example.md')) {
        window.delayFirstHandoutRender = false;
        window.delayedHandoutRenderStarted = true;
        const response = actualFetch(url, { ...options, signal: undefined });
        return new Promise((resolve, reject) => {
          release = () => response.then(resolve, reject);
        });
      }
      return actualFetch(url, options);
    };
  });

  await page.click('#source-mode');
  await page.click('#visual-mode');
  await page.waitForFunction(() => window.delayedHandoutRenderStarted);
  await page.select('#handout', 'handouts/section/second.md');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.body?.textContent.includes('Second fixture'));
  await page.evaluate(() => window.releaseDelayedHandoutRender());
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await page.$eval('#visual', frame => frame.contentDocument.body.textContent.includes('Second fixture')), true);
});

test('browser editor saves Visual mode edits with platform shortcuts while iframe retains focus', { timeout: 45_000 }, async t => {
  const { page, file } = await openEditor(t, { mode: 'visual' });
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelector('[data-visual-block][contenteditable="true"]'));

  for (const [modifier, contents] of [['Control', 'Saved visually with Ctrl+S.'], ['Meta', 'Saved visually with Cmd+S.']]) {
    await page.$eval('#visual', (frame, next) => {
      const document = frame.contentDocument;
      const paragraph = [...document.querySelectorAll('.content p')].find(element => element.textContent.includes('First page.') || element.textContent.includes('Saved visually'));
      paragraph.textContent = next;
      paragraph.dispatchEvent(new Event('input', { bubbles: true }));
      paragraph.focus();
    }, contents);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'visual');
    assert.equal(await page.$eval('#visual', frame => Boolean(frame.contentDocument.activeElement?.closest('.content'))), true);
    await saveWithShortcut(page, modifier);
    assert.ok((await fs.readFile(file, 'utf8')).includes(contents));
  }
});

test('browser editor validates valid buffers before saving', { timeout: 45_000 }, async t => {
  const { page, file } = await openEditor(t);
  await page.evaluate(() => {
    const actualFetch = window.fetch.bind(window);
    window.saveRequestOrder = [];
    window.fetch = (url, options) => {
      if (url === '/api/validate' || url === '/api/save') window.saveRequestOrder.push(url);
      return actualFetch(url, options);
    };
  });
  await appendSource(page, '\nA valid saved change.');
  await page.click('#save');
  await waitForText(page, '#state', 'Saved');
  assert.deepEqual(await page.evaluate(() => window.saveRequestOrder.slice(-2)), ['/api/validate', '/api/save']);
  assert.match(await fs.readFile(file, 'utf8'), /A valid saved change\.$/);
});

test('browser editor saves invalid drafts only after explicit confirmation', { timeout: 45_000 }, async t => {
  const { page, file } = await openEditor(t);
  const invalidDraft = (await value(page, '#source')).replace('title: Fixture', 'title:');
  await replaceSource(page, invalidDraft);
  const confirmation = new Promise(resolve => page.once('dialog', async dialog => {
    assert.match(dialog.message(), /Save this incomplete draft anyway/);
    await dialog.accept();
    resolve();
  }));
  await page.click('#save');
  await confirmation;
  await waitForText(page, '#state', 'Saved');
  assert.equal(await fs.readFile(file, 'utf8'), invalidDraft);
});

test('browser editor saves invalid under-review handouts only after explicit confirmation', { timeout: 45_000 }, async t => {
  const { page, file } = await openEditor(t);
  const invalid = (await value(page, '#source')).replace('status: draft', 'status: under-review').replace('title: Fixture', 'title:');
  await replaceSource(page, invalid);
  const confirmation = new Promise(resolve => page.once('dialog', async dialog => {
    assert.match(dialog.message(), /Save this incomplete under-review handout anyway/);
    await dialog.accept();
    resolve();
  }));
  await page.click('#save');
  await confirmation;
  await waitForText(page, '#state', 'Saved');
  assert.equal(await fs.readFile(file, 'utf8'), invalid);
});

test('browser editor refuses invalid approved handouts and focuses Validation', { timeout: 45_000 }, async t => {
  const { page, file, source: original } = await openEditor(t);
  const invalid = (await value(page, '#source')).replace('status: draft', 'status: approved').replace('title: Fixture', 'title:');
  await replaceSource(page, invalid);
  await page.click('#save');
  await waitForText(page, '#message', 'Approved handouts must pass validation');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'validation');
  assert.match(await text(page, '#message'), /Change the status to Draft or Under review, or complete the approval requirements/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('browser editor cancels invalid saves and focuses Validation', { timeout: 45_000 }, async t => {
  const { page, file, source: original } = await openEditor(t);
  await replaceSource(page, original.replace('title: Fixture', 'title:'));
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
    window.currentBufferValidationCount = 0;
    window.releaseDelayedValidation = () => release?.();
    window.fetch = (url, options) => {
      const body = options?.body && JSON.parse(options.body);
      if (url === '/api/validate' && body?.phase === 'syntax' && body.source.includes('delayed validation')) {
        window.delayedValidationStarted = true;
        return new Promise(resolve => { release = () => resolve(actualFetch(url, options)); });
      }
      if (url === '/api/validate' && body?.phase === 'syntax' && body.source.includes('new invalid buffer')) {
        window.currentBufferValidationCount += 1;
      }
      return actualFetch(url, options);
    };
  });
  await appendSource(page, '\ndelayed validation');
  await page.waitForFunction(() => window.delayedValidationStarted);
  await replaceSource(page, original.replace('title: Fixture', 'title:').replace('First page.', 'new invalid buffer'));
  page.once('dialog', dialog => dialog.dismiss());
  await page.click('#save');
  await waitForText(page, '#message', 'Save canceled');
  await page.evaluate(() => window.releaseDelayedValidation());
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(await text(page, '#validation-state'), /Fix syntax \/ metadata/);
  page.once('dialog', dialog => dialog.dismiss());
  await page.click('#save');
  await waitForText(page, '#message', 'Save canceled');
  assert.equal(await page.evaluate(() => window.currentBufferValidationCount), 2);
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
  const custom = figureMarkup('STH-001', { file: 'photo.png', alt: 'A route.' }, { width: 35, align: 'right' });
  assert.match(custom, /figure--full figure--right/);
  assert.match(custom, /width: 35%/);
  assert.match(custom, /figure-clear/);
  assert.match(figureMarkup('STH-001', { file: 'photo.png', alt: 'A route.' }, { width: 500 }), /width: 100%/);
});

test('image ranges distinguish repeated nested figures and their adjacent clearing blocks', () => {
  const markup = figureMarkup('STH-001', { file: 'route.svg', alt: 'Route.' }, { width: 'half', align: 'left' });
  const source = `<div class="grid">\n${markup}\n<p>Keep this text.</p>\n${markup}\n</div>`;
  const ranges = figureRanges(source);
  assert.equal(ranges.length, 2);
  assert.equal(figureAtOffset(source, ranges[1].start + 12).start, ranges[1].start);
  assert.equal(ranges[1].file, 'route.svg');
  assert.equal(figureAtOffset(source, source.indexOf('Keep this text')), null);
  assert.match(ranges[0].text, /figure-clear/);
  assert.match(source.slice(0, ranges[1].start) + source.slice(ranges[1].end), /Keep this text/);
});

test('editor stages an upload until save, then manifests, serves, and deletes it', async t => {
  const { base, root } = await setup(t);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Dot</title><desc>A dot</desc><circle cx="5" cy="5" r="4"/></svg>';
  const upload = await fetch(`${base}/api/assets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    path: 'handouts/section/example.md', session: 'asset-test-session', name: 'Route Dot.svg', mimeType: 'image/svg+xml',
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
  assert.equal((await fetch(`${base}/assets/handouts/STH-001/route-dot.svg`)).status, 404);
  assert.equal((await fetch(`${base}/assets/handouts/STH-001/route-dot.svg?session=asset-test-session&path=handouts%2Fsection%2Fexample.md`)).status, 200);
  await assert.rejects(fs.access(path.join(root, 'assets/handouts/STH-001/route-dot.svg.base64')));
  let manifest = JSON.parse(await fs.readFile(path.join(root, 'assets/handouts/STH-001/manifest.json')));
  assert.equal(manifest.assets.some(asset => asset.file === 'route-dot.svg'), false);
  const opened = await (await fetch(`${base}/api/handout?path=handouts%2Fsection%2Fexample.md`)).json();
  const saved = await fetch(`${base}/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...opened, session: 'asset-test-session' }) });
  assert.equal(saved.status, 200, await saved.text());
  assert.equal((await fetch(`${base}/assets/handouts/STH-001/route-dot.svg`)).status, 200);
  const storedAsset = await fs.readFile(path.join(root, 'assets/handouts/STH-001/route-dot.svg.base64'), 'ascii');
  assert.equal(Buffer.from(storedAsset.replace(/\s/g, ''), 'base64').toString(), svg);
  await assert.rejects(fs.access(path.join(root, 'assets/handouts/STH-001/route-dot.svg')));
  manifest = JSON.parse(await fs.readFile(path.join(root, 'assets/handouts/STH-001/manifest.json')));
  assert.equal(manifest.assets.find(asset => asset.file === 'route-dot.svg').alt, 'A route dot.');
  const removed = await fetch(`${base}/api/assets`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'handouts/section/example.md', file: 'route-dot.svg' }) });
  assert.equal(removed.status, 200, await removed.text());
  await assert.rejects(fs.access(path.join(root, 'assets/handouts/STH-001/route-dot.svg.base64')));
});

test('staged assets survive save conflicts and can be explicitly discarded', async t => {
  const { base, root, file } = await setup(t);
  const handoutPath = 'handouts/section/example.md';
  const session = 'failed-save-session';
  const opened = await (await fetch(`${base}/api/handout?path=${encodeURIComponent(handoutPath)}`)).json();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><title>Pending</title><desc>Pending dot</desc><circle cx="1" cy="1" r="1"/></svg>';
  const upload = await fetch(`${base}/api/assets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    path: handoutPath, session, name: 'Pending.svg', mimeType: 'image/svg+xml', dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    type: 'diagram', creator: 'Test', source: 'Test', license: 'Test', alt: 'Pending dot.', decorative: false
  }) });
  assert.equal(upload.status, 201, await upload.text());
  await fs.appendFile(file, '\nExternal edit.');
  const failed = await fetch(`${base}/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...opened, session }) });
  assert.equal(failed.status, 409);
  assert.equal((await fetch(`${base}/assets/handouts/STH-001/pending.svg?session=${session}&path=${encodeURIComponent(handoutPath)}`)).status, 200);
  await assert.rejects(fs.access(path.join(root, 'assets/handouts/STH-001/pending.svg.base64')));
  const recovered = await (await fetch(`${base}/api/handout?path=${encodeURIComponent(handoutPath)}&session=${session}`)).json();
  assert.equal(recovered.assets.find(asset => asset.file === 'pending.svg')?.pending, true);
  const discarded = await fetch(`${base}/api/assets/discard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: handoutPath, session }) });
  assert.equal(discarded.status, 200);
  assert.equal((await fetch(`${base}/assets/handouts/STH-001/pending.svg?session=${session}&path=${encodeURIComponent(handoutPath)}`)).status, 404);
});

test('browser editor opens, switches, saves, reverts, reports conflicts, and recovers drafts', { timeout: 45_000 }, async t => {
  const { page, file } = await openEditor(t);
  assert.match(await value(page, '#source'), /title: Fixture/);
  assert.equal(await value(page, '#document-status'), 'draft');
  await page.select('#document-status', 'under-review');
  assert.match(await value(page, '#source'), /^status: under-review$/m);
  await waitForText(page, '#state', 'Unsaved changes');
  await page.click('#save');
  await waitForText(page, '#state', 'Saved');
  assert.match(await fs.readFile(file, 'utf8'), /^status: under-review$/m);

  await appendSource(page, '\nSaved with button.');
  await waitForText(page, '#state', 'Unsaved changes');
  await page.click('#save');
  await waitForText(page, '#state', 'Saved');
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
  await page.waitForFunction(() => document.querySelector('#draft-recovery').hidden);
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
  await page.click('#toolbar [data-insert*="pagebreak"]');
  assert.equal((await value(page, '#source')).endsWith('\n<!-- pagebreak -->\n'), true);

  await page.click('#toolbar [data-block="warning"]');
  assert.match(await value(page, '#source'), /<div class="warning">\nContent\n<\/div>$/);
  await replaceSource(page, (await value(page, '#source')).replace('pageCount: 2', 'pageCount: 3'));
  await page.click('#save');
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
  const saved = await fs.readFile(file, 'utf8');
  assert.match(saved, /\*\*First page\.\*\*/);
  assert.match(saved, /\nAlpha\nBeta/);
  assert.match(saved, /\n<!-- pagebreak -->\n/);
  assert.match(saved, /<div class="warning">/);
});

test('browser editor navigates validation results and inserts and removes figures', { timeout: 60_000 }, async t => {
  const { page, file } = await openEditor(t);
  const original = await value(page, '#source');
  await replaceSource(page, original.replace('title: Fixture', 'title:'));
  await page.waitForFunction(() => document.querySelector('#validation-state').textContent.includes('Fix syntax / metadata'));
  await page.waitForSelector('#issues button');
  assert.match(await text(page, '#validation-state'), /Fix syntax \/ metadata/);
  await page.click('#preview-only');
  await page.click('#issues button');
  assert.equal(await page.$eval('#preview-only', button => button.getAttribute('aria-pressed')), 'false', 'Source-only findings restore the editor');
  const selectedLine = await page.$eval('#source', element => element.value.slice(element.selectionStart, element.selectionEnd));
  assert.equal(selectedLine, 'title:');
  assert.equal(await page.$eval('#source-mode', button => button.getAttribute('aria-pressed')), 'true');
  assert.match(await text(page, '#message'), /Navigated to metadata on source line/);

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
    await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.querySelector('h3')?.textContent === 'Skipped heading');
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
  await page.waitForFunction(() => !document.querySelector('#image-dialog').open);
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

test('browser editor focuses source-mapped findings in the Visual editor', { timeout: 60_000 }, async t => {
  const { page } = await openEditor(t, { mode: 'visual' });
  const original = await value(page, '#source');
  await replaceSource(page, `${original}\n### Skipped heading`);
  await page.waitForFunction(() => {
    const state = document.querySelector('#validation-state').textContent;
    return state !== 'Checking layout' && (state.includes('issue') || state.includes('Validation unavailable'));
  }, { timeout: 30_000 });
  const layoutState = await text(page, '#validation-state');
  if (/Validation unavailable:.*Could not find Chrome/.test(layoutState)) return t.skip('Puppeteer browser for layout validation is not installed');

  const headingIssueIndex = await page.$$eval('#issues button', buttons => buttons.findIndex(button => button.textContent.includes('heading-order')));
  assert.notEqual(headingIssueIndex, -1);
  const headingIssues = await page.$$('#issues button');
  await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.querySelector('h3')?.textContent === 'Skipped heading');
  await page.click('#source-mode');
  await page.click('#visual-mode');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelector('h3')?.textContent === 'Skipped heading');
  await headingIssues[headingIssueIndex].click();
  assert.equal(await page.$eval('#visual-mode', button => button.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('#visual', frame => frame.contentDocument.activeElement?.textContent), 'Skipped heading');
  assert.match(await text(page, '#message'), /Navigated to heading-order in the Visual editor/);
  await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.querySelector('[data-validation-outline="true"]'));
});

test('visual image tools insert at a selected block, preview size, upload a replacement, and save', { timeout: 60_000 }, async t => {
  const { page, root, file } = await openEditor(t, { mode: 'visual' });
  const initial = await value(page, '#source');
  const canvas = await (await page.$('#visual')).contentFrame();
  await canvas.waitForSelector('.content > p');
  await canvas.click('.content > p');
  await page.click('#images');
  assert.equal(await text(page, '#image-dialog-title'), 'Insert image');
  assert.equal(await value(page, '#image-insert-position'), 'after');
  await page.click('#asset-list .asset');
  await page.select('#image-width', 'half');
  await page.select('#image-align', 'right');
  await page.select('#image-crop', 'square');
  await page.$eval('#image-size', input => { input.value = '35'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await text(page, '#image-size-value'), '35%');
  assert.equal(await page.$eval('#image-placement-preview', element => element.style.width), '35%');
  assert.equal(await value(page, '#source'), initial, 'dialog changes are only applied on request');
  await page.click('#apply-image');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelector('figure')?.style.width === '35%');
  const inserted = await value(page, '#source');
  const figure = figureRanges(inserted)[0];
  assert.ok(figure.start > inserted.indexOf('First page.'));
  assert.ok(figure.start < inserted.indexOf('<!-- pagebreak -->'));
  assert.match(inserted, /figure--right figure--crop-square/);
  assert.equal(inserted.slice(0, inserted.indexOf('First page.')), initial.slice(0, initial.indexOf('First page.')));
  assert.equal(await page.$eval('#visual-mode', button => button.getAttribute('aria-pressed')), 'true');

  await canvas.click('figure img');
  assert.equal(await text(page, '#image-dialog-title'), 'Edit image');
  assert.equal(await value(page, '#image-size'), '35');
  assert.equal(await value(page, '#image-align'), 'right');
  assert.equal(await value(page, '#image-crop'), 'square');
  const upload = await page.$('#image-file');
  await upload.uploadFile(path.join(root, 'assets/handouts/STH-001/route.svg'));
  for (const [selector, contents] of [['#image-alt', 'Replacement route marker.'], ['#image-caption', 'Replacement caption.'], ['#image-creator', 'Test author'], ['#image-source', 'Test fixture'], ['#image-license', 'Test permission']]) await page.type(selector, contents);
  assert.equal(await text(page, '#upload-image'), 'Upload and replace');
  await page.click('#upload-image');
  await page.waitForFunction(() => !document.querySelector('#image-dialog').open);
  const replaced = await value(page, '#source');
  assert.equal(figureRanges(replaced).length, 1, 'replacement does not insert a second image');
  assert.match(replaced, /route-2\.svg/);
  assert.match(replaced, /width: 35%/);
  assert.match(replaced, /figure--right figure--crop-square/);
  await page.waitForFunction(() => {
    const image = document.querySelector('#preview').contentDocument?.querySelector('figure img');
    return image?.src.includes('route-2.svg') && image.complete && image.naturalWidth > 0;
  });
  await page.click('#save');
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
  assert.equal(await fs.readFile(file, 'utf8'), replaced);
  assert.ok(await fs.readFile(path.join(root, 'assets/handouts/STH-001/route-2.svg.base64'), 'utf8'));
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelector('figure img')?.src.includes('route-2.svg'));
  await canvas.click('figure img');
  await page.click('#asset-list .asset');
  assert.equal(await text(page, '#apply-image'), 'Replace image');
  await page.click('#apply-image');
  await page.waitForFunction(() => !document.querySelector('#image-dialog').open);
  const libraryReplacement = await value(page, '#source');
  assert.equal(figureRanges(libraryReplacement).length, 1);
  assert.equal(figureRanges(libraryReplacement)[0].file, 'route.svg');
  assert.match(libraryReplacement, /width: 35%/);
  assert.match(libraryReplacement, /figure--right figure--crop-square/);
});

test('visual resizing and replacement target the clicked nested occurrence and preserve custom captions', { timeout: 60_000 }, async t => {
  const { page } = await openEditor(t);
  const initial = await value(page, '#source');
  const asset = { file: 'route.svg', alt: 'A route marker.', caption: 'Route marker.' };
  const first = figureMarkup('STH-001', asset, { width: 'half', align: 'left', crop: '4x3', position: '20% 70%' });
  const second = first.replace('sth-001-route-caption', 'custom-caption').replace('sth-001-route-caption', 'custom-caption').replace('Route marker.</figcaption>', 'Keep this caption <span class="credit">Keep this credit.</span></figcaption>').replace('figure figure--half', 'figure custom-layout figure--half').replace('<img src', '<img style="height: 1in" src');
  await replaceSource(page, initial.replace('First page.', `<div class="grid">\n${first}\n${second}\n</div>`));
  await page.click('#visual-mode');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelectorAll('figure').length === 2);
  const canvas = await (await page.$('#visual')).contentFrame();
  const figures = await canvas.$$('figure');
  await figures[1].focus();
  await page.keyboard.press('Enter');
  assert.equal(await value(page, '#image-width'), 'half');
  assert.equal(await value(page, '#image-x'), '20');
  assert.equal(await value(page, '#image-y'), '70');
  await page.$eval('#image-size', input => { input.value = '42'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#apply-image');
  const resized = await value(page, '#source');
  assert.equal(figureRanges(resized)[0].text, first);
  assert.match(figureRanges(resized)[1].text, /width: 42%/);
  assert.match(figureRanges(resized)[1].text, /Keep this caption <span class="credit">Keep this credit\./);
  assert.match(figureRanges(resized)[1].text, /aria-labelledby="custom-caption"/);
  assert.match(figureRanges(resized)[1].text, /custom-layout/);
  assert.match(figureRanges(resized)[1].text, /height: auto/);
  assert.doesNotMatch(resized, /data-image-editable|data-editor-tabindex/);
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelectorAll('figure')[1]?.style.width === '42%');
  const updated = await canvas.$$('figure');
  await updated[1].click();
  await page.click('#remove-image');
  const removed = await value(page, '#source');
  assert.equal(figureRanges(removed).length, 1);
  assert.equal(figureRanges(removed)[0].text, first);
  assert.match(removed, /<div class="grid">/);
});

test('visual insertion can add repeated assets before a block with unique caption IDs and cancel cleanly', { timeout: 45_000 }, async t => {
  const { page } = await openEditor(t, { mode: 'visual' });
  const canvas = await (await page.$('#visual')).contentFrame();
  await canvas.waitForSelector('.content > p');
  await canvas.click('.content > p');
  await page.click('#images');
  await page.click('#asset-list .asset');
  await page.select('#image-width', 'half');
  await page.select('#image-insert-position', 'before');
  await page.click('#apply-image');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelector('figure'));
  assert.ok((await value(page, '#source')).indexOf('<figure') < (await value(page, '#source')).indexOf('First page.'));
  await canvas.click('figure');
  const beforeCancel = await value(page, '#source');
  await page.$eval('#image-size', input => { input.value = '25'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.keyboard.press('Escape');
  assert.equal(await value(page, '#source'), beforeCancel);
  await canvas.click('figure');
  await page.click('#insert-another-image');
  await page.click('#asset-list .asset');
  await page.select('#image-width', 'half');
  await page.click('#apply-image');
  await page.waitForFunction(() => !document.querySelector('#image-dialog').open);
  const inserted = await value(page, '#source');
  assert.equal(figureRanges(inserted).length, 2);
  assert.match(inserted, /id="sth-001-route-caption-2"/);
  assert.match(inserted, /aria-labelledby="sth-001-route-caption-2"/);
});

test('details updates preserve body, private flags, proof records, and unfamiliar fields', async () => {
  const { updateMetadataFields, EditHistory } = await import('../editor/editor-model.js');
  const { loadDocument } = await import('../scripts/lib/metadata.mjs');
  const original = (await fixture()).replace('title: Fixture', '# Keep title note\ntitle: Fixture\n# Keep section note').replace('status: draft', 'status: draft\nprivate: true\nproofRecord: docs/publishing/proofs/record.json');
  const updated = updateMetadataFields(original, {
    title: 'Title: "quoted" $&',
    reviewers: { editor: 'Alice', subjectMatter: 'Bob', additionalRole: 'Carol' },
    sources: [{ type: 'local', title: 'Evidence', provider: 'Test', location: 'Repository', receivedDate: '2026-01-01', customField: 'Keep me' }]
  });
  const parsed = loadDocument(updated, 'fixture');
  assert.equal(parsed.data.title, 'Title: "quoted" $&');
  assert.match(updated, /title: "Title: \\"quoted\\" \$&"/);
  assert.match(updated, /# Keep title note/);
  assert.match(updated, /# Keep section note/);
  assert.equal(parsed.data.private, true);
  assert.equal(parsed.data.proofRecord, 'docs/publishing/proofs/record.json');
  assert.equal(parsed.data.reviewers.additionalRole, 'Carol');
  assert.equal(parsed.data.sources[0].customField, 'Keep me');
  assert.equal(parsed.content, loadDocument(original, 'fixture').content);
  assert.equal(loadDocument(updateMetadataFields(original.replaceAll('\n', '\r\n'), { title: 'CRLF' }), 'fixture').data.title, 'CRLF');
  assert.throws(() => updateMetadataFields(original, { title: 'Injected\nstatus: approved' }), /one line/);
  const history = new EditHistory(original);
  history.record(updated, true, 1000);
  history.record(updated + 'typing', true, 1100);
  assert.equal(history.undo(), original);
  assert.equal(history.redo(), updated + 'typing');
  history.undo(); history.record('branched');
  assert.equal(history.canRedo, false);
  history.reset('another handout');
  assert.equal(history.canUndo, false);
});

test('details endpoint reads incomplete drafts without bypassing approval checks', async t => {
  const { base, source } = await setup(t);
  const response = await fetch(`${base}/api/details`, { method: 'POST', body: JSON.stringify({ path: 'handouts/section/example.md', source: source.replace('title: Fixture', 'title:') }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).metadata.title, null);
  const forbidden = await fetch(`${base}/api/details`, { method: 'POST', body: JSON.stringify({ path: '../outside.md', source }) });
  assert.equal(forbidden.status, 400);
});

test('details form applies sources, checks approval, and supports undo across modes and save', { timeout: 60_000 }, async t => {
  const { page, source, file } = await openEditor(t, { mode: 'visual' });
  await page.click('#details');
  await page.waitForSelector('#details-dialog[open]');
  await page.$eval('#details-form [name="title"]', input => { input.value = 'Updated handout'; });
  await page.$eval('#details-form [name="editor"]', input => { input.value = 'Alice'; });
  await page.click('#check-approval');
  await page.waitForFunction(() => document.querySelector('#approval-result').textContent.includes('subjectMatter'));
  assert.equal(await value(page, '#source'), source);
  await page.$eval('#details-sources input[name="provider"]', input => { input.value = 'Updated provider'; });
  await page.click('#details-form button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('#details-dialog').open);
  assert.match(await value(page, '#source'), /title: "Updated handout"/);
  assert.match(await value(page, '#source'), /provider: "Updated provider"/);
  await page.click('#undo');
  assert.equal(await value(page, '#source'), source);
  await page.click('#source-mode');
  await page.click('#redo');
  assert.match(await value(page, '#source'), /Updated handout/);
  await page.click('#save');
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
  assert.match(await fs.readFile(file, 'utf8'), /Updated provider/);
  await page.click('#undo');
  assert.equal(await value(page, '#source'), source);
  assert.equal(await text(page, '#state'), 'Unsaved changes');
});

test('visual component tools insert at the selected block and edit tables without switching modes', { timeout: 60_000 }, async t => {
  const { page } = await openEditor(t, { mode: 'visual' });
  const canvas = await (await page.$('#visual')).contentFrame();
  await canvas.waitForSelector('[data-visual-block]');
  await canvas.evaluate(() => [...document.querySelectorAll('[data-visual-block]')].find(block => block.textContent.includes('First page.')).click());
  await page.click('#toolbar [data-block="warning"]');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelector('.warning'));
  const warningSource = await value(page, '#source');
  assert.ok(warningSource.indexOf('class="warning"') > warningSource.indexOf('First page.'));
  assert.ok(warningSource.indexOf('class="warning"') < warningSource.indexOf('<!-- pagebreak -->'));
  assert.equal(await page.$eval('#source', input => input.hidden), true);
  await page.click('#undo');
  await page.waitForFunction(() => !document.querySelector('#visual').contentDocument?.querySelector('.warning'));
  await page.click('#toolbar [data-insert*="Heading"]');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelector('table'));
  await (await (await page.$('#visual')).contentFrame()).click('td');
  await page.click('#table-row');
  await page.click('#table-column');
  assert.equal(await page.$eval('#visual', frame => frame.contentDocument.querySelectorAll('table tr').length), 3);
  assert.equal(await page.$eval('#visual', frame => frame.contentDocument.querySelector('table tr').cells.length), 3);
  await page.click('#remove-component');
  await page.waitForFunction(() => !document.querySelector('#visual').contentDocument?.querySelector('table'));
  await page.click('#undo');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelectorAll('table tr').length === 3);
  assert.equal(await page.$eval('#visual-mode', button => button.getAttribute('aria-pressed')), 'true');
});

test('visual typing shortcuts and page breaks share history and keep page counts valid', { timeout: 60_000 }, async t => {
  const { page, source } = await openEditor(t, { mode: 'visual' });
  const canvas = await (await page.$('#visual')).contentFrame();
  await canvas.waitForSelector('[data-visual-block]');
  await canvas.evaluate(() => {
    const paragraph = [...document.querySelectorAll('.content p')].find(element => element.textContent === 'First page.');
    paragraph.focus();
    const range = document.createRange(); range.selectNodeContents(paragraph); range.collapse(false);
    const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.type(' Changed.');
  assert.match(await value(page, '#source'), /Changed/);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  assert.equal(await value(page, '#source'), source);
  await page.click('#redo');
  assert.match(await value(page, '#source'), /Changed/);
  await page.click('#toolbar [data-insert*="pagebreak"]');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelectorAll('.sheet').length === 3);
  assert.match(await value(page, '#source'), /^pageCount: 3$/m);
  await page.click('#undo');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument?.querySelectorAll('.sheet').length === 2);
  assert.match(await value(page, '#source'), /Changed/);
  await page.click('#source-mode');
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  assert.equal(await value(page, '#source'), source);
});

test('preview controls fit the page, zoom, and navigate without editing source', { timeout: 60_000 }, async t => {
  const { page, source } = await openEditor(t);
  await page.waitForFunction(() => document.querySelector('#preview-page-count').textContent === 'of 2');
  const fit = await page.$eval('#preview', frame => {
    const doc = frame.contentDocument;
    return { pageWidth: doc.querySelector('.sheet').getBoundingClientRect().width, viewport: doc.documentElement.clientWidth, scrollWidth: doc.documentElement.scrollWidth };
  });
  assert.ok(fit.pageWidth < fit.viewport, 'Fit to width shows the complete print page');
  assert.ok(fit.scrollWidth <= fit.viewport + 1, 'Fitted preview has no horizontal scrolling');
  await page.select('#preview-zoom', '100');
  assert.equal(await text(page, '#preview-scale'), '100%');
  assert.equal(Math.round(await page.$eval('#preview', frame => frame.contentDocument.querySelector('.sheet').getBoundingClientRect().width)), 816);
  await page.click('#preview-next');
  assert.equal(await value(page, '#preview-page'), '2');
  assert.equal(await page.$eval('#preview-next', button => button.disabled), true);
  await page.select('#preview-zoom', 'fit');
  assert.equal(await value(page, '#preview-page'), '2');
  await page.$eval('#preview-page', input => { input.value = '1'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await value(page, '#preview-page'), '1');
  await page.select('#preview-zoom', '200');
  assert.equal(Math.round(await page.$eval('#preview', frame => frame.contentDocument.querySelector('.sheet').getBoundingClientRect().width)), 1632);
  await page.select('#preview-zoom', '25');
  await page.click('#preview-next');
  assert.equal(await value(page, '#preview-page'), '2', 'Page navigation also works when the entire document fits');
  await page.select('#preview-zoom', '100');
  assert.equal(await value(page, '#preview-page'), '2', 'Zooming in retains the selected page');
  await page.select('#preview-zoom', '200');
  await page.emulateMediaType('print');
  assert.equal(Math.round(await page.$eval('#preview', frame => frame.contentDocument.querySelector('.sheet').getBoundingClientRect().width)), 816, 'Preview scaling never changes print geometry');
  await page.emulateMediaType('screen');
  assert.equal(Math.round(await page.$eval('#preview', frame => frame.contentDocument.querySelector('.sheet').getBoundingClientRect().width)), 1632);
  assert.equal(await value(page, '#source'), source);
  assert.equal(await text(page, '#state'), 'Saved');
});

test('preview refresh retains the page and scroll offset and resets for another handout', { timeout: 60_000 }, async t => {
  const { page, source } = await openEditor(t);
  await page.waitForFunction(() => document.querySelector('#preview-page-count').textContent === 'of 2');
  await page.select('#preview-zoom', '100');
  await page.click('#preview-next');
  const scrollPosition = () => page.$eval('#preview', frame => {
    const doc = frame.contentDocument;
    const sheet = doc.querySelectorAll('.sheet')[1];
    const bounds = sheet.getBoundingClientRect();
    return { offset: -bounds.top / bounds.height, left: frame.contentWindow.scrollX, revision: doc.documentElement.dataset.previewRevision };
  });
  await page.$eval('#preview', frame => { frame.contentWindow.scrollBy(80, 90); });
  const before = await scrollPosition();
  await replaceSource(page, `${source}\nPreview refresh test.`);
  await page.waitForFunction(revision => {
    const doc = document.querySelector('#preview').contentDocument;
    return doc?.documentElement?.dataset.previewRevision !== revision && doc?.body?.textContent.includes('Preview refresh test.');
  }, {}, before.revision);
  await page.waitForFunction(() => document.querySelector('#preview-page').value === '2');
  const after = await scrollPosition();
  assert.ok(Math.abs(after.offset - before.offset) < .02, `page-relative offset retained: ${before.offset} -> ${after.offset}`);
  assert.ok(Math.abs(after.left - before.left) < 2, 'horizontal position retained at manual zoom');
  // Removing a page clamps the retained location to the remaining document.
  const onePage = source.replace('pageCount: 2', 'pageCount: 1').replace('<!-- pagebreak -->', '');
  await replaceSource(page, onePage);
  await page.waitForFunction(() => document.querySelector('#preview-page-count').textContent === 'of 1');
  assert.equal(await value(page, '#preview-page'), '1');
  page.once('dialog', dialog => dialog.accept());
  await page.select('#handout', 'handouts/section/second.md');
  await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.title === 'Second fixture');
  await page.waitForFunction(() => document.querySelector('#preview-page-count').textContent === 'of 2');
  assert.equal(await value(page, '#preview-page'), '1');
  assert.equal(await page.$eval('#preview', frame => frame.contentWindow.scrollY), 0);
});

test('preview panes resize by keyboard and pointer and preview-only mode works on desktop and mobile', { timeout: 60_000 }, async t => {
  const { page, source } = await openEditor(t);
  await page.setViewport({ width: 1440, height: 900 });
  await page.waitForFunction(() => document.querySelector('#preview-page-count').textContent === 'of 2');
  await page.focus('#pane-splitter');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('#pane-splitter', splitter => splitter.getAttribute('aria-valuenow')), '49');
  await page.keyboard.press('Home');
  assert.equal(await page.$eval('#pane-splitter', splitter => splitter.getAttribute('aria-valuenow')), '25');
  await page.keyboard.press('End');
  assert.equal(await page.$eval('#pane-splitter', splitter => splitter.getAttribute('aria-valuenow')), '75');
  const bounds = await page.$eval('#pane-splitter', splitter => { const r = splitter.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 20 }; });
  await page.mouse.move(bounds.x, bounds.y); await page.mouse.down(); await page.mouse.move(850, bounds.y, { steps: 5 }); await page.mouse.up();
  const split = Number(await page.$eval('#pane-splitter', splitter => splitter.getAttribute('aria-valuenow')));
  assert.ok(split >= 58 && split <= 61, `Pointer resized the panes: ${split}%`);
  const initialWidth = await page.$eval('#preview', frame => frame.clientWidth);
  await page.click('#preview-only');
  assert.equal(await page.$eval('.editor-column', column => getComputedStyle(column).display), 'none');
  assert.equal(await page.$eval('#preview-only', button => button.getAttribute('aria-pressed')), 'true');
  assert.ok(await page.$eval('#preview', frame => frame.clientWidth) > initialWidth);
  await page.$eval('#preview', frame => frame.contentWindow.focus()); await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#preview-only', button => button.getAttribute('aria-pressed')), 'false');
  assert.equal(await page.$eval('#pane-splitter', splitter => splitter.getAttribute('aria-valuenow')), String(split));
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const doc = document.querySelector('#preview').contentDocument;
    return doc?.querySelector('.sheet').getBoundingClientRect().width < doc.documentElement.clientWidth;
  });
  assert.equal(await page.$eval('#pane-splitter', splitter => getComputedStyle(splitter).display), 'none');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.click('#preview-only');
  assert.equal(await page.$eval('.editor-column', column => getComputedStyle(column).display), 'none');
  await page.click('#preview-only');
  assert.equal(await value(page, '#source'), source);
});

test('a delayed preview response cannot replace the current proof or its navigation state', { timeout: 60_000 }, async t => {
  const { page, source } = await openEditor(t);
  await page.waitForFunction(() => document.querySelector('#preview-page-count').textContent === 'of 2');
  await page.evaluate(() => {
    const actualFetch = window.fetch.bind(window);
    let release;
    window.releaseOldPreview = () => release?.();
    window.fetch = (url, options) => {
      const body = options?.body && JSON.parse(options.body);
      if (url === '/api/render' && body?.source.includes('Old proof response')) {
        window.oldPreviewRequested = true;
        const response = actualFetch(url, { ...options, signal: undefined });
        return new Promise(resolve => { release = () => response.then(resolve); });
      }
      return actualFetch(url, options);
    };
  });
  await replaceSource(page, `${source}\nOld proof response.`);
  await page.waitForFunction(() => window.oldPreviewRequested);
  await replaceSource(page, `${source}\nNew proof response.`);
  await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.body?.textContent.includes('New proof response.'));
  await page.select('#preview-zoom', '100'); await page.click('#preview-next');
  await page.evaluate(() => window.releaseOldPreview());
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await page.$eval('#preview', frame => frame.contentDocument.body.textContent.includes('New proof response.')), true);
  assert.equal(await value(page, '#preview-page'), '2');
  assert.equal(await text(page, '#preview-scale'), '100%');
});

const newHandoutRequest = { session: 'library-test-session', title: 'New checklist', sectionNumber: 1, library: 'public', template: 'checklist', reviewDate: '2026-10-26' };
async function libraryPost(base, endpoint, data) {
  const response = await fetch(base + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  return { status: response.status, data: await response.json() };
}

test('new handouts use template components and reserve unique sequential section codes', async t => {
  const { base, root, source, file } = await setup(t);
  const options = await (await fetch(base + '/api/library-options')).json();
  assert.equal(options.sections.length, 8);
  assert.equal(options.sections[0].nextCode, 'STH-003');
  assert.deepEqual(options.libraries, ['public']);
  const results = await Promise.all(['checklist', 'procedure'].map(template => libraryPost(base, '/api/handouts/new', { ...newHandoutRequest, template })));
  assert.deepEqual(results.map(result => result.status), [201, 201]);
  assert.deepEqual(results.map(result => result.data.code).sort(), ['STH-003', 'STH-004']);
  const { loadDocument } = await import('../scripts/lib/metadata.mjs');
  for (const { data } of results) {
    const raw = await fs.readFile(path.join(root, data.path), 'utf8');
    const document = loadDocument(raw, data.path);
    assert.equal(document.data.status, 'draft');
    assert.equal(document.data.sectionNumber, 1);
    assert.deepEqual(document.data.reviewers, { editor: 'Unassigned', subjectMatter: 'Unassigned' });
    assert.equal(document.data.proofRecord, undefined);
    assert.match(raw, /class="(?:checklist|procedure)"/);
    const validation = await libraryPost(base, '/api/validate', { path: data.path, source: raw, phase: 'syntax', session: 'new-validation' });
    assert.equal(validation.data.valid, true, JSON.stringify(validation.data));
  }
  assert.equal(await fs.readFile(file, 'utf8'), source);
});

test('duplication resets approval and copies image bytes and credits into an independent manifest', async t => {
  const { base, root, source, file } = await setup(t);
  const opened = await (await fetch(base + '/api/handout?path=handouts/section/example.md')).json();
  const entry = opened.assets[0];
  const approved = source.replace('status: draft', 'status: approved\nproofRecord: docs/publishing/proofs/original.md').replace('editor: Unassigned', 'editor: Alice').replace('subjectMatter: Unassigned', 'subjectMatter: Bob') + '\n' + figureMarkup('STH-001', entry);
  await fs.writeFile(file, approved);
  const refreshed = await libraryPost(base, '/api/library/refresh', { session: 'duplicate-refresh' });
  assert.equal(refreshed.status, 200);
  const original = await (await fetch(base + '/api/handout?path=handouts/section/example.md')).json();
  const result = await libraryPost(base, '/api/handouts/new', { ...newHandoutRequest, title: 'Copied "route"', sectionNumber: 2, sourcePath: original.path, revision: original.revision });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.code, 'COM-001');
  const copied = await (await fetch(base + '/api/handout?path=' + encodeURIComponent(result.data.path))).json();
  const { loadDocument } = await import('../scripts/lib/metadata.mjs');
  const metadata = loadDocument(copied.source, copied.path).data;
  assert.equal(metadata.status, 'draft');
  assert.equal(metadata.title, 'Copied "route"');
  assert.equal(metadata.proofRecord, undefined);
  assert.equal(metadata.version, '0.1');
  assert.deepEqual(metadata.reviewers, { editor: 'Unassigned', subjectMatter: 'Unassigned' });
  assert.deepEqual(copied.assets, original.assets);
  assert.match(copied.source, /\.\.\/assets\/handouts\/COM-001\/route.svg/);
  assert.doesNotMatch(copied.source, /\.\.\/assets\/handouts\/STH-001\//);
  const encoded = await fs.readFile(path.join(root, 'assets/handouts/COM-001/route.svg.base64'), 'ascii');
  assert.equal(Buffer.from(encoded.replace(/\s/g, ''), 'base64').toString(), await fs.readFile(path.join(root, 'assets/handouts/STH-001/route.svg'), 'utf8'));
  assert.equal(await fs.readFile(file, 'utf8'), approved);
  assert.equal((await fetch(base + '/assets/handouts/COM-001/route.svg')).status, 200);
});

test('creation rejects stale originals, invalid requests, and symlink destinations without writing files', async t => {
  const { base, root, file } = await setup(t);
  const original = await (await fetch(base + '/api/handout?path=handouts/section/example.md')).json();
  await fs.appendFile(file, '\nChanged on disk.');
  const stale = await libraryPost(base, '/api/handouts/new', { ...newHandoutRequest, sourcePath: original.path, revision: original.revision });
  assert.equal(stale.status, 409);
  for (const changes of [{ sectionNumber: 9 }, { reviewDate: '2026-02-30' }, { title: 'Injected\nstatus: approved' }, { template: 'unknown' }, { session: '' }]) {
    const invalid = await libraryPost(base, '/api/handouts/new', { ...newHandoutRequest, ...changes });
    assert.ok(invalid.status >= 400, JSON.stringify(changes));
  }
  const traversal = await libraryPost(base, '/api/handouts/new', { ...newHandoutRequest, sourcePath: '../outside.md' });
  assert.equal(traversal.status, 404);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(root, 'handouts/hands-on-skills'));
  const fresh = await (await fetch(base + '/api/handout?path=handouts/section/example.md')).json();
  const symlink = await libraryPost(base, '/api/handouts/new', { ...newHandoutRequest, sectionNumber: 6, sourcePath: fresh.path, revision: fresh.revision });
  assert.equal(symlink.status, 422);
  assert.deepEqual(await fs.readdir(outside), []);
  await assert.rejects(fs.access(path.join(root, 'assets/handouts/SKL-001')), 'Copied assets are rolled back if the source destination is refused');
  const plainText = await fetch(base + '/api/handouts/new', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(newHandoutRequest) });
  assert.equal(plainText.status, 415);
  const list = await (await fetch(base + '/api/handouts')).json();
  assert.equal(list.length, 2);
});

test('refresh discovers external files and keeps the previous allowlist if a library is invalid', async t => {
  const { base, root, source } = await setup(t);
  const added = 'handouts/section/external.md';
  await fs.writeFile(path.join(root, added), source.replaceAll('STH-001', 'STH-050').replace('title: Fixture', 'title: External file'));
  assert.equal((await fetch(base + '/api/handout?path=' + added)).status, 404);
  const refreshed = await libraryPost(base, '/api/library/refresh', { session: 'refresh-test-session' });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.handouts.length, 3);
  assert.equal((await fetch(base + '/api/handout?path=' + added)).status, 200);
  await fs.writeFile(path.join(root, 'handouts/section/broken.md'), 'Invalid source');
  const failed = await libraryPost(base, '/api/library/refresh', { session: 'refresh-test-session' });
  assert.equal(failed.status, 422);
  assert.equal((await (await fetch(base + '/api/handouts')).json()).length, 3);
  assert.equal((await fetch(base + '/api/handout?path=handouts/section/broken.md')).status, 404);
});

test('browser creates and duplicates template drafts and cancellation creates no files', { timeout: 60_000 }, async t => {
  const { page, root } = await openEditor(t, { mode: 'visual' });
  await page.click('#new-handout'); await page.waitForSelector('#create-dialog[open]');
  await page.keyboard.press('Escape');
  assert.equal(await page.$$eval('#handout option', options => options.length), 2);
  await page.click('#preview-only');
  await page.click('#new-handout'); await page.waitForSelector('#create-dialog[open]');
  await page.$eval('#create-form [name="title"]', input => { input.value = 'Community checklist'; });
  await page.select('#create-form [name="sectionNumber"]', '2');
  await page.select('#create-form [name="template"]', 'checklist');
  await page.click('#create-submit');
  await page.waitForFunction(() => document.querySelector('#source').value.includes('code: "COM-001"'));
  assert.equal(await value(page, '#document-status'), 'draft');
  assert.equal(await page.$eval('#preview-only', button => button.getAttribute('aria-pressed')), 'false');
  assert.match(await value(page, '#source'), /class="checklist"/);
  const originalPath = await value(page, '#handout');
  const original = await fs.readFile(path.join(root, originalPath), 'utf8');
  await page.click('#duplicate-handout'); await page.waitForSelector('#create-dialog[open]');
  assert.equal(await page.$eval('#create-template-label', label => label.hidden), true);
  await page.$eval('#create-form [name="title"]', input => { input.value = 'Another checklist'; });
  await page.select('#create-form [name="sectionNumber"]', '3');
  await page.click('#create-submit');
  await page.waitForFunction(() => document.querySelector('#source').value.includes('code: "EVS-001"'));
  assert.equal(await text(page, '#state'), 'Saved');
  assert.equal(await fs.readFile(path.join(root, originalPath), 'utf8'), original);
  assert.equal(await page.$$eval('#handout option', options => options.length), 4);
});

test('browser refresh preserves unsaved text and selections and creation requires saving first', { timeout: 60_000 }, async t => {
  const { page, root, source } = await openEditor(t);
  const dirtySource = source + '\nKeep these unsaved edits.';
  await replaceSource(page, dirtySource);
  await page.$eval('#source', input => { input.focus(); input.setSelectionRange(10, 20); });
  await page.click('#new-handout');
  assert.equal(await page.$eval('#create-dialog', dialog => dialog.open), false);
  assert.match(await text(page, '#message'), /Save or revert/);
  await fs.writeFile(path.join(root, 'handouts/section/external.md'), source.replace('STH-001', 'STH-050'));
  await page.click('#refresh-handouts');
  await page.waitForFunction(() => document.querySelector('#handout').options.length === 3);
  assert.equal(await value(page, '#source'), dirtySource);
  assert.equal(await text(page, '#state'), 'Unsaved changes');
  assert.deepEqual(await page.$eval('#source', input => [input.selectionStart, input.selectionEnd]), [10, 20]);
});

async function waitForPdfProof(base, job, session) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const result = await libraryPost(base, '/api/proofs/status', { id: job.id, session });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    if (['ready', 'failed', 'cancelled'].includes(result.data.state)) return result.data;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('PDF proof did not finish');
}
async function downloadPdfProof(base, job, session) {
  return fetch(base + '/api/proofs/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: job.id, session }) });
}
async function canonicalProof(t, root, source) {
  const { copyAssets, openPrintPage, prepareDirectories, renderPrintPdf } = await import('../scripts/lib/artifact-generation.mjs');
  const { loadAssetManifests } = await import('../scripts/lib/asset-validation.mjs');
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'canonical-editor-proof-'));
  t.after(() => fs.rm(output, { recursive: true, force: true }));
  const manifests = await loadAssetManifests(root);
  await prepareDirectories(root, output); await copyAssets(root, output, manifests);
  const template = await fs.readFile(path.join(root, 'templates/handout.html'), 'utf8');
  const html = renderHandoutSource(template, source, { sourcePath: 'handouts/section/example.md', manifests });
  const document = parseHandoutSource(source, 'handouts/section/example.md', manifests);
  const file = path.join(output, 'html', `${document.meta.code}.html`); await fs.writeFile(file, html);
  const browser = await puppeteer.launch(browserOptions());
  try { const page = await openPrintPage(browser, file); return await renderPrintPdf(page, document.meta.code, document.meta.pageCount); }
  finally { await browser.close(); }
}

test('PDF proof matches canonical renderer bytes and exports unsaved text without writing source or artifacts', { timeout: 60_000 }, async t => {
  const { base, root, source, file } = await setup(t);
  const session = 'proof-canonical-session';
  const snapshot = source + '\nThis text was not saved.';
  const started = await libraryPost(base, '/api/proofs/start', { path: 'handouts/section/example.md', source: snapshot, session });
  assert.equal(started.status, 202);
  const result = await waitForPdfProof(base, started.data, session);
  assert.equal(result.state, 'ready', JSON.stringify(result));
  assert.equal(result.pageCount, 2);
  const response = await downloadPdfProof(base, result, session);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'), /STH-001-proof.pdf/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes, await canonicalProof(t, root, snapshot));
  const { getPdfPageCount, inspectEmbeddedFonts } = await import('../scripts/lib/pdf-validation.mjs');
  assert.equal(await getPdfPageCount(bytes), 2);
  assert.ok(inspectEmbeddedFonts(bytes).embeddedPrograms);
  const { createHash } = await import('node:crypto');
  assert.equal(result.pdfSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(await fs.readFile(file, 'utf8'), source);
  await assert.rejects(fs.access(path.join(root, 'docs/pdfs/STH-001.pdf')));
  const other = await libraryPost(base, '/api/proofs/status', { id: result.id, session: 'other-editor-session' });
  assert.equal(other.status, 404);
  assert.equal((await downloadPdfProof(base, result, 'other-editor-session')).status, 404);
});

test('PDF proof reports source and layout failures and refuses their downloads', { timeout: 60_000 }, async t => {
  const { base, source } = await setup(t);
  const session = 'proof-invalid-session';
  for (const invalid of [source.replace('title: Fixture', 'title:'), source + '\n<div style="height:20in">Overflowing content</div>']) {
    const started = await libraryPost(base, '/api/proofs/start', { path: 'handouts/section/example.md', source: invalid, session });
    const result = await waitForPdfProof(base, started.data, session);
    assert.equal(result.state, 'failed');
    assert.ok(result.issues.length > 0);
    assert.equal((await downloadPdfProof(base, result, session)).status, 409);
  }
  const forbidden = await libraryPost(base, '/api/proofs/start', { path: '../outside.md', source, session });
  assert.equal(forbidden.status, 400);
});

test('PDF proof snapshots pending images even if the upload is discarded during the build', { timeout: 60_000 }, async t => {
  const { base, source, file, root } = await setup(t);
  const session = 'proof-staged-session';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Proof route</title><circle cx="5" cy="5" r="3"/></svg>';
  const upload = await libraryPost(base, '/api/assets', { path: 'handouts/section/example.md', session, name: 'Proof route.svg', mimeType: 'image/svg+xml', dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, type: 'diagram', alt: 'A proof route.', creator: 'Tester', source: 'Test', license: 'Test', options: { width: 20, align: 'left' } });
  assert.equal(upload.status, 201, JSON.stringify(upload.data));
  const started = await libraryPost(base, '/api/proofs/start', { path: 'handouts/section/example.md', session, source: source + '\n' + upload.data.markup });
  await libraryPost(base, '/api/assets/discard', { path: 'handouts/section/example.md', session });
  const result = await waitForPdfProof(base, started.data, session);
  assert.equal(result.state, 'ready', JSON.stringify(result));
  assert.equal((await downloadPdfProof(base, result, session)).status, 200);
  assert.equal(await fs.readFile(file, 'utf8'), source);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'assets/handouts/STH-001/manifest.json'), 'utf8'));
  assert.equal(manifest.assets.length, 1);
});

test('approved PDF proofs enforce proof records and exact PDF checksums', { timeout: 60_000 }, async t => {
  const { base, root, source } = await setup(t);
  const session = 'proof-approval-session';
  const approved = source.replace('status: draft', 'status: approved').replace('editor: Unassigned', 'editor: Alice').replace('subjectMatter: Unassigned', 'subjectMatter: Bob');
  const missing = await libraryPost(base, '/api/proofs/start', { path: 'handouts/section/example.md', session, source: approved });
  const rejected = await waitForPdfProof(base, missing.data, session);
  assert.equal(rejected.state, 'failed');
  assert.match(rejected.error, /require proofRecord/);
  assert.equal((await downloadPdfProof(base, rejected, session)).status, 409);
  const candidate = approved.replace('status: approved', 'status: approved\nproofRecord: docs/publishing/proofs/candidate.md');
  const directory = path.join(root, 'docs/publishing/proofs'); await fs.mkdir(directory, { recursive: true });
  const record = `handoutCode: STH-001\npdfPath: docs/pdfs/STH-001.pdf\nsourceCommit: ${'a'.repeat(40)}\npdfSha256: CHECKSUM\nprinterModel: Test\ndriverOrApplication: Test\npaperSize: Letter\nscaling: 100%\nduplex: Long edge\nreviewer: Alice\ndate: 2026-10-26\ngrayscaleOutcome: PASS\npunchClearanceOutcome: PASS\nmeasuredAlignment: PASS\n`;
  await fs.writeFile(path.join(directory, 'candidate.md'), record.replace('CHECKSUM', '0'.repeat(64)));
  const wrong = await libraryPost(base, '/api/proofs/start', { path: 'handouts/section/example.md', session, source: candidate });
  const badChecksum = await waitForPdfProof(base, wrong.data, session);
  assert.match(badChecksum.error, /checksum does not match/);
  const { createHash } = await import('node:crypto');
  const checksum = createHash('sha256').update(await canonicalProof(t, root, candidate)).digest('hex');
  await fs.writeFile(path.join(directory, 'candidate.md'), record.replace('CHECKSUM', checksum));
  const valid = await libraryPost(base, '/api/proofs/start', { path: 'handouts/section/example.md', session, source: candidate });
  const result = await waitForPdfProof(base, valid.data, session);
  assert.equal(result.state, 'ready', JSON.stringify(result));
  assert.equal(result.pdfSha256, checksum);
});

test('PDF jobs can be cancelled and active builds are bounded', { timeout: 60_000 }, async t => {
  const { base, source } = await setup(t);
  const payload = { path: 'handouts/section/example.md', source };
  const first = await libraryPost(base, '/api/proofs/start', { ...payload, session: 'proof-capacity-one' });
  const second = await libraryPost(base, '/api/proofs/start', { ...payload, session: 'proof-capacity-two' });
  const third = await libraryPost(base, '/api/proofs/start', { ...payload, session: 'proof-capacity-three' });
  assert.equal(first.status, 202); assert.equal(second.status, 202); assert.equal(third.status, 429);
  for (const [job, session] of [[first.data, 'proof-capacity-one'], [second.data, 'proof-capacity-two']]) {
    const cancel = await libraryPost(base, '/api/proofs/cancel', { id: job.id, session });
    assert.equal(cancel.status, 200);
    assert.equal((await libraryPost(base, '/api/proofs/status', { id: job.id, session })).status, 404);
  }
  const next = await libraryPost(base, '/api/proofs/start', { ...payload, session: 'proof-capacity-three' });
  assert.equal(next.status, 202);
  assert.equal((await waitForPdfProof(base, next.data, 'proof-capacity-three')).state, 'ready');
});

test('PDF proof applies the full build image-resolution requirement', { timeout: 60_000 }, async t => {
  const { base, source } = await setup(t);
  const session = 'proof-resolution-session';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfbkAAAAASUVORK5CYII=';
  const upload = await libraryPost(base, '/api/assets', { path: 'handouts/section/example.md', session, name: 'pixel.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${png}`, type: 'photograph', alt: 'Single pixel.', creator: 'Tester', source: 'Test', license: 'Test', options: { width: 20 } });
  assert.equal(upload.status, 201);
  const started = await libraryPost(base, '/api/proofs/start', { path: 'handouts/section/example.md', session, source: source + '\n' + upload.data.markup });
  const result = await waitForPdfProof(base, started.data, session);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /below 200 PPI/);
  assert.equal((await downloadPdfProof(base, result, session)).status, 409);
});

test('browser builds and downloads a proof, marks edited proofs stale, and rebuilds the current text', { timeout: 60_000 }, async t => {
  const { page, source, file } = await openEditor(t);
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.downloadedProofBlob = blob; return original(blob); };
    document.addEventListener('click', event => { if (event.target.matches('a[download]')) { event.preventDefault(); window.downloadedProofName = event.target.download; } });
  });
  await page.click('#build-proof'); await page.waitForSelector('#proof-dialog[open]');
  await page.keyboard.press('Escape');
  await replaceSource(page, source + '\nAn edit made while the proof was building.');
  await page.waitForFunction(() => document.querySelector('#proof-state').textContent === 'PDF proof ready.');
  assert.equal(await page.$eval('#proof-download', button => button.disabled), true);
  assert.equal(await page.$eval('#proof-stale', element => element.hidden), false);
  await page.click('#build-proof');
  await page.waitForFunction(() => !document.querySelector('#proof-download').disabled);
  assert.match(await text(page, '#proof-summary'), /2 pages.*Built from unsaved edits/);
  await page.click('#proof-download');
  await page.waitForFunction(() => window.downloadedProofName === 'STH-001-proof.pdf');
  assert.equal(await page.evaluate(() => window.downloadedProofBlob.type), 'application/pdf');
  assert.equal(await page.evaluate(async () => String.fromCharCode(...new Uint8Array(await window.downloadedProofBlob.arrayBuffer()).slice(0, 5))), '%PDF-');
  assert.equal(await fs.readFile(file, 'utf8'), source);
});

test('browser proof validation links return to the source line that needs fixing', { timeout: 60_000 }, async t => {
  const { page, source } = await openEditor(t);
  await replaceSource(page, source.replace('title: Fixture', 'title:'));
  await page.click('#build-proof');
  await page.waitForSelector('#proof-issues button');
  assert.equal(await page.$eval('#proof-download', button => button.disabled), true);
  await page.click('#proof-issues button');
  assert.equal(await page.$eval('#proof-dialog', dialog => dialog.open), false);
  assert.equal(await page.$eval('#source', source => source.value.slice(source.selectionStart, source.selectionEnd)), 'title:');
});

test('simultaneous saves from the same revision have exactly one winner', async t => {
  const { base, source, file } = await setup(t);
  const opened = await (await fetch(base + '/api/handout?path=handouts/section/example.md')).json();
  const results = await Promise.all(['first', 'second'].map(label => libraryPost(base, '/api/save', { path: opened.path, revision: opened.revision, source: source + `\n${label} edit.`, session: `concurrent-${label}` })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.findIndex(result => result.status === 200);
  assert.equal(await fs.readFile(file, 'utf8'), source + `\n${winner === 0 ? 'first' : 'second'} edit.`);
});

test('uploads arriving during a save remain pending and can be saved afterward', async t => {
  const { base, source } = await setup(t);
  const opened = await (await fetch(base + '/api/handout?path=handouts/section/example.md')).json();
  const session = 'late-upload-session';
  const upload = name => libraryPost(base, '/api/assets', { path: opened.path, session, name, mimeType: 'image/svg+xml', dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Image</title><circle cx="5" cy="5" r="4"/></svg>').toString('base64')}`, type: 'diagram', alt: name, creator: 'Tester', source: 'Test', license: 'Test', options: { width: 20 } });
  const first = await upload('first.svg'); assert.equal(first.status, 201);
  const realCopy = fs.copyFile;
  let release; let reached;
  const paused = new Promise(resolve => { reached = resolve; });
  const continueCopy = new Promise(resolve => { release = resolve; });
  fs.copyFile = async (...args) => { if (String(args[0]).endsWith('first.svg.base64')) { reached(); await continueCopy; } return realCopy(...args); };
  t.after(() => { fs.copyFile = realCopy; release(); });
  const saving = libraryPost(base, '/api/save', { path: opened.path, session, revision: opened.revision, source: source + '\n' + first.data.markup });
  await paused;
  const second = await upload('later.svg'); assert.equal(second.status, 201);
  release(); const saved = await saving;
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.committedAssets, ['first.svg']);
  const after = await (await fetch(base + `/api/handout?path=${opened.path}&session=${session}`)).json();
  assert.equal(after.assets.find(asset => asset.file === 'later.svg').pending, true);
  const final = await libraryPost(base, '/api/save', { path: opened.path, session, revision: saved.data.revision, source: after.source + '\n' + second.data.markup });
  assert.equal(final.status, 200);
  assert.deepEqual(final.data.committedAssets, ['later.svg']);
});

test('change review merges independent disk edits without writing until Save and supports undo', { timeout: 60_000 }, async t => {
  const { page, source, file } = await openEditor(t);
  const yours = source.replace('First page.', 'Your first paragraph.');
  const disk = source.replace('Second page.', 'Disk second paragraph.');
  await replaceSource(page, yours);
  await page.click('#review-changes');
  await page.waitForSelector('#changes-dialog[open]');
  assert.match(await text(page, '#changes-diff'), /Your first paragraph/);
  assert.match(await text(page, '#changes-summary'), /1 added line.*1 removed line/);
  await fs.writeFile(file, disk);
  await page.click('#changes-compare');
  await page.waitForFunction(() => !document.querySelector('#changes-apply').disabled);
  const merged = await value(page, '#changes-proposed');
  assert.match(merged, /Your first paragraph/); assert.match(merged, /Disk second paragraph/);
  assert.equal(await fs.readFile(file, 'utf8'), disk);
  await page.click('#changes-apply');
  assert.equal(await value(page, '#source'), merged);
  assert.equal(await fs.readFile(file, 'utf8'), disk);
  await page.click('#undo'); assert.equal(await value(page, '#source'), yours);
  await page.click('#redo'); assert.equal(await value(page, '#source'), merged);
  await page.click('#save'); await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
  assert.equal(await fs.readFile(file, 'utf8'), merged);
});

test('overlapping changes require a choice and another disk change remains protected after applying', { timeout: 60_000 }, async t => {
  const { page, source, file } = await openEditor(t);
  const yours = source.replace('title: Fixture', 'title: Your heading');
  const disk = source.replace('title: Fixture', 'title: Disk heading');
  await replaceSource(page, yours); await fs.writeFile(file, disk);
  await page.click('#save'); await page.waitForFunction(() => !document.querySelector('#conflict-banner').hidden);
  await page.click('#compare-disk'); await page.waitForSelector('.merge-conflict button');
  assert.equal(await page.$eval('#changes-apply', button => button.disabled), true);
  assert.match(await text(page, '#changes-conflicts'), /Your heading/); assert.match(await text(page, '#changes-conflicts'), /Disk heading/);
  await page.click('.merge-conflict button');
  assert.equal(await page.$eval('#changes-apply', button => button.disabled), false);
  await page.$eval('#changes-proposed', input => { input.value += '\nManually combined explanation.'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#changes-apply');
  const applied = await value(page, '#source'); assert.match(applied, /Your heading/); assert.match(applied, /Manually combined/);
  await fs.writeFile(file, disk + '\nChanged again.');
  await page.click('#save'); await page.waitForFunction(() => !document.querySelector('#conflict-banner').hidden);
  assert.equal(await value(page, '#source'), applied);
  assert.equal(await fs.readFile(file, 'utf8'), disk + '\nChanged again.');
});

test('restoring an older browser draft retains its original baseline for a safe three-way merge', { timeout: 60_000 }, async t => {
  const { page, source, base, file } = await openEditor(t);
  const opened = await (await fetch(base + '/api/handout?path=handouts/section/example.md')).json();
  const yours = source.replace('First page.', 'Recovered browser edit.');
  const disk = source.replace('Second page.', 'New disk edit.');
  await page.evaluate(({ source, yours, revision }) => localStorage.setItem('handout-editor:draft:handouts/section/example.md', JSON.stringify({ source: yours, baseSource: source, revision, updatedAt: Date.now() })), { source, yours, revision: opened.revision });
  await fs.writeFile(file, disk); await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.querySelector('#draft-recovery').hidden);
  await page.click('#restore-draft');
  assert.equal(await value(page, '#source'), yours);
  assert.equal(await page.$eval('#conflict-banner', banner => banner.hidden), false);
  const recovered = await page.evaluate(() => JSON.parse(localStorage.getItem('handout-editor:draft:handouts/section/example.md')));
  assert.equal(recovered.baseSource, source); assert.equal(recovered.revision, opened.revision);
  await page.click('#compare-disk'); await page.waitForFunction(() => !document.querySelector('#changes-apply').disabled);
  assert.match(await value(page, '#changes-proposed'), /Recovered browser edit/); assert.match(await value(page, '#changes-proposed'), /New disk edit/);
  await page.click('#changes-apply'); await page.click('#save');
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
  assert.match(await fs.readFile(file, 'utf8'), /Recovered browser edit/); assert.match(await fs.readFile(file, 'utf8'), /New disk edit/);
});

test('legacy browser drafts without a baseline require explicit review and using disk text remains undoable', { timeout: 60_000 }, async t => {
  const { page, source, base, file } = await openEditor(t);
  const opened = await (await fetch(base + '/api/handout?path=handouts/section/example.md')).json();
  const yours = source + '\nLegacy browser draft.'; const disk = source + '\nNew disk paragraph.';
  await page.evaluate(({ yours, revision }) => localStorage.setItem('handout-editor:draft:handouts/section/example.md', JSON.stringify({ source: yours, revision, updatedAt: Date.now() })), { yours, revision: opened.revision });
  await fs.writeFile(file, disk); await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.querySelector('#draft-recovery').hidden); await page.click('#restore-draft');
  await page.click('#review-changes'); await page.waitForSelector('.merge-conflict button');
  assert.equal(await page.$eval('#changes-apply', button => button.disabled), true);
  assert.match(await text(page, '#changes-status'), /no saved baseline/);
  await page.click('#changes-use-disk'); assert.equal(await value(page, '#source'), disk);
  assert.equal(await page.evaluate(() => localStorage.getItem('handout-editor:draft:handouts/section/example.md')), null);
  await page.click('#undo'); assert.equal(await value(page, '#source'), yours);
  assert.equal(await fs.readFile(file, 'utf8'), disk);
});

test('edits made while a save response is delayed remain in the browser draft with the new saved baseline', { timeout: 60_000 }, async t => {
  const { page, source, file } = await openEditor(t);
  await page.evaluate(() => {
    const actual = window.fetch.bind(window); let release;
    window.releaseSave = () => release?.();
    window.fetch = (url, options) => {
      if (url === '/api/save') { window.saveStarted = true; const response = actual(url, options); return new Promise(resolve => { release = () => response.then(resolve); }); }
      return actual(url, options);
    };
  });
  const first = source + '\nFirst saved edit.'; const latest = first + '\nNewer unsaved edit.';
  await replaceSource(page, first); await page.click('#save'); await page.waitForFunction(() => window.saveStarted);
  await replaceSource(page, latest); await page.evaluate(() => window.releaseSave());
  await page.waitForFunction(() => !document.querySelector('#save').disabled);
  assert.equal(await value(page, '#source'), latest);
  assert.equal(await text(page, '#state'), 'Unsaved changes');
  assert.equal(await fs.readFile(file, 'utf8'), first);
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('handout-editor:draft:handouts/section/example.md')));
  assert.equal(draft.source, latest); assert.equal(draft.baseSource, first);
});

test('a delayed save response does not replace a different open handout', { timeout: 60_000 }, async t => {
  const { page, source } = await openEditor(t);
  await page.evaluate(() => {
    const actual = window.fetch.bind(window); let release;
    window.releaseSave = () => release?.();
    window.fetch = (url, options) => { if (url === '/api/save') { window.saveStarted = true; const response = actual(url, options); return new Promise(resolve => { release = () => response.then(resolve); }); } return actual(url, options); };
  });
  await replaceSource(page, source + '\nSave this handout.'); await page.click('#save'); await page.waitForFunction(() => window.saveStarted);
  page.once('dialog', dialog => dialog.accept()); await page.select('#handout', 'handouts/section/second.md');
  await page.waitForFunction(() => document.querySelector('#source').value.includes('code: STH-002'));
  const current = await value(page, '#source'); await page.evaluate(() => window.releaseSave());
  await page.waitForFunction(() => !document.querySelector('#save').disabled);
  assert.equal(await value(page, '#source'), current); assert.equal(await value(page, '#handout'), 'handouts/section/second.md');
});

test('merging text after a conflict preserves pending image uploads until Save', { timeout: 60_000 }, async t => {
  const { page, source, file, root } = await openEditor(t, { mode: 'visual' });
  const canvas = await (await page.$('#visual')).contentFrame();
  await canvas.waitForSelector('.content > p'); await canvas.click('.content > p');
  await page.click('#images');
  await (await page.$('#image-file')).uploadFile(path.join(root, 'assets/handouts/STH-001/route.svg'));
  for (const [selector, text] of [['#image-alt', 'Pending route.'], ['#image-creator', 'Tester'], ['#image-source', 'Test fixture'], ['#image-license', 'Test license']]) await page.type(selector, text);
  await page.click('#upload-image'); await page.waitForFunction(() => !document.querySelector('#image-dialog').open);
  assert.match(await value(page, '#source'), /route-2.svg/);
  await fs.writeFile(file, source + '\nA change from disk.');
  await page.click('#save'); await page.waitForFunction(() => !document.querySelector('#conflict-banner').hidden);
  await page.click('#compare-disk'); await page.waitForFunction(() => !document.querySelector('#changes-apply').disabled);
  assert.match(await text(page, '#changes-assets'), /1 pending image upload/);
  await page.click('#changes-apply');
  assert.match(await value(page, '#source'), /route-2.svg/); assert.match(await value(page, '#source'), /A change from disk/);
  await page.click('#save'); await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
  await fs.access(path.join(root, 'assets/handouts/STH-001/route-2.svg.base64'));
  assert.match(await fs.readFile(file, 'utf8'), /route-2.svg/);
});

test('document navigation moves and duplicates complete sections with shared undo and preserves page breaks', async t => {
  const { page, source: original, file } = await openEditor(t);
  const body = 'Intro.\n\n## Alpha\nAlpha text.\n### Child\nChild text.\n\n## Beta\nBeta text.\n\n<!-- pagebreak -->\n## Gamma\nGamma text.\n';
  const contents = original.slice(0, original.indexOf('<div class="custom">')) + body;
  await replaceSource(page, contents);
  await page.click('#document-outline summary');
  assert.equal(await page.$$eval('#outline-headings option', items => items.length), 4);
  await page.click('#section-down');
  const moved = await value(page, '#source');
  assert.ok(moved.indexOf('## Beta') < moved.indexOf('## Alpha'));
  assert.ok(moved.indexOf('### Child') > moved.indexOf('## Alpha'));
  assert.equal(moved.split('<!-- pagebreak -->')[1], contents.split('<!-- pagebreak -->')[1]);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  await page.click('#undo'); assert.equal(await value(page, '#source'), contents);
  await page.click('#redo'); assert.equal(await value(page, '#source'), moved);
  await page.select('#outline-headings', String(moved.indexOf('## Alpha')));
  await page.click('#section-duplicate');
  assert.equal((await value(page, '#source')).match(/## Alpha/g).length, 2);
  await page.click('#undo'); assert.equal(await value(page, '#source'), moved);
  const gamma = await page.$$eval('#outline-headings option', items => items.find(item => item.textContent.includes('Gamma')).value);
  await page.select('#outline-headings', gamma);
  assert.equal(await page.$eval('#section-up', button => button.disabled), true);
  assert.equal(await page.$eval('#section-down', button => button.disabled), true);
  assert.equal(await page.$eval('#source', element => element.value.slice(element.selectionStart, element.selectionEnd)), '## Gamma');
});

test('find replaces literal body matches, supports metadata opt-in, and undoes replace-all together', async t => {
  const { page, source: original, file } = await openEditor(t, { mode: 'visual' });
  await appendSource(page, '\n## Find fixture\nFixture fixture fixtures [$] fixtureé\n');
  const before = await value(page, '#source');
  await page.click('#find-toggle');
  await page.type('#find-query', 'fixture');
  await waitForText(page, '#find-count', '5 matches');
  await page.click('#find-word'); await waitForText(page, '#find-count', '3 matches');
  await page.click('#find-next');
  assert.equal(await page.$eval('#source', element => element.hidden), false);
  assert.equal(await page.$eval('#source', element => element.value.slice(element.selectionStart, element.selectionEnd)), 'fixture');
  await page.type('#find-replacement', '$&$1');
  page.once('dialog', dialog => dialog.accept());
  await page.click('#find-replace-all');
  const replaced = await value(page, '#source');
  assert.equal(replaced, before.replace('Find fixture\nFixture fixture', () => 'Find $&$1\n$&$1 $&$1'));
  assert.equal(await fs.readFile(file, 'utf8'), original);
  await page.click('#undo'); assert.equal(await value(page, '#source'), before);
  await page.click('#find-metadata');
  await waitForText(page, '#find-count', '5 matches');
  await page.click('#find-case');
  await waitForText(page, '#find-count', '2 matches');
  await page.click('#find-next');
  await page.click('#find-replace');
  assert.equal((await value(page, '#source')).split('$&$1').length - 1, 1);
  await page.click('#undo'); assert.equal(await value(page, '#source'), before);
});

async function openCommands(page, query = '') {
  await page.click('#commands');
  await page.waitForSelector('#commands-dialog[open]');
  if (query) await page.type('#command-query', query);
}

test('command palette filters actions, skips unavailable commands, and shows shortcuts without editing', async t => {
  const { page, source } = await openEditor(t);
  await openCommands(page, 'undo');
  assert.equal(await page.$eval('#command-results [role="option"]', option => option.getAttribute('aria-disabled')), 'true');
  assert.match(await text(page, '#command-results'), /No earlier edit/);
  await page.keyboard.press('Enter'); assert.equal(await page.$eval('#commands-dialog', dialog => dialog.open), true);
  await page.$eval('#command-query', input => { input.value = 'no such command'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await waitForText(page, '#command-count', 'No matching commands');
  assert.equal(await page.$eval('#command-query', input => input.hasAttribute('aria-activedescendant')), false);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#commands-dialog').open && !document.querySelector('#command-query').value);
  assert.equal(await value(page, '#command-query'), '');
  assert.equal(await page.$$eval('#command-results li', items => items.length), 0);
  assert.equal(await value(page, '#source'), source);
  await openCommands(page, 'keyboard help'); await page.keyboard.press('Enter');
  await page.waitForSelector('#shortcuts-dialog[open]');
  assert.match(await text(page, '#shortcuts-dialog'), /Ctrl\/Cmd\+K/);
  await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control');
  assert.equal(await page.$eval('#shortcuts-dialog', dialog => dialog.open), true);
  await page.keyboard.press('Escape');
  await openCommands(page, 'switch mode');
  await page.keyboard.press('ArrowDown');
  const selected = await page.$eval('#command-query', input => document.getElementById(input.getAttribute('aria-activedescendant')).textContent);
  assert.match(selected, /Visual/);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#source-mode', button => button.getAttribute('aria-pressed')), 'true');
});

test('command formatting preserves Source selection and uses shared undo, and Escape restores the cursor', async t => {
  const { page, source } = await openEditor(t);
  const at = source.indexOf('First page.');
  await page.$eval('#source', (element, at) => { element.focus(); element.setSelectionRange(at, at + 5); }, at);
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await page.type('#command-query', 'bold'); await page.keyboard.press('Enter');
  assert.equal(await value(page, '#source'), source.replace('First page.', '**First** page.'));
  await openCommands(page, 'undo'); await page.keyboard.press('Enter');
  assert.equal(await value(page, '#source'), source);
  await page.$eval('#source', (element, at) => { element.focus(); element.setSelectionRange(at, at + 5); }, at);
  await openCommands(page, 'warning'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#commands-dialog').open && document.activeElement.id === 'source');
  assert.equal(await page.$eval('#source', element => element.selectionStart), at);
  assert.equal(await page.$eval('#source', element => element.selectionEnd), at + 5);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'source');
});

test('command palette works from Visual and preview iframes, preserves Visual formatting and respects open dialogs', async t => {
  const { page } = await openEditor(t, { mode: 'visual' });
  const frame = await (await page.$('#visual')).contentFrame();
  await frame.waitForSelector('[data-visual-block]');
  await frame.evaluate(() => {
    const block = [...document.querySelectorAll('[data-visual-block]')].find(element => element.textContent === 'First page.');
    block.focus(); const range = document.createRange(); range.setStart(block.firstChild, 0); range.setEnd(block.firstChild, 5);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.keyboard.down('Meta'); await page.keyboard.press('k'); await page.keyboard.up('Meta');
  await page.waitForSelector('#commands-dialog[open]'); await page.type('#command-query', 'bold'); await page.keyboard.press('Enter');
  assert.match(await value(page, '#source'), /<b>First<\/b>|<strong>First<\/strong>/);
  await page.click('#undo');
  await page.click('#preview-only');
  const previewFrame = await (await page.$('#preview')).contentFrame(); await previewFrame.click('h1');
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await page.waitForSelector('#commands-dialog[open]'); await page.type('#command-query', 'switch source'); await page.keyboard.press('Enter');
  assert.equal(await page.$eval('body', body => body.classList.contains('preview-only')), false);
  assert.equal(await page.$eval('#source', element => element.hidden), false);
  await openCommands(page, 'handout details'); await page.keyboard.press('Enter');
  await page.waitForSelector('#details-dialog[open]');
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  assert.equal(await page.$eval('#commands-dialog', dialog => dialog.open), false);
  assert.equal(await page.$eval('#details-dialog', dialog => dialog.open), true);
});

test('commands reject a changed buffer rather than restoring an outdated selection', async t => {
  const { page } = await openEditor(t);
  await openCommands(page, 'bold');
  await appendSource(page, '\nNewer edit while the palette is open.');
  const before = await value(page, '#source');
  await page.keyboard.press('Enter');
  await waitForText(page, '#message', 'handout changed');
  assert.equal(await value(page, '#source'), before);
  assert.equal(await page.$eval('#commands-dialog', dialog => dialog.open), false);
});

async function setLinkField(page, selector, next) {
  await page.$eval(selector, (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, next);
}

test('Source link tools insert literal labels, edit the exact repeated occurrence, preserve attributes and share undo', async t => {
  const { page, source: original } = await openEditor(t);
  const at = original.indexOf('First page.');
  await page.$eval('#source', (input, at) => { input.focus(); input.setSelectionRange(at, at + 5); }, at);
  await page.click('#links'); await setLinkField(page, '#link-url', 'https://example.org/?a=1&b=2');
  await page.click('#link-apply');
  const inserted = original.replace('First page.', '<a href="https://example.org/?a=1&amp;b=2">First</a> page.');
  assert.equal(await value(page, '#source'), inserted);
  await page.click('#undo'); assert.equal(await value(page, '#source'), original);
  await page.click('#redo'); assert.equal(await value(page, '#source'), inserted);
  const repeated = '<a id="keep" class="reference" href="https://example.org"><strong>Same</strong></a>';
  const contents = inserted + '\n' + repeated + ' then ' + repeated;
  await replaceSource(page, contents);
  const second = contents.lastIndexOf('<strong>Same');
  await page.$eval('#source', (input, at) => input.setSelectionRange(at, at), second);
  await page.click('#links'); await setLinkField(page, '#link-url', '#target'); await page.click('#link-apply');
  const updated = contents.slice(0, contents.lastIndexOf(repeated)) + repeated.replace('https://example.org', '#target');
  assert.equal(await value(page, '#source'), updated);
  await page.click('#links'); await page.click('#link-remove');
  assert.equal(await value(page, '#source'), updated.slice(0, updated.lastIndexOf('<a id="keep"')) + '<a id="keep" class="reference"><strong>Same</strong></a>');
  await page.click('#undo'); assert.equal(await value(page, '#source'), updated);
});

test('Visual links preserve selected emphasis, edit on click without navigation, and unwrap without losing content', async t => {
  const { page, source: original } = await openEditor(t, { mode: 'visual' });
  const frame = await (await page.$('#visual')).contentFrame();
  await frame.waitForSelector('[data-visual-block]');
  await frame.evaluate(() => {
    const block = [...document.querySelectorAll('[data-visual-block]')].find(element => element.textContent === 'First page.');
    block.innerHTML = '<em>First</em> page.'; block.dispatchEvent(new Event('input', { bubbles: true })); block.focus();
    const range = document.createRange(); range.selectNodeContents(block.querySelector('em'));
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  const before = await value(page, '#source');
  await page.click('#links'); await setLinkField(page, '#link-url', 'https://example.org'); await page.click('#link-apply');
  assert.match(await value(page, '#source'), /<em><a href="https:\/\/example.org">First<\/a><\/em>/);
  assert.ok((await value(page, '#source')).startsWith(original.slice(0, original.indexOf('First page.'))));
  await frame.click('a[href="https://example.org"]'); await page.waitForSelector('#link-dialog[open]');
  assert.equal(await value(page, '#link-text'), 'First');
  await setLinkField(page, '#link-url', '#local'); await page.click('#link-apply');
  assert.match(await value(page, '#source'), /<em><a href="#local">First<\/a><\/em>/);
  await frame.click('a[href="#local"]'); await page.click('#link-remove');
  assert.equal(await value(page, '#source'), before);
  await page.click('#undo'); assert.match(await value(page, '#source'), /href="#local"/);
});

test('link editor rejects unsafe addresses and stale buffers, clears its fields on cancel, and works through Commands', async t => {
  const { page } = await openEditor(t);
  await page.$eval('#source', input => { const at = input.value.indexOf('First page.'); input.setSelectionRange(at, at + 5); });
  await openCommands(page, 'hyperlink'); await page.keyboard.press('Enter');
  await page.waitForSelector('#link-dialog[open]');
  for (const address of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/test', 'https://']) {
    await setLinkField(page, '#link-url', address);
    assert.equal(await page.$eval('#link-apply', button => button.disabled), true);
    assert.ok(await text(page, '#link-error'));
  }
  await setLinkField(page, '#link-url', 'https://example.org');
  const before = await value(page, '#source');
  await appendSource(page, '\nNewer edits.');
  await page.click('#link-apply'); await waitForText(page, '#link-error', 'editor changed');
  assert.equal(await value(page, '#source'), before + '\nNewer edits.');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#link-url').value === '');
  assert.equal(await value(page, '#link-text'), '');
});

test('existing unsafe and image links can be removed without following their destinations or deleting images', async t => {
  const { page, source } = await openEditor(t, { mode: 'visual' });
  const body = '<p><a href="javascript:alert(1)">Unsafe example</a></p>\n<p><a href="https://example.org"><img src="../assets/handouts/STH-001/route.svg" alt="A route marker."></a></p>';
  await replaceSource(page, source + '\n' + body);
  await page.click('#source-mode'); await page.click('#visual-mode');
  const frame = await (await page.$('#visual')).contentFrame(); await frame.waitForSelector('a[href^="javascript"]');
  await frame.click('a[href^="javascript"]');
  assert.equal(await page.$eval('#link-apply', button => button.disabled), true);
  await page.click('#link-remove');
  assert.doesNotMatch(await value(page, '#source'), /javascript:/);
  await frame.click('a img');
  assert.equal(await page.$eval('#link-text', input => input.disabled), true);
  await page.click('#link-remove');
  const result = await value(page, '#source');
  assert.match(result, /<img src="\.\.\/assets\/handouts\/STH-001\/route.svg" alt="A route marker.">/);
  assert.doesNotMatch(result, /<a\b/);
});

test('review dashboard API reads current saved metadata, invalidates changed checks and tolerates broken or missing files', async t => {
  const { base, file, root, source } = await setup(t);
  let response = await fetch(`${base}/api/review`); assert.match(response.headers.get('cache-control'), /no-store/);
  let snapshot = await response.json(); assert.equal(snapshot.handouts.length, 2); assert.equal(snapshot.handouts[0].reviewers.editor, 'Unassigned');
  assert.equal(snapshot.handouts[0].validation.formatting, 'unchecked'); assert.equal('source' in snapshot.handouts[0], false);
  await fs.writeFile(file, source.replace('version: 1.0', 'version: invalid'));
  await fetch(`${base}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'handouts/section/example.md' }) });
  snapshot = await (await fetch(`${base}/api/review`)).json();
  assert.equal(snapshot.handouts[0].validation.formatting, 'error'); assert.ok(snapshot.handouts[0].validation.issues.length);
  await fs.writeFile(file, source.replace('title: Fixture', 'title: Saved title').replace('lastReviewed: 2026-01-01', 'lastReviewed: 2020-01-01'));
  await fs.writeFile(path.join(root, 'handouts/section/second.md'), 'Broken front matter');
  snapshot = await (await fetch(`${base}/api/review`)).json();
  assert.equal(snapshot.handouts[0].title, 'Saved title'); assert.equal(snapshot.handouts[0].lastReviewed, '2020-01-01'); assert.equal(snapshot.handouts[0].validation.formatting, 'unchecked');
  assert.match(snapshot.handouts[1].metadataError, /delimiters/);
  await fs.rm(file); snapshot = await (await fetch(`${base}/api/review`)).json();
  assert.match(snapshot.handouts[0].readError, /missing on disk/); assert.equal(snapshot.handouts.length, 2);
});

test('review dashboard shares simultaneous saved-file checks without superseding either request', async t => {
  const { base } = await setup(t);
  const scan = () => fetch(`${base}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'handouts/section/example.md' }) });
  const responses = await Promise.all([scan(), scan()]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  const results = await Promise.all(responses.map(response => response.json()));
  assert.equal(results[0].checkedAt, results[1].checkedAt);
});

test('review dashboard filters saved dates and reviewers, preserves the open buffer, and respects discard decisions', async t => {
  const { page, source, root } = await openEditor(t);
  const second = path.join(root, 'handouts/section/second.md');
  await fs.writeFile(second, (await fs.readFile(second, 'utf8')).replaceAll('Unassigned', 'Alice').replace('subjectMatter: Alice', 'subjectMatter: Blair').replace('lastReviewed: 2026-01-01', 'lastReviewed: 2099-01-01'));
  await appendSource(page, '\nUnsaved local text.'); const before = await value(page, '#source');
  await page.click('#review-dashboard'); await waitForText(page, '#review-state', 'Saved data loaded');
  assert.equal(await page.$$eval('#review-rows tr', rows => rows.length), 2);
  assert.equal(await page.$eval('#review-unsaved', element => element.hidden), false);
  assert.doesNotMatch(await text(page, '#review-rows'), /Unsaved local text/);
  await page.$eval('#review-date', input => { input.value = '2030-01-01'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('[data-review-filter="due"]'); assert.equal(await page.$$eval('#review-rows tr', rows => rows.length), 1);
  await page.click('[data-review-filter="reviewers"]'); assert.equal(await page.$$eval('#review-rows tr', rows => rows.length), 1);
  await page.click('[data-review-filter="all"]'); await page.type('#review-search', 'Alice');
  assert.equal(await page.$$eval('#review-rows tr', rows => rows.length), 1);
  page.once('dialog', dialog => dialog.dismiss()); await page.click('#review-rows button');
  assert.equal(await value(page, '#source'), before); assert.equal(await page.$eval('#review-dialog', dialog => dialog.open), true);
  page.once('dialog', dialog => dialog.accept()); await page.click('#review-rows button');
  await page.waitForFunction(() => !document.querySelector('#review-dialog').open);
  assert.match(await value(page, '#source'), /code: STH-002/);
  assert.equal(await value(page, '#review-search'), ''); assert.equal(await page.$$eval('#review-rows tr', rows => rows.length), 0);
  assert.equal(await fs.readFile(path.join(root, 'handouts/section/example.md'), 'utf8'), source);
});

test('review dashboard checks saved files without validating or saving unsaved editor text', async t => {
  const { page, file, source } = await openEditor(t);
  await appendSource(page, '\nUnsaved buffer.');
  const invalid = source.replace('version: 1.0', 'version: invalid'); await fs.writeFile(file, invalid);
  await page.click('#review-dashboard'); await waitForText(page, '#review-state', 'Saved data loaded');
  await page.click('#review-check'); await waitForText(page, '#review-state', 'Checks finished');
  assert.match(await text(page, '#review-rows'), /Validation errors/);
  assert.match(await value(page, '#source'), /Unsaved buffer/); assert.equal(await fs.readFile(file, 'utf8'), invalid);
  await page.click('[data-review-filter="errors"]'); assert.equal(await page.$$eval('#review-rows tr', rows => rows.length), 1);
  await page.keyboard.press('Escape');
});

test('review dashboard stops after the current check and ignores data arriving after close', async t => {
  const { page } = await openEditor(t);
  await waitForText(page, '#scan-state', 'Scan complete');
  await page.click('#review-dashboard'); await waitForText(page, '#review-state', 'Saved data loaded');
  await page.setRequestInterception(true);
  let held, scanned = 0, holdReview = false;
  page.on('request', request => {
    if (request.url().endsWith('/api/scan')) { scanned++; held = request; return; }
    if (holdReview && request.url().endsWith('/api/review')) { held = request; return; }
    request.continue();
  });
  const checkStarted = page.waitForRequest(request => request.url().endsWith('/api/scan'));
  await page.click('#review-check'); await checkStarted;
  await page.click('#review-stop'); const current = held; held = undefined; await current.continue();
  await waitForText(page, '#review-state', 'Stopped'); assert.equal(scanned, 1);
  await page.keyboard.press('Escape');
  holdReview = true; const readStarted = page.waitForRequest(request => request.url().endsWith('/api/review'));
  await page.click('#review-dashboard'); await readStarted;
  await page.click('#review-dialog .dialog-heading button');
  const response = page.waitForResponse(response => response.url().endsWith('/api/review'));
  await held.continue(); await response;
  assert.equal(await page.$eval('#review-dialog', dialog => dialog.open), false);
  assert.equal(await page.$$eval('#review-rows tr', rows => rows.length), 0);
});

test('review checks close a validation browser that finishes launching after server shutdown', { timeout: 30_000 }, async t => {
  const { base, server } = await setup(t);
  const originalLaunch = puppeteer.launch;
  let release, started, ready;
  const gate = new Promise(resolve => { release = resolve; });
  const starting = new Promise(resolve => { started = resolve; });
  const browserReady = new Promise(resolve => { ready = resolve; });
  puppeteer.launch = async (...args) => { started(); await gate; const browser = await originalLaunch.call(puppeteer, ...args); ready(browser); return browser; };
  t.after(() => { release(); puppeteer.launch = originalLaunch; });
  const request = fetch(`${base}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'handouts/section/example.md' }) }).catch(() => undefined);
  await starting;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  release(); const browser = await browserReady; t.after(() => browser.close());
  const process = browser.process();
  if (process.exitCode === null && process.signalCode === null) await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Validation browser was left running after shutdown')), 10_000);
    process.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  assert.equal(browser.connected, false); await request;
});

function fakeGitPublisher() {
  const calls = { prepare: [], publish: [] };
  const publisher = {
    async prepare(target, session) { calls.prepare.push({ target, session }); return { token: 'test-plan', repository: 'test/repo', private: target.private, branch: 'editor/handout-STH-001-abcdef123456', base: 'main', files: [target.path], summary: '1 file changed', patch: '+ Saved Git edit', updating: false }; },
    async publish(token, session, title, notes, verify) { calls.publish.push({ token, session, title, notes }); const target = calls.prepare.at(-1).target; await verify(target); return { url: 'https://github.com/test/repo/pull/7', number: 7, commit: 'a'.repeat(40), branch: 'editor/handout-STH-001-abcdef123456', revision: target.revision }; }
  };
  return { publisher, calls };
}

test('Git editor workflow saves, reviews and publishes only after the explicit PR action', async t => {
  const { publisher, calls } = fakeGitPublisher();
  const { page, file } = await openEditor(t, { gitPublisher: publisher });
  await appendSource(page, '\nSaved Git edit.'); await page.click('#save'); await waitForText(page, '#state', 'Saved');
  assert.equal(calls.prepare.length, 0); assert.equal(calls.publish.length, 0);
  await page.click('#save-pr'); await page.type('#git-notes', 'Please review the handout.');
  await page.click('#git-prepare'); await waitForText(page, '#git-state', 'Ready to publish');
  assert.match(await fs.readFile(file, 'utf8'), /Saved Git edit/);
  assert.match(await text(page, '#git-target'), /test\/repo/); assert.match(await text(page, '#git-patch'), /Saved Git edit/);
  assert.equal(calls.publish.length, 0);
  await page.click('#git-publish'); await waitForText(page, '#git-state', 'Published commit');
  assert.equal(calls.publish.length, 1); assert.equal(calls.publish[0].notes, 'Please review the handout.');
  assert.equal(await page.$eval('#git-result a', link => link.href), 'https://github.com/test/repo/pull/7');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#git-notes').value);
  assert.equal(await text(page, '#git-patch'), '');
});

test('Git editor preparation rejects stale state and keeps local saves when Git is not configured', async t => {
  const { page, file } = await openEditor(t);
  await appendSource(page, '\nLocal edit without a Git checkout.'); await page.click('#save-pr'); await page.click('#git-prepare');
  await waitForText(page, '#git-state', 'failed');
  assert.match(await fs.readFile(file, 'utf8'), /Local edit without/);
  assert.equal(await page.$eval('#git-publish', button => button.disabled), true);
});

test('Git editor disables a prepared snapshot after newer edits and protects API origin and saved revisions', async t => {
  const { publisher, calls } = fakeGitPublisher(); const { page, base, source } = await openEditor(t, { gitPublisher: publisher });
  await page.click('#save-pr'); await page.click('#git-prepare'); await waitForText(page, '#git-state', 'Ready to publish');
  await appendSource(page, '\nNewer unsaved edit.');
  assert.equal(await page.$eval('#git-publish', button => button.disabled), true); assert.equal(calls.publish.length, 0);
  const body = { path: 'handouts/section/example.md', private: false, revision: 'stale', session: 'git-test-session' };
  const post = headers => fetch(`${base}/api/git/prepare`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await post({ 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post({ 'content-type': 'application/json', origin: 'https://other.example' })).status, 403);
  const { request: httpRequest } = await import('node:http');
  const rebound = await new Promise((resolve, reject) => {
    const request = httpRequest(base + '/api/git/prepare', { method: 'POST', headers: { 'content-type': 'application/json', host: 'rebound.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end(JSON.stringify(body));
  });
  assert.equal(rebound, 403);
  assert.equal((await post({ 'content-type': 'application/json' })).status, 409);
  assert.equal(calls.prepare.length, 1); assert.ok(source.includes('code: STH-001'));
});

test('Git-enabled editor blocks authored scripts in Visual and preview frames while keeping editing active', async t => {
  const { page, source } = await openEditor(t);
  await replaceSource(page, source + '\n<script>parent.__authoredEditorScript = true;</script>\n<p onclick="parent.__authoredEditorClick = true">Safe editable text.</p>\n');
  await page.click('#visual-mode');
  await page.waitForFunction(() => document.querySelector('#visual').contentDocument.querySelector('script'));
  await page.waitForFunction(() => document.querySelector('#preview').contentDocument.querySelector('script'));
  assert.equal(await page.evaluate(() => window.__authoredEditorScript), undefined);
  const frame = await (await page.$('#visual')).contentFrame();
  await frame.click('p[onclick]'); assert.equal(await page.evaluate(() => window.__authoredEditorClick), undefined);
  await frame.$eval('p[onclick]', element => { element.textContent = 'Edited with parent controls.'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.match(await value(page, '#source'), /Edited with parent controls/);
});
