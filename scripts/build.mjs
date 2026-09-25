import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { generateArtifacts } from './lib/artifact-generation.mjs';
import { loadAssetManifests } from './lib/asset-validation.mjs';
import { discoverDocuments } from './lib/filesystem-discovery.mjs';

const root = path.resolve(import.meta.dirname, '..');
const checkOnly = process.argv.includes('--check');
const updateVisuals = process.argv.includes('--update-visuals');

if (checkOnly && updateVisuals) {
  throw Error('--check and --update-visuals cannot be used together');
}
if (updateVisuals) {
  await fs.copyFile(
    path.join(root, 'assets/styles/print.css'),
    path.join(root, 'test/fixtures/baseline.css')
  );
}

const manifests = await loadAssetManifests(root);
const documents = await discoverDocuments(root, manifests);
const outputRoot = checkOnly
  ? await fs.mkdtemp(path.join(os.tmpdir(), 'binder-check-'))
  : path.join(root, 'build');

try {
  const tolerance = await generateArtifacts({ root, outputRoot, documents, manifests });
  const expectedArtifacts = [
    ['BINDER_INDEX.md', 'BINDER_INDEX.md'],
    ['docs/moodle-index.html', 'moodle-index.html'],
    ...documents.map(({ meta }) => [
      `docs/pdfs/${meta.code}.pdf`,
      `pdfs/${meta.code}.pdf`
    ])
  ];

  if (checkOnly) {
    const changed = [];
    for (const [tracked, generated] of expectedArtifacts) {
      let matches = false;
      try {
        const [expected, actual] = await Promise.all([
          fs.readFile(path.join(root, tracked)),
          fs.readFile(path.join(outputRoot, generated))
        ]);
        matches = expected.equals(actual);
      } catch {
        // A missing tracked artifact is reported with the same actionable message.
      }
      if (!matches) changed.push(tracked);
    }
    if (changed.length) {
      throw Error(`Generated artifacts are stale; run npm run build and commit:\n${changed.join('\n')}`);
    }
  } else {
    await fs.copyFile(
      path.join(outputRoot, 'BINDER_INDEX.md'),
      path.join(root, 'BINDER_INDEX.md')
    );
    await fs.copyFile(
      path.join(outputRoot, 'moodle-index.html'),
      path.join(root, 'docs/moodle-index.html')
    );
    await fs.mkdir(path.join(root, 'docs/pdfs'), { recursive: true });
    await fs.mkdir(path.join(root, 'docs/previews'), { recursive: true });
    for (const { meta } of documents) {
      await fs.copyFile(
        path.join(outputRoot, 'pdfs', `${meta.code}.pdf`),
        path.join(root, 'docs/pdfs', `${meta.code}.pdf`)
      );
      const derivedPageCount = meta.pageCount;
      for (let page = 1; page <= derivedPageCount; page++) {
        await fs.copyFile(
          path.join(outputRoot, 'previews', `${meta.code}-page-${page}.png`),
          path.join(root, 'docs/previews', `${meta.code}-page-${page}.png`)
        );
      }
    }
  }

  const pages = documents.reduce((total, { meta }) => total + meta.pageCount, 0);
  console.log(
    `${checkOnly ? 'Checked' : 'Built and checked'} ${documents.length} handouts / ${pages} PDF pages. `
    + `Visual fixture tolerance: ${tolerance.maxDifferentPixelRatio * 100}%.`
  );
} finally {
  if (checkOnly) await fs.rm(outputRoot, { recursive: true, force: true });
}
