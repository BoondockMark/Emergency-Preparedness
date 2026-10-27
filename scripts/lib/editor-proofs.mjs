import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer';
import { browserOptions, copyAssets, openPrintPage, prepareDirectories, prepareDocumentValidation, renderPrintPdf, validateApprovals, validateDocument, validateRenderedPage } from './artifact-generation.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const terminal = new Set(['ready', 'failed', 'cancelled']);
const fail = (message, status) => { throw Object.assign(Error(message), { status }); };

export function createProofJobs({ root, temporaryRoot, privateRoot, template }) {
  const jobs = new Map();
  let closed = false;
  let starting = Promise.resolve();
  function describe(job) {
    return { id: job.id, path: job.path, sourceHash: job.sourceHash, state: job.state, progress: job.progress, issues: job.issues, error: job.error, code: job.code, pageCount: job.pageCount, filename: job.filename, pdfSha256: job.pdfSha256, size: job.pdf?.length, private: job.private };
  }
  function find({ id, session }) {
    const job = jobs.get(id);
    if (!job || job.session !== session) fail('PDF proof not found or expired. Build a new proof.', 404);
    return job;
  }
  function forget(job) {
    clearTimeout(job.expiry); job.pdf = undefined; jobs.delete(job.id);
  }
  function check(job) { if (job.cancelled) throw Error('PDF proof build cancelled'); }
  function stage(job, state, progress) { check(job); job.state = state; job.progress = progress; }
  async function stop(job) {
    job.cancelled = true;
    if (!terminal.has(job.state)) job.state = 'cancelled';
    await job.browser?.close().catch(() => {});
    await job.task;
    forget(job);
  }
  async function run(job, input) {
    let workspace;
    let completedPdf;
    let issueType = 'print';
    const deadline = setTimeout(() => {
      job.cancelled = true; job.state = 'failed'; job.error = 'PDF proof build timed out. Try again.';
      job.browser?.close().catch(() => {});
    }, 120_000);
    deadline.unref();
    try {
      stage(job, 'checking', 1);
      const prepared = prepareDocumentValidation({ source: input.source, sourcePath: job.path, template, manifests: input.manifests });
      if (prepared.issues.length) { job.issues = prepared.issues; job.error = 'Fix source or metadata errors before building a PDF proof.'; job.state = 'failed'; return; }
      const { document, html } = prepared;
      const { meta } = document;
      job.code = meta.code; job.pageCount = meta.pageCount; job.filename = `${meta.code}-proof.pdf`;
      stage(job, 'preparing', 2);
      workspace = await fs.mkdtemp(path.join(temporaryRoot, 'handout-proof-'));
      await prepareDirectories(root, workspace);
      await fs.chmod(workspace, 0o700);
      check(job);
      // Copy only this handout's saved assets. Staged uploads have immutable
      // in-memory byte snapshots and need not exist in either checkout yet.
      const entries = new Map(input.manifests.get(meta.code) || []);
      for (const asset of input.staged) entries.delete(asset.entry.file);
      const savedAssets = new Map([[meta.code, entries]]);
      savedAssets.roots = input.manifests.roots;
      await copyAssets(root, workspace, savedAssets);
      const assetDirectory = path.join(workspace, 'assets/handouts', meta.code);
      for (const asset of input.staged) {
        check(job); await fs.mkdir(assetDirectory, { recursive: true });
        await fs.writeFile(path.join(assetDirectory, asset.entry.file), asset.bytes);
      }
      const htmlFile = path.join(workspace, 'html', `${meta.code}.html`);
      await fs.writeFile(htmlFile, html);
      check(job);
      const options = browserOptions();
      if (privateRoot) { options.userDataDir = path.join(workspace, 'browser-profile'); options.env = { ...options.env, TMPDIR: temporaryRoot }; }
      job.browser = await puppeteer.launch(options);
      check(job);
      stage(job, 'rendering', 3);
      const page = await openPrintPage(job.browser, htmlFile);
      const validation = await validateDocument({ page, document, html, htmlFile });
      job.issues = validation.issues;
      if (!validation.valid) { job.state = 'failed'; job.error = 'Fix print layout errors before downloading this proof.'; return; }
      await validateRenderedPage(page, meta.code, meta.pageCount, path.join(workspace, 'diagnostics'), () => {});
      stage(job, 'encoding', 4);
      const pdf = await renderPrintPdf(page, meta.code, meta.pageCount);
      check(job);
      await fs.writeFile(path.join(workspace, 'pdfs', `${meta.code}.pdf`), pdf);
      stage(job, 'verifying', 5); issueType = 'approval';
      await validateApprovals(root, workspace, [{ ...document, contentRoot: input.contentRoot }]);
      check(job);
      if (pdf.length > 20 * 1024 * 1024) throw Error('This proof exceeds 20 MB. Reduce image sizes and build again.');
      completedPdf = Buffer.from(pdf);
    } catch (error) {
      if (!job.cancelled) {
        job.state = 'failed'; job.error = error.message;
        job.issues.push({ severity: 'error', type: issueType, code: job.code, sourcePath: job.path, message: error.message });
      }
    } finally {
      clearTimeout(deadline);
      await job.browser?.close().catch(() => {}); job.browser = undefined;
      if (workspace) await fs.rm(workspace, { recursive: true, force: true });
      if (completedPdf && !job.cancelled) { job.pdf = completedPdf; job.pdfSha256 = hash(completedPdf); job.state = 'ready'; }
      job.finished = true;
      if (!closed && jobs.has(job.id)) {
        job.expiry = setTimeout(() => forget(job), 15 * 60_000); job.expiry.unref();
      }
    }
  }
  return {
    start(input) {
      const create = async () => {
        if (closed) fail('The editor is shutting down', 503);
        for (const job of jobs.values()) if (job.session === input.session) await stop(job);
        if ([...jobs.values()].filter(job => !job.finished).length >= 2) fail('Two PDF proofs are already building. Try again shortly.', 429);
        for (const job of jobs.values()) { if (jobs.size < 8) break; if (job.finished) forget(job); }
        const job = { id: randomUUID(), path: input.path, session: input.session, sourceHash: hash(input.source), private: Boolean(input.contentRoot !== root), state: 'queued', progress: 0, issues: [] };
        jobs.set(job.id, job);
        job.task = Promise.resolve().then(() => run(job, input));
        // A cleanup failure must not produce an unhandled rejection or a usable download.
        job.task = job.task.catch(error => { job.pdf = undefined; job.state = 'failed'; job.error = error.message; job.finished = true; });
        return describe(job);
      };
      const result = starting.then(create); starting = result.catch(() => {}); return result;
    },
    status(value) { return describe(find(value)); },
    download(value) {
      const job = find(value);
      if (job.state !== 'ready' || !job.pdf) fail('This PDF proof is not ready to download.', 409);
      return { pdf: job.pdf, filename: job.filename };
    },
    async cancel(value) { await stop(find(value)); return { cancelled: true }; },
    async close() { closed = true; await Promise.all([...jobs.values()].map(stop)); }
  };
}
