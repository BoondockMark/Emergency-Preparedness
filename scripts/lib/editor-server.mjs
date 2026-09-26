import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer';
import { browserOptions, copyAssets, openPrintPage, prepareDirectories, prepareDocumentValidation, validateDocument } from './artifact-generation.mjs';
import { loadAssetManifests } from './asset-validation.mjs';
import { renderHandoutSource } from './content-rendering.mjs';
import { discoverDocuments } from './filesystem-discovery.mjs';
import { loadDocument } from './metadata.mjs';

const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
};
const revision = source => createHash('sha256').update(source).digest('hex');

export async function createEditorServer({ root }) {
  const handoutsRoot = path.resolve(root, 'handouts');
  const realHandoutsRoot = await fs.realpath(handoutsRoot);
  const manifests = await loadAssetManifests(root);
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
  const validationGeneration = new Map();

  function safeFile(relative) {
    if (typeof relative !== 'string' || path.extname(relative) !== '.md') return null;
    return discovered.get(relative) ?? null;
  }
  async function body(request) {
    let value = '';
    for await (const chunk of request) {
      value += chunk;
      if (value.length > 2_000_000) throw Object.assign(Error('Request too large'), { status: 413 });
    }
    return JSON.parse(value || '{}');
  }
  async function serve(response, file, contentType) {
    response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    response.end(await fs.readFile(file));
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/api/handouts') {
        return json(response, 200, documents.map(({ sourcePath, meta }) => ({ path: sourcePath, title: meta.title, code: meta.code })));
      }
      if (request.method === 'GET' && url.pathname === '/api/handout') {
        const relative = url.searchParams.get('path');
        const file = safeFile(relative);
        if (!file) return json(response, 404, { error: 'Unknown handout path' });
        const source = await fs.readFile(file, 'utf8');
        return json(response, 200, { path: relative, source, revision: revision(source) });
      }
      if (request.method === 'POST' && url.pathname === '/api/render') {
        const value = await body(request);
        if (!safeFile(value.path) || typeof value.source !== 'string') return json(response, 400, { error: 'Invalid handout' });
        const html = renderHandoutSource(template, value.source, { sourcePath: value.path, manifests })
          .replace('../assets/print.css', '/assets/styles/print.css');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return response.end(html);
      }
      if (request.method === 'POST' && url.pathname === '/api/validate') {
        const value = await body(request);
        if (!safeFile(value.path) || typeof value.source !== 'string') return json(response, 400, { error: 'Invalid handout' });
        const session = typeof value.session === 'string' ? value.session : 'default';
        const requestId = Number.isSafeInteger(value.requestId) ? value.requestId : (validationGeneration.get(session) ?? 0) + 1;
        validationGeneration.set(session, Math.max(validationGeneration.get(session) ?? 0, requestId));
        // Deliberately perform the cheap metadata parse before any browser work.
        try { loadDocument(value.source, value.path); } catch (error) {
          const prepared = prepareDocumentValidation({ source: value.source, sourcePath: value.path, template, manifests });
          return json(response, 200, { phase: 'syntax', valid: false, issues: prepared.issues });
        }
        const prepared = prepareDocumentValidation({ source: value.source, sourcePath: value.path, template, manifests });
        if (prepared.issues.length || value.phase === 'syntax') {
          return json(response, 200, { phase: 'syntax', valid: !prepared.issues.length, issues: prepared.issues });
        }
        const generation = requestId;
        const resources = await validationResources();
        const htmlFile = path.join(resources.validationRoot, 'html', `${prepared.document.meta.code}-${generation}.html`);
        await fs.writeFile(htmlFile, prepared.html);
        let page;
        try {
          page = await openPrintPage(resources.browser, htmlFile);
          const result = await validateDocument({ page, document: prepared.document, html: prepared.html, htmlFile });
          if (validationGeneration.get(session) !== generation) return json(response, 409, { superseded: true });
          return json(response, 200, { phase: 'layout', ...result });
        } finally {
          await page?.close();
          await fs.rm(htmlFile, { force: true });
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/save') {
        const value = await body(request);
        const file = safeFile(value.path);
        if (!file || typeof value.source !== 'string' || typeof value.revision !== 'string') return json(response, 400, { error: 'Invalid save' });
        const current = await fs.readFile(file, 'utf8');
        if (revision(current) !== value.revision) return json(response, 409, { error: 'File changed on disk; revert before saving' });
        const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporary, value.source, { flag: 'wx' });
          await fs.rename(temporary, file);
        } finally { await fs.rm(temporary, { force: true }); }
        return json(response, 200, { revision: revision(value.source) });
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serve(response, path.join(root, 'editor/index.html'), 'text/html; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/editor.js') return serve(response, path.join(root, 'editor/editor.js'), 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/editor.css') return serve(response, path.join(root, 'editor/editor.css'), 'text/css; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/assets/styles/print.css') return serve(response, path.join(root, 'assets/styles/print.css'), 'text/css; charset=utf-8');
      json(response, 404, { error: 'Not found' });
    } catch (error) {
      json(response, error.status ?? (error instanceof SyntaxError ? 400 : 422), { error: error.message });
    }
  });
  server.on('close', () => {
    browser?.close().catch(() => {});
    if (validationRoot) fs.rm(validationRoot, { recursive: true, force: true }).catch(() => {});
  });
  return server;
}
