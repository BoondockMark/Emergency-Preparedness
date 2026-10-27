import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import puppeteer from 'puppeteer';
import { createEditorServer } from '../scripts/lib/editor-server.mjs';
import { browserOptions } from '../scripts/lib/artifact-generation.mjs';

const repository = path.resolve(import.meta.dirname, '..');
const handoutPath = 'handouts/start-here/record.md';
async function setup(t, { publicOnly = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'private-editor-'));
  let server;
  t.after(async () => { if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); await fs.rm(directory, { recursive: true, force: true }); });
  const root = path.join(directory, 'public');
  const privateRoot = path.join(directory, 'private');
  const fixture = await fs.readFile(path.join(repository, 'test/unit-fixtures/front-matter.md'), 'utf8');
  const publicSource = fixture.replace('pageCount: 1', 'pageCount: 1\nprivate: true').replace('Fixture body.', 'PUBLIC PLACEHOLDER');
  const privateSource = fixture.replace('Fixture body.', 'PRIVATE TEST RECORD\n\n<img src="../assets/handouts/STH-001/map.svg" alt="Test map">');
  for (const dir of [root, privateRoot]) await fs.mkdir(path.join(dir, 'handouts/start-here'), { recursive: true });
  await fs.writeFile(path.join(root, handoutPath), publicSource);
  await fs.writeFile(path.join(privateRoot, handoutPath), privateSource);
  await fs.writeFile(path.join(root, 'handouts/start-here/public.md'), fixture.replace('STH-001', 'STH-002'));
  for (const dir of ['templates', 'editor', 'assets/styles', 'assets/fonts']) {
    await fs.cp(path.join(repository, dir), path.join(root, dir), { recursive: true });
  }
  const assets = path.join(privateRoot, 'assets/handouts/STH-001');
  await fs.mkdir(assets, { recursive: true });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Test map</title><rect width="10" height="10"/></svg>';
  const entry = { file: 'map.svg', type: 'diagram', creator: 'Test', source: 'Test', license: 'Test', alt: 'Test map', decorative: false };
  await fs.writeFile(path.join(assets, 'map.svg'), svg);
  await fs.writeFile(path.join(assets, 'manifest.json'), JSON.stringify({ assets: [entry] }));
  server = await createEditorServer({ root, privateDirectory: privateRoot, publicOnly });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async url => (await fetch(base + url)).json();
  const post = async (url, data) => {
    const response = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    return { response, data: await response.json() };
  };
  return { root, privateRoot, base, get, post, publicSource, privateSource, svg };
}

test('private editor loads, previews, validates, and saves replacements to the private library', async t => {
  const { root, privateRoot, base, get, post, publicSource, privateSource, svg } = await setup(t);
  const opened = await get(`/api/handout?path=${handoutPath}`);
  assert.equal(opened.private, true);
  assert.equal(opened.source, privateSource);
  assert.equal(await (await fetch(base + '/assets/handouts/STH-001/map.svg')).text(), svg);
  const render = await fetch(base + '/api/render', { method: 'POST', body: JSON.stringify({ path: handoutPath, source: opened.source }) });
  assert.match(await render.text(), /PRIVATE TEST RECORD/);
  const validation = await post('/api/validate', { path: handoutPath, source: opened.source, session: 'private-test-session' });
  assert.equal(validation.data.valid, true);
  const stagedFiles = await fs.readdir(path.join(privateRoot, 'build/editor'));
  assert.ok(stagedFiles.some(file => file.startsWith('handout-validation-')));
  assert.ok(stagedFiles.some(file => file.startsWith('handout-editor-assets-')));
  const uploaded = await post('/api/assets', {
    path: handoutPath, session: 'private-test-session', name: 'extra-map.svg',
    mimeType: 'image/svg+xml', dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    type: 'diagram', creator: 'Test', source: 'Test', license: 'Test', alt: 'Extra test map'
  });
  assert.equal(uploaded.response.status, 201);
  const pendingUrl = `/assets/handouts/STH-001/extra-map.svg?session=private-test-session&path=${encodeURIComponent(handoutPath)}`;
  assert.equal(await (await fetch(base + pendingUrl)).text(), svg);
  const savedSource = opened.source.replace('PRIVATE TEST RECORD', 'EDITED PRIVATE TEST RECORD');
  const saved = await post('/api/save', { path: handoutPath, source: savedSource, revision: opened.revision, session: 'private-test-session' });
  assert.equal(saved.response.status, 200);
  assert.equal(await fs.readFile(path.join(privateRoot, handoutPath), 'utf8'), savedSource);
  assert.equal(await fs.readFile(path.join(root, handoutPath), 'utf8'), publicSource);
  assert.equal(await (await fetch(base + '/assets/handouts/STH-001/extra-map.svg')).text(), svg);
  await fs.access(path.join(privateRoot, 'assets/handouts/STH-001/extra-map.svg.base64'));
  const deleted = await fetch(base + '/api/assets', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: handoutPath, file: 'extra-map.svg' }) });
  assert.equal(deleted.status, 200);
  await assert.rejects(fs.access(path.join(privateRoot, 'assets/handouts/STH-001/extra-map.svg.base64')));
  await assert.rejects(fs.access(path.join(root, 'assets/handouts/STH-001')));
});

