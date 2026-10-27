import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer';
import { browserOptions, copyAssets, openPrintPage, prepareDirectories, prepareDocumentValidation, validateDocument } from './artifact-generation.mjs';
import { loadAssetManifests, readAssetBytes } from './asset-validation.mjs';
import { renderHandoutSource } from './content-rendering.mjs';
import { loadBuildContent } from './private-content.mjs';
import { loadDocument, parseMetadataYaml } from './metadata.mjs';
import { commitHandoutWithAssets, deleteAsset, figureMarkup, stageAsset } from './editor-support.mjs';
import { createProofJobs } from './editor-proofs.mjs';
import { createHandout, libraryOptions } from './editor-library.mjs';
import { readHandoutStatus } from '../../editor/editor-model.js';

const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
};
const revision = source => createHash('sha256').update(source).digest('hex');

export async function createEditorServer({ root, privateDirectory, publicOnly = false, requirePrivate = false }) {
  const content = await loadBuildContent(root, { privateDirectory, publicOnly, requirePrivate });
  let documents = content.documents;
  const { privateRoot } = content;
  let manifests = content.manifests;
  const temporaryRoot = privateRoot ? path.join(privateRoot, 'build/editor') : os.tmpdir();
  if (privateRoot) await fs.mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const stagingRoot = await fs.mkdtemp(path.join(temporaryRoot, 'handout-editor-assets-'));
  const documentRoot = relative => documents.find(item => item.sourcePath === relative)?.contentRoot || root;
  const staged = new Map();
  const stageKey = (session, handoutPath) => `${session}\0${handoutPath}`;
  const stagedFor = value => staged.get(stageKey(value.session, value.path)) ?? [];
  const requireSession = value => {
    if (typeof value.session !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(value.session)) throw Object.assign(Error('A valid editor session is required'), { status: 400 });
  };
  const combinedManifests = value => {
    const combined = new Map([...manifests].map(([code, assets]) => [code, new Map(assets)]));
    combined.roots = manifests.roots;
    const document = documents.find(item => item.sourcePath === value.path);
    if (document) for (const item of stagedFor(value)) {
      if (!combined.has(document.meta.code)) combined.set(document.meta.code, new Map());
      combined.get(document.meta.code).set(item.entry.file, item.entry);
    }
    return combined;
  };
  async function discardStaged(value, subset) {
    requireSession(value);
    const key = stageKey(value.session, value.path);
    const removing = subset || staged.get(key) || [];
    for (const item of removing) await fs.rm(item.stagedFile, { force: true });
    const remaining = (staged.get(key) || []).filter(item => !removing.includes(item));
    if (remaining.length) staged.set(key, remaining); else staged.delete(key);
  }
  let discovered = await discoveredFiles(documents);
  async function discoveredFiles(records) {
    const files = new Map();
    for (const record of records) {
      const contentRoot = record.contentRoot || root;
      const realRoot = await fs.realpath(contentRoot);
      const realHandoutsRoot = await fs.realpath(path.join(contentRoot, 'handouts'));
      const realFile = await fs.realpath(path.resolve(contentRoot, record.sourcePath));
      if (!realHandoutsRoot.startsWith(realRoot + path.sep) || !realFile.startsWith(realHandoutsRoot + path.sep)) throw Error('Handout source escapes its library');
      if (path.extname(realFile) === '.md') files.set(record.sourcePath, realFile);
    }
    return files;
  }
  async function reloadLibrary() {
    const next = await loadBuildContent(root, { privateDirectory: privateRoot, publicOnly, requirePrivate });
    const files = await discoveredFiles(next.documents);
    documents = next.documents; manifests = next.manifests; discovered = files;
  }
  const handoutList = () => documents.map(({ sourcePath, meta, contentRoot }) => ({ path: sourcePath, title: meta.title, code: meta.code, sectionNumber: meta.sectionNumber, status: meta.status, private: Boolean(contentRoot), formatting: 'unchecked' }));
  let libraryOperation = Promise.resolve();
  function changeLibrary(operation) {
    const result = libraryOperation.then(operation);
    libraryOperation = result.catch(() => {});
    return result;
  }
  const saves = new Map();
  function saveHandout(relative, operation) {
    const result = (saves.get(relative) || Promise.resolve()).catch(() => {}).then(operation);
    saves.set(relative, result);
    const clear = () => { if (saves.get(relative) === result) saves.delete(relative); };
    result.then(clear, clear);
    return result;
  }
  const template = await fs.readFile(path.join(root, 'templates/handout.html'), 'utf8');
  const proofs = createProofJobs({ root, temporaryRoot, privateRoot, template });
  let validationRoot;
  let browser;
  let resourcesPromise;
  async function validationResources() {
    resourcesPromise ??= (async () => {
      validationRoot = await fs.mkdtemp(path.join(temporaryRoot, 'handout-validation-'));
      await prepareDirectories(root, validationRoot);
      const assetManifests = manifests;
      await copyAssets(root, validationRoot, assetManifests);
      const options = browserOptions();
      if (privateRoot) {
        options.userDataDir = path.join(validationRoot, 'browser-profile');
        options.env = { ...options.env, TMPDIR: temporaryRoot };
      }
      browser = await puppeteer.launch(options);
      return { validationRoot, browser, assetManifests };
    })();
    return resourcesPromise;
  }
  async function refreshAssets() {
    manifests = await loadAssetManifests(root);
    manifests.roots = new Map();
    if (privateRoot) {
      for (const [code, entries] of await loadAssetManifests(privateRoot)) {
        manifests.set(code, entries);
        manifests.roots.set(code, privateRoot);
      }
    }
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
    const contents = await fs.readFile(file);
    response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    response.end(contents);
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
    while (resources.assetManifests !== manifests) {
      const current = manifests;
      resources.assetRefresh ??= copyAssets(root, resources.validationRoot, current)
        .then(() => { resources.assetManifests = current; })
        .finally(() => { resources.assetRefresh = undefined; });
      await resources.assetRefresh;
    }
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
      if (request.method === 'POST' && ['/api/proofs/start', '/api/proofs/status', '/api/proofs/download', '/api/proofs/cancel'].includes(url.pathname)) {
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return json(response, 415, { error: 'PDF proof requests require application/json' });
        const value = await body(request); requireSession(value);
        if (url.pathname === '/api/proofs/start') {
          if (!safeFile(value.path) || typeof value.source !== 'string') return json(response, 400, { error: 'Invalid handout snapshot' });
          if (value.private !== undefined && value.private !== Boolean(documents.find(item => item.sourcePath === value.path)?.contentRoot)) return json(response, 409, { error: 'The handout library changed. Reopen the intended handout before building a proof.' });
          const snapshot = { path: value.path, source: value.source, session: value.session, contentRoot: documentRoot(value.path), manifests: combinedManifests(value), staged: stagedFor(value).map(item => ({ entry: { ...item.entry }, bytes: Buffer.from(item.bytes) })) };
          return json(response, 202, await proofs.start(snapshot));
        }
        if (url.pathname === '/api/proofs/status') return json(response, 200, proofs.status(value));
        if (url.pathname === '/api/proofs/cancel') return json(response, 200, await proofs.cancel(value));
        const { pdf, filename } = proofs.download(value);
        response.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}"`, 'content-length': pdf.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return response.end(pdf);
      }
      if (request.method === 'GET' && url.pathname === '/api/handouts') {
        return json(response, 200, handoutList());
      }
      if (request.method === 'GET' && url.pathname === '/api/library-options') {
        return json(response, 200, libraryOptions(documents, manifests, privateRoot));
      }
      if (request.method === 'POST' && url.pathname === '/api/library/refresh') {
        const value = await body(request); requireSession(value);
        return json(response, 200, await changeLibrary(async () => {
          await reloadLibrary();
          return { handouts: handoutList(), options: libraryOptions(documents, manifests, privateRoot) };
        }));
      }
      if (request.method === 'POST' && url.pathname === '/api/handouts/new') {
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return json(response, 415, { error: 'Handout creation requires application/json' });
        const value = await body(request); requireSession(value);
        return json(response, 201, await changeLibrary(async () => {
          await reloadLibrary();
          const created = await createHandout({ root, privateRoot, documents, manifests, request: value, reload: reloadLibrary });
          return { ...created, handouts: handoutList(), options: libraryOptions(documents, manifests, privateRoot) };
        }));
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
        return json(response, 200, { path: relative, source, revision: revision(source), code: document.meta.code, assets, private: Boolean(document.contentRoot) });
      }
      if (request.method === 'POST' && url.pathname === '/api/details') {
        const value = await body(request);
        if (!safeFile(value.path) || typeof value.source !== 'string') return json(response, 400, { error: 'Invalid handout' });
        const match = value.source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        if (!match) return json(response, 422, { error: 'Correct the front matter delimiters in Source first.' });
        return json(response, 200, { metadata: parseMetadataYaml(match[1], value.path) });
      }
      if (request.method === 'POST' && url.pathname === '/api/assets') {
        const value = await body(request);
        requireSession(value);
        const file = safeFile(value.path);
        if (!file) return json(response, 404, { error: 'Unknown handout path' });
        const document = documents.find(item => item.sourcePath === value.path);
        const key = stageKey(value.session, value.path);
        const items = staged.get(key) ?? [];
        const item = await stageAsset(path.join(stagingRoot, value.session, createHash('sha256').update(value.path).digest('hex')), documentRoot(value.path), document.meta.code, value, items.map(candidate => candidate.entry.file));
        const active = staged.get(key) || []; active.push(item); staged.set(key, active);
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
        await deleteAsset(documentRoot(value.path), document.meta.code, value.file, source);
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
        return await saveHandout(value.path, async () => {
          const record = documents.find(item => item.sourcePath === value.path);
          if (!record || safeFile(value.path) !== file) return json(response, 409, { error: 'The library changed while this save was queued. Compare disk changes before saving.' });
          const contentRoot = record?.contentRoot || root;
          if (value.private !== undefined && value.private !== Boolean(record?.contentRoot)) return json(response, 409, { error: 'The handout now belongs to a different library. Reopen the intended handout before saving.' });
          const syntax = await validateSource({ ...value, phase: 'syntax' });
          const status = readHandoutStatus(value.source);
          if (!syntax.valid && !['draft', 'under-review'].includes(status)) {
            const error = status === 'approved'
              ? 'Approved handouts must pass validation. Change the status to draft or under-review, or complete the approval requirements.'
              : 'Handouts with invalid or missing status metadata must pass validation. Change the status to draft or under-review, then correct the remaining validation errors.';
            return json(response, 422, { error });
          }
          const current = await fs.readFile(file, 'utf8');
          if (revision(current) !== value.revision) return json(response, 409, { error: 'File changed on disk; compare changes before saving' });
          requireSession(value);
          const pending = [...stagedFor(value)];
          await commitHandoutWithAssets(contentRoot, file, value.source, record.meta.code, pending);
          await discardStaged(value, pending);
          await refreshAssets();
          const savedStatus = value.source.match(/^status:\s*(draft|under-review|approved)\s*$/m)?.[1]
            ?? record.meta.status;
          return json(response, 200, { revision: revision(value.source), status: savedStatus, committedAssets: pending.map(item => item.entry.file) });
        });
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return await serve(response, path.join(root, 'editor/index.html'), 'text/html; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/editor.js') return await serve(response, path.join(root, 'editor/editor.js'), 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/change-controls.js') return await serve(response, path.join(root, 'editor/change-controls.js'), 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/change-model.js') return await serve(response, path.join(root, 'editor/change-model.js'), 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/proof-controls.js') return await serve(response, path.join(root, 'editor/proof-controls.js'), 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/library-controls.js') return await serve(response, path.join(root, 'editor/library-controls.js'), 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/preview-controls.js') return await serve(response, path.join(root, 'editor/preview-controls.js'), 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/editor-model.js') return await serve(response, path.join(root, 'editor/editor-model.js'), 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/editor.css') return await serve(response, path.join(root, 'editor/editor.css'), 'text/css; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/assets/styles/print.css') return await serve(response, path.join(root, 'assets/styles/print.css'), 'text/css; charset=utf-8');
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
        const directory = path.join(manifests.roots?.get(match[1]) || root, 'assets', 'handouts', match[1]);
        const file = path.join(directory, match[2]);
        const types = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
        const contentType = types[path.extname(file).toLowerCase()];
        if (!contentType) return json(response, 404, { error: 'Unknown asset' });
        const bytes = await readAssetBytes(directory, match[2], `${match[1]}/${match[2]}`);
        response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
        return response.end(bytes);
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) {
      json(response, error.status ?? (error instanceof SyntaxError ? 400 : 422), { error: error.message });
    }
  });
  server.on('close', () => {
    proofs.close().catch(() => {});
    browser?.close().catch(() => {});
    if (validationRoot) fs.rm(validationRoot, { recursive: true, force: true }).catch(() => {});
    fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  });
  return server;
}
