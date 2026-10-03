import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer';
import { browserOptions, copyAssets, openPrintPage, prepareDirectories, prepareDocumentValidation, validateDocument } from './artifact-generation.mjs';
import { loadAssetManifests, readAssetBytes } from './asset-validation.mjs';
import { renderHandoutSource } from './content-rendering.mjs';
import { discoverDocuments } from './filesystem-discovery.mjs';
import { loadDocument } from './metadata.mjs';
import { commitHandoutWithAssets, deleteAsset, figureMarkup, stageAsset } from './editor-support.mjs';
import { readHandoutStatus } from '../../editor/editor-model.js';

const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
};
const revision = source => createHash('sha256').update(source).digest('hex');

export async function createEditorServer({ root }) {
  const handoutsRoot = path.resolve(root, 'handouts');
  const realHandoutsRoot = await fs.realpath(handoutsRoot);
  let manifests = await loadAssetManifests(root);
  const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'handout-editor-assets-'));
  const staged = new Map();
  const stageKey = (session, handoutPath) => `${session}\0${handoutPath}`;
  const stagedFor = value => staged.get(stageKey(value.session, value.path)) ?? [];
  const requireSession = value => {
    if (typeof value.session !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(value.session)) throw Object.assign(Error('A valid editor session is required'), { status: 400 });
  };
  const combinedManifests = value => {
    const combined = new Map([...manifests].map(([code, assets]) => [code, new Map(assets)]));
    const document = documents.find(item => item.sourcePath === value.path);
    if (document) for (const item of stagedFor(value)) {
      if (!combined.has(document.meta.code)) combined.set(document.meta.code, new Map());
      combined.get(document.meta.code).set(item.entry.file, item.entry);
    }
    return combined;
  };
  async function discardStaged(value) {
    requireSession(value);
    const key = stageKey(value.session, value.path);
    for (const item of staged.get(key) ?? []) await fs.rm(item.stagedFile, { force: true });
    staged.delete(key);
  }
  const documents = await discoverDocuments(root, manifests);
  const discovered = new Map();
  for (const { sourcePath } of documents) {
    const realFile = await fs.realpath(path.resolve(root, sourcePath));
    if (realFile.startsWith(`${realHandoutsRoot}${path.sep}`) && path.extname(realFile) === '.md') {
      discovered.set(sourcePath, realFile);
    }
  }
  const template = await fs.readFile(path.join(root, 'templates/handout.html'), 'utf8');
  let validationRoot;
  let browser;
  let resourcesPromise;
  async function validationResources() {
    resourcesPromise ??= (async () => {
      validationRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'handout-validation-'));
      await prepareDirectories(root, validationRoot);
      await copyAssets(root, validationRoot, manifests);
      browser = await puppeteer.launch(browserOptions());
      return { validationRoot, browser };
    })();
    return resourcesPromise;
  }
  async function refreshAssets() {
    manifests = await loadAssetManifests(root);
    await browser?.close();
    if (validationRoot) await fs.rm(validationRoot, { recursive: true, force: true });
    browser = undefined;
    validationRoot = undefined;
    resourcesPromise = undefined;
  }
  const validationGeneration = new Map();

  function safeFile(relative) {
    if (typeof relative !== 'string' || path.extname(relative) !== '.md') return null;
    return discovered.get(relative) ?? null;
  }
  async function body(request) {
    let value = '';
    for await (const chunk of request) {
      value += chunk;
      if (value.length > 25_000_000) throw Object.assign(Error('Request too large'), { status: 413 });
    }
    return JSON.parse(value || '{}');
  }
  async function serve(response, file, contentType) {
    response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    response.end(await fs.readFile(file));
  }

  async function validateSource(value) {
    const session = typeof value.session === 'string' ? value.session : 'default';
    const requestId = Number.isSafeInteger(value.requestId) ? value.requestId : (validationGeneration.get(session) ?? 0) + 1;
    validationGeneration.set(session, Math.max(validationGeneration.get(session) ?? 0, requestId));
    // Deliberately perform the cheap metadata parse before any browser work.
    try { loadDocument(value.source, value.path); } catch (error) {
      const prepared = prepareDocumentValidation({ source: value.source, sourcePath: value.path, template, manifests });
      return { phase: 'syntax', valid: false, issues: prepared.issues };
    }
    const requestManifests = combinedManifests(value);
    const prepared = prepareDocumentValidation({ source: value.source, sourcePath: value.path, template, manifests: requestManifests });
    if (prepared.issues.length || value.phase === 'syntax') {
      return { phase: 'syntax', valid: !prepared.issues.length, issues: prepared.issues };
    }
    const generation = requestId;
    const resources = await validationResources();
    const documentCode = prepared.document.meta.code;
    for (const item of stagedFor(value)) {
      const directory = path.join(resources.validationRoot, 'assets', 'handouts', documentCode);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, item.entry.file), item.bytes);
    }
    const htmlFile = path.join(resources.validationRoot, 'html', `${prepared.document.meta.code}-${generation}-${randomUUID()}.html`);
    await fs.writeFile(htmlFile, prepared.html);
    let page;
    try {
      page = await openPrintPage(resources.browser, htmlFile);
      const result = await validateDocument({ page, document: prepared.document, html: prepared.html, htmlFile });
      if (validationGeneration.get(session) !== generation) throw Object.assign(Error('Validation superseded'), { status: 409 });
      return { phase: 'layout', ...result };
    } finally {
      await page?.close();
      await fs.rm(htmlFile, { force: true });
    }
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/api/handouts') {
        return json(response, 200, documents.map(({ sourcePath, meta }) => ({ path: sourcePath, title: meta.title, code: meta.code, status: meta.status, formatting: 'unchecked' })));
      }
      if (request.method === 'GET' && url.pathname === '/api/handout') {
        const relative = url.searchParams.get('path');
        const file = safeFile(relative);
        if (!file) return json(response, 404, { error: 'Unknown handout path' });
        const source = await fs.readFile(file, 'utf8');
        const document = documents.find(item => item.sourcePath === relative);
        const session = url.searchParams.get('session');
        const pending = session ? stagedFor({ session, path: relative }) : [];
        const assets = [...(manifests.get(document.meta.code)?.values() ?? []), ...pending.map(item => ({ ...item.entry, pending: true }))];
        return json(response, 200, { path: relative, source, revision: revision(source), code: document.meta.code, assets });
      }
      if (request.method === 'POST' && url.pathname === '/api/assets') {
        const value = await body(request);
        requireSession(value);
        const file = safeFile(value.path);
        if (!file) return json(response, 404, { error: 'Unknown handout path' });
        const document = documents.find(item => item.sourcePath === value.path);
        const key = stageKey(value.session, value.path);
        const items = staged.get(key) ?? [];
        const item = await stageAsset(path.join(stagingRoot, value.session, createHash('sha256').update(value.path).digest('hex')), root, document.meta.code, value, items.map(candidate => candidate.entry.file));
        items.push(item); staged.set(key, items);
        return json(response, 201, { asset: { ...item.entry, pending: true }, markup: figureMarkup(document.meta.code, item.entry, value.options) });
      }
      if (request.method === 'POST' && url.pathname === '/api/figure') {
        const value = await body(request);
        const document = documents.find(item => item.sourcePath === value.path);
        const asset = combinedManifests(value).get(document?.meta.code)?.get(value.file);
        if (!document || !asset) return json(response, 404, { error: 'Unknown handout asset' });
        return json(response, 200, { markup: figureMarkup(document.meta.code, asset, value.options) });
      }
      if (request.method === 'POST' && url.pathname === '/api/assets/discard') {
        const value = await body(request);
        if (!safeFile(value.path)) return json(response, 404, { error: 'Unknown handout path' });
        await discardStaged(value);
        return json(response, 200, { discarded: true });
      }
      if (request.method === 'DELETE' && url.pathname === '/api/assets') {
        const value = await body(request);
        const file = safeFile(value.path);
        if (!file) return json(response, 404, { error: 'Unknown handout path' });
        const source = await fs.readFile(file, 'utf8');
        const document = documents.find(item => item.sourcePath === value.path);
        await deleteAsset(root, document.meta.code, value.file, source);
        await refreshAssets();
        return json(response, 200, { deleted: value.file });
      }
      if (request.method === 'POST' && url.pathname === '/api/render') {
        const value = await body(request);
        if (!safeFile(value.path) || typeof value.source !== 'string') return json(response, 400, { error: 'Invalid handout' });
        let html = renderHandoutSource(template, value.source, { sourcePath: value.path, manifests: combinedManifests(value) })
          .replace('../assets/print.css', '/assets/styles/print.css');
        for (const item of stagedFor(value)) {
          const original = `../assets/handouts/${documents.find(entry => entry.sourcePath === value.path).meta.code}/${item.entry.file}`;
          html = html.replaceAll(original, `${original}?session=${encodeURIComponent(value.session)}&path=${encodeURIComponent(value.path)}`);
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return response.end(html);
      }
      if (request.method === 'POST' && url.pathname === '/api/validate') {
        const value = await body(request);
        if (!safeFile(value.path) || typeof value.source !== 'string') return json(response, 400, { error: 'Invalid handout' });
        return json(response, 200, await validateSource(value));
      }
      if (request.method === 'POST' && url.pathname === '/api/scan') {
        const value = await body(request);
        const file = safeFile(value.path);
        if (!file) return json(response, 404, { error: 'Unknown handout path' });
        const source = await fs.readFile(file, 'utf8');
        const result = await validateSource({ path: value.path, source, phase: 'layout', session: `scan:${value.path}` });
        return json(response, 200, { path: value.path, formatting: result.valid ? 'valid' : 'error', issueCount: result.issues.length });
      }
      if (request.method === 'POST' && url.pathname === '/api/save') {
        const value = await body(request);
        const file = safeFile(value.path);
        if (!file || typeof value.source !== 'string' || typeof value.revision !== 'string') return json(response, 400, { error: 'Invalid save' });
        const syntax = await validateSource({ ...value, phase: 'syntax' });
        if (!syntax.valid && readHandoutStatus(value.source) === 'approved') {
          return json(response, 422, { error: 'Approved handouts must pass validation. Change the status to draft or under-review, or complete the approval requirements.' });
        }
        const current = await fs.readFile(file, 'utf8');
        if (revision(current) !== value.revision) return json(response, 409, { error: 'File changed on disk; revert before saving' });
        requireSession(value);
        const pending = stagedFor(value);
        await commitHandoutWithAssets(root, file, value.source, documents.find(item => item.sourcePath === value.path).meta.code, pending);
        await discardStaged(value);
        await refreshAssets();
        const savedStatus = value.source.match(/^status:\s*(draft|under-review|approved)\s*$/m)?.[1]
          ?? documents.find(item => item.sourcePath === value.path)?.meta.status;
        return json(response, 200, { revision: revision(value.source), status: savedStatus });
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serve(response, path.join(root, 'editor/index.html'), 'text/html; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/editor.js') return serve(response, path.join(root, 'editor/editor.js'), 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/editor-model.js') return serve(response, path.join(root, 'editor/editor-model.js'), 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/editor.css') return serve(response, path.join(root, 'editor/editor.css'), 'text/css; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/assets/styles/print.css') return serve(response, path.join(root, 'assets/styles/print.css'), 'text/css; charset=utf-8');
      if (request.method === 'GET' && url.pathname.startsWith('/assets/handouts/')) {
        const match = decodeURIComponent(url.pathname).match(/^\/assets\/handouts\/([^/]+)\/([^/]+)$/);
        if (!match) return json(response, 404, { error: 'Unknown asset' });
        const session = url.searchParams.get('session');
        const handoutPath = url.searchParams.get('path');
        const pending = session && handoutPath ? stagedFor({ session, path: handoutPath }).find(item => item.entry.file === match[2]) : null;
        if (pending) {
          const types = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
          response.writeHead(200, { 'content-type': types[path.extname(match[2]).toLowerCase()], 'cache-control': 'no-store' });
          return response.end(pending.bytes);
        }
        if (!manifests.get(match[1])?.has(match[2])) return json(response, 404, { error: 'Unknown asset' });
        const directory = path.join(root, 'assets', 'handouts', match[1]);
        const file = path.join(directory, match[2]);
        const types = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
        const contentType = types[path.extname(file).toLowerCase()];
        if (!contentType) return json(response, 404, { error: 'Unknown asset' });
        response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
        return response.end(await readAssetBytes(directory, match[2], `${match[1]}/${match[2]}`));
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) {
      json(response, error.status ?? (error instanceof SyntaxError ? 400 : 422), { error: error.message });
    }
  });
  server.on('close', () => {
    browser?.close().catch(() => {});
    if (validationRoot) fs.rm(validationRoot, { recursive: true, force: true }).catch(() => {});
    fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  });
  return server;
}