test('public editor override keeps placeholders and refuses private graphics', async t => {
  const { base, get, publicSource } = await setup(t, { publicOnly: true });
  const opened = await get(`/api/handout?path=${handoutPath}`);
  assert.equal(opened.private, false);
  assert.equal(opened.source, publicSource);
  assert.equal((await fetch(base + '/assets/handouts/STH-001/map.svg')).status, 404);
});

test('ordinary public handouts still save to the public library in private mode', async t => {
  const { root, privateRoot, get, post } = await setup(t);
  const relative = 'handouts/start-here/public.md';
  const opened = await get(`/api/handout?path=${relative}`);
  assert.equal(opened.private, false);
  const source = opened.source.replace('Fixture body.', 'Updated public text.');
  assert.equal((await post('/api/save', { path: relative, source, revision: opened.revision, session: 'public-test-session' })).response.status, 200);
  assert.equal(await fs.readFile(path.join(root, relative), 'utf8'), source);
  await assert.rejects(fs.access(path.join(privateRoot, relative)));
});

test('browser shows private content and save destination without recovering public drafts or storing private drafts', async t => {
  const { base, privateSource } = await setup(t);
  const browser = await puppeteer.launch(browserOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((key) => {
    localStorage.setItem(key, JSON.stringify({ source: 'PUBLIC DRAFT THAT MUST NOT REPLACE PRIVATE TEXT' }));
  }, `handout-editor:draft:${handoutPath}`);
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.select('#handout', handoutPath);
  await page.waitForFunction(() => document.querySelector('#source').value.includes('PRIVATE TEST RECORD'));
  assert.equal(await page.$eval('#source', el => el.value), privateSource);
  assert.match(await page.$eval('#source-library', el => el.textContent), /Private library/);
  assert.equal(await page.$eval('#draft-recovery', el => el.hidden), true);
  await page.click('#source-mode');
  await page.$eval('#source', el => { el.value += '\nPRIVATE UNSAVED EDIT'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('#state').textContent.includes('Unsaved'));
  const draft = await page.evaluate(key => localStorage.getItem(key), `handout-editor:draft:${handoutPath}`);
  assert.doesNotMatch(draft, /PRIVATE UNSAVED EDIT/);
});

test('private duplication keeps titles, body, images, and credits out of the public checkout', async t => {
  const { root, privateRoot, get, post, privateSource, svg } = await setup(t);
  const opened = await get(`/api/handout?path=${handoutPath}`);
  const rejected = await post('/api/handouts/new', { session: 'private-copy-test', sourcePath: handoutPath, revision: opened.revision, title: 'PRIVATE ADDRESS 123', sectionNumber: 1, library: 'public', reviewDate: '2026-10-26' });
  assert.equal(rejected.response.status, 403);
  const copied = await post('/api/handouts/new', { session: 'private-copy-test', sourcePath: handoutPath, revision: opened.revision, title: 'PRIVATE ADDRESS 123', sectionNumber: 1, library: 'private', reviewDate: '2026-10-26' });
  assert.equal(copied.response.status, 201, JSON.stringify(copied.data));
  assert.equal(copied.data.code, 'STH-003');
  assert.equal(copied.data.path, 'handouts/start-here/STH-003-private-handout.md');
  const placeholder = await fs.readFile(path.join(root, copied.data.path), 'utf8');
  assert.doesNotMatch(placeholder, /PRIVATE ADDRESS|PRIVATE TEST RECORD|map.svg|Test map/);
  assert.match(placeholder, /Private handout STH-003/);
  const actual = await get('/api/handout?path=' + copied.data.path);
  assert.equal(actual.private, true);
  assert.match(actual.source, /PRIVATE ADDRESS 123/);
  assert.match(actual.source, /PRIVATE TEST RECORD/);
  assert.match(actual.source, /assets\/handouts\/STH-003\/map.svg/);
  assert.deepEqual(actual.assets, opened.assets);
  const bytes = await fs.readFile(path.join(privateRoot, 'assets/handouts/STH-003/map.svg.base64'), 'ascii');
  assert.equal(Buffer.from(bytes.replace(/\s/g, ''), 'base64').toString(), svg);
  await assert.rejects(fs.access(path.join(root, 'assets/handouts/STH-003')));
  assert.equal(await fs.readFile(path.join(privateRoot, handoutPath), 'utf8'), privateSource);
  const publicServer = await createEditorServer({ root, publicOnly: true });
  await new Promise(resolve => publicServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { publicServer.closeAllConnections(); publicServer.close(resolve); }));
  const publicBase = `http://127.0.0.1:${publicServer.address().port}`;
  const publicCopy = await (await fetch(publicBase + '/api/handout?path=' + copied.data.path)).json();
  assert.equal(publicCopy.source, placeholder);
  assert.equal(publicCopy.private, false);
  const declassified = await fetch(publicBase + '/api/handouts/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: 'public-copy-test', sourcePath: copied.data.path, revision: publicCopy.revision, title: 'Public copy of slot', sectionNumber: 1, library: 'public', reviewDate: '2026-10-26' }) });
  assert.equal(declassified.status, 403, 'Public placeholders retain their private classification');
  const unavailable = await fetch(publicBase + '/api/handouts/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: 'public-copy-test', title: 'Private unavailable', sectionNumber: 1, library: 'private', template: 'starter', reviewDate: '2026-10-26' }) });
  assert.equal(unavailable.status, 403);
});

test('browser private duplication stays private and never stores the new text in browser drafts', { timeout: 60_000 }, async t => {
  const { base, root } = await setup(t);
  const browser = await puppeteer.launch(browserOptions()); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.select('#handout', handoutPath);
  await page.waitForFunction(() => document.querySelector('#source').value.includes('PRIVATE TEST RECORD'));
  await page.click('#duplicate-handout'); await page.waitForSelector('#create-dialog[open]');
  assert.equal(await page.$eval('#create-form [name="library"]', select => select.value), 'private');
  assert.equal(await page.$eval('#create-form [name="library"]', select => select.disabled), true);
  await page.$eval('#create-form [name="title"]', input => { input.value = 'Private copied record'; });
  await page.click('#create-submit');
  await page.waitForFunction(() => document.querySelector('#source').value.includes('code: "STH-003"'));
  assert.match(await page.$eval('#source', input => input.value), /PRIVATE TEST RECORD/);
  await page.$eval('#source', input => { input.value += '\nPRIVATE UNSAVED COPY'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#build-proof');
  await page.waitForFunction(() => !document.querySelector('#proof-download').disabled);
  assert.match(await page.$eval('#proof-summary', element => element.textContent), /Private library.*Built from unsaved edits/);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  const placeholder = await fs.readFile(path.join(root, 'handouts/start-here/STH-003-private-handout.md'), 'utf8');
  assert.doesNotMatch(placeholder, /Private copied record|PRIVATE TEST RECORD|PRIVATE UNSAVED COPY/);
});

test('private PDF proof downloads are session scoped and leave no public artifacts or private temporary files', { timeout: 60_000 }, async t => {
  const { base, root, privateRoot, post, privateSource } = await setup(t);
  const session = 'private-proof-session';
  const start = await post('/api/proofs/start', { path: handoutPath, source: privateSource, session });
  assert.equal(start.response.status, 202);
  let job;
  for (let attempt = 0; attempt < 600; attempt++) {
    const result = await post('/api/proofs/status', { id: start.data.id, session }); job = result.data;
    if (['ready', 'failed'].includes(job.state)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(job.state, 'ready', JSON.stringify(job));
  assert.equal(job.private, true);
  const response = await fetch(base + '/api/proofs/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: job.id, session }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { getPdfPageCount } = await import('../scripts/lib/pdf-validation.mjs');
  assert.equal(await getPdfPageCount(Buffer.from(await response.arrayBuffer())), 1);
  await assert.rejects(fs.access(path.join(root, 'docs/pdfs/STH-001.pdf')));
  await assert.rejects(fs.access(path.join(root, 'build')));
  assert.equal((await fs.readdir(path.join(privateRoot, 'build/editor'))).some(name => name.startsWith('handout-proof-')), false);
  const publicServer = await createEditorServer({ root, publicOnly: true });
  await new Promise(resolve => publicServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { publicServer.closeAllConnections(); publicServer.close(resolve); }));
  const denied = await fetch(`http://127.0.0.1:${publicServer.address().port}/api/proofs/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: job.id, session }) });
  assert.equal(denied.status, 404);
});

test('private conflict resolution keeps all versions out of browser storage and writes only to the private checkout', { timeout: 60_000 }, async t => {
  const { base, root, privateRoot, privateSource, publicSource } = await setup(t);
  const browser = await puppeteer.launch(browserOptions()); t.after(() => browser.close());
  const page = await browser.newPage(); await page.goto(base, { waitUntil: 'networkidle0' });
  await page.select('#handout', handoutPath); await page.waitForFunction(() => document.querySelector('#source').value.includes('PRIVATE TEST RECORD'));
  await page.click('#source-mode');
  const yours = privateSource.replace('PRIVATE TEST RECORD', 'PRIVATE LOCAL FACT');
  const disk = privateSource.replace('PRIVATE TEST RECORD', 'PRIVATE DISK FACT');
  await page.$eval('#source', (input, text) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); }, yours);
  await fs.writeFile(path.join(privateRoot, handoutPath), disk);
  await page.click('#save'); await page.waitForFunction(() => !document.querySelector('#conflict-banner').hidden);
  await page.click('#compare-disk'); await page.waitForSelector('.merge-conflict button');
  assert.match(await page.$eval('#changes-conflicts', element => element.textContent), /PRIVATE LOCAL FACT/);
  assert.match(await page.$eval('#changes-conflicts', element => element.textContent), /PRIVATE DISK FACT/);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  await page.click('.merge-conflict button');
  await page.$eval('#changes-proposed', input => { input.value = input.value.replace('PRIVATE LOCAL FACT', 'PRIVATE LOCAL FACT AND PRIVATE DISK FACT'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#changes-apply'); await page.click('#save');
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
  assert.match(await fs.readFile(path.join(privateRoot, handoutPath), 'utf8'), /PRIVATE LOCAL FACT AND PRIVATE DISK FACT/);
  assert.equal(await fs.readFile(path.join(root, handoutPath), 'utf8'), publicSource);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  assert.equal(await page.$eval('#changes-diff', element => element.textContent), '');
});

test('a path changing libraries cannot merge or save an old private buffer into the public checkout', { timeout: 60_000 }, async t => {
  const { base, root, privateRoot, privateSource, publicSource } = await setup(t);
  const browser = await puppeteer.launch(browserOptions()); t.after(() => browser.close());
  const page = await browser.newPage(); await page.goto(base, { waitUntil: 'networkidle0' });
  await page.select('#handout', handoutPath); await page.waitForFunction(() => document.querySelector('#source').value.includes('PRIVATE TEST RECORD'));
  const replacement = publicSource.replace('private: true', 'private: false').replace('PUBLIC PLACEHOLDER', 'Public replacement');
  await fs.writeFile(path.join(root, handoutPath), replacement);
  await fs.rm(path.join(privateRoot, handoutPath)); await fs.rm(path.join(privateRoot, 'assets/handouts/STH-001'), { recursive: true });
  await page.click('#refresh-handouts'); await page.waitForFunction(() => !document.querySelector('#refresh-handouts').disabled);
  await page.click('#review-changes'); await page.click('#changes-compare');
  await page.waitForFunction(() => document.querySelector('#changes-status').textContent.includes('different library'));
  assert.equal(await page.$eval('#changes-apply', button => button.disabled), true);
  await page.keyboard.press('Escape');
  await page.click('#save');
  await page.waitForFunction(() => !document.querySelector('#conflict-banner').hidden);
  assert.equal(await fs.readFile(path.join(root, handoutPath), 'utf8'), replacement);
  assert.equal(await page.$eval('#source', input => input.value), privateSource);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  await page.click('#build-proof');
  await page.waitForFunction(() => document.querySelector('#proof-state').textContent.includes('library changed'));
  assert.equal(await page.$eval('#proof-download', button => button.disabled), true);
});

test('private navigation and replacement stay in memory and clear when switching handouts', async t => {
  const { base, root, privateRoot, privateSource, publicSource } = await setup(t);
  const browser = await puppeteer.launch(browserOptions()); t.after(() => browser.close());
  const page = await browser.newPage(); await page.goto(base, { waitUntil: 'networkidle0' });
  await page.select('#handout', handoutPath);
  await page.waitForFunction(() => document.querySelector('#source').value.includes('PRIVATE TEST RECORD'));
  await page.click('#source-mode');
  await page.$eval('#source', element => { element.value += '\n## PRIVATE OUTLINE\nPRIVATE FIND\n'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#document-outline summary');
  assert.match(await page.$eval('#outline-headings', element => element.textContent), /PRIVATE OUTLINE/);
  await page.click('#find-toggle'); await page.type('#find-query', 'PRIVATE FIND'); await page.type('#find-replacement', 'PRIVATE REPLACEMENT');
  await page.click('#find-next'); await page.click('#find-replace');
  assert.match(await page.$eval('#source', element => element.value), /PRIVATE REPLACEMENT/);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  assert.equal(await fs.readFile(path.join(privateRoot, handoutPath), 'utf8'), privateSource);
  assert.equal(await fs.readFile(path.join(root, handoutPath), 'utf8'), publicSource);
  page.once('dialog', dialog => dialog.accept());
  await page.select('#handout', 'handouts/start-here/public.md');
  await page.waitForFunction(() => document.querySelector('#source').value.includes('STH-002'));
  assert.equal(await page.$eval('#find-query', element => element.value), '');
  assert.equal(await page.$eval('#find-replacement', element => element.value), '');
  assert.doesNotMatch(await page.$eval('#outline-headings', element => element.textContent), /PRIVATE/);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
});

test('private command execution preserves library routing and clears palette text without browser storage', async t => {
  const { base, root, privateRoot, publicSource } = await setup(t);
  const browser = await puppeteer.launch(browserOptions()); t.after(() => browser.close());
  const page = await browser.newPage(); await page.goto(base, { waitUntil: 'networkidle0' });
  await page.select('#handout', handoutPath);
  await page.waitForFunction(() => document.querySelector('#source').value.includes('PRIVATE TEST RECORD'));
  await page.click('#source-mode');
  await page.$eval('#source', element => { const at = element.value.indexOf('PRIVATE TEST RECORD'); element.focus(); element.setSelectionRange(at, at + 7); });
  await page.click('#commands'); await page.type('#command-query', 'bold'); await page.keyboard.press('Enter');
  assert.match(await page.$eval('#source', element => element.value), /\*\*PRIVATE\*\* TEST RECORD/);
  await page.click('#commands'); await page.type('#command-query', 'save handout'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
  assert.match(await fs.readFile(path.join(privateRoot, handoutPath), 'utf8'), /\*\*PRIVATE\*\* TEST RECORD/);
  assert.equal(await fs.readFile(path.join(root, handoutPath), 'utf8'), publicSource);
  await page.click('#commands'); await page.type('#command-query', 'PRIVATE SEARCH TEXT'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#commands-dialog').open && !document.querySelector('#command-query').value);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  assert.equal(await page.$$eval('#command-results li', items => items.length), 0);
});

test('private link edits and saves keep source and dialog values out of public files and browser storage', async t => {
  const { base, root, privateRoot, publicSource } = await setup(t);
  const browser = await puppeteer.launch(browserOptions()); t.after(() => browser.close());
  const page = await browser.newPage(); await page.goto(base, { waitUntil: 'networkidle0' });
  await page.select('#handout', handoutPath);
  await page.waitForFunction(() => document.querySelector('#source').value.includes('PRIVATE TEST RECORD'));
  await page.click('#source-mode');
  await page.$eval('#source', input => { const at = input.value.indexOf('PRIVATE TEST RECORD'); input.setSelectionRange(at, at + 19); });
  await page.click('#links'); await page.type('#link-url', 'https://private.example.org/PRIVATE-ADDRESS');
  await page.click('#link-apply'); await page.click('#save');
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'Saved');
  assert.match(await fs.readFile(path.join(privateRoot, handoutPath), 'utf8'), /PRIVATE-ADDRESS/);
  assert.equal(await fs.readFile(path.join(root, handoutPath), 'utf8'), publicSource);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  await page.waitForFunction(() => document.querySelector('#link-url').value === '');
  assert.equal(await page.$eval('#link-text', input => input.value), '');
});
