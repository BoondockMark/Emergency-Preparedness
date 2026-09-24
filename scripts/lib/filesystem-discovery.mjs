import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDocument } from './metadata.mjs';
import { validateImages } from './page-validation.mjs';

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => (
    entry.isDirectory()
      ? walk(path.join(directory, entry.name))
      : [path.join(directory, entry.name)]
  )))).flat();
}

export async function discoverDocuments(root, manifests) {
  const files = (await walk(path.join(root, 'handouts')))
    .filter(file => file.endsWith('.md'))
    .sort();
  const documents = [];
  const codes = new Set();

  for (const file of files) {
    const sourcePath = path.relative(root, file);
    const { data: meta, content } = loadDocument(await fs.readFile(file, 'utf8'), sourcePath);
    if (codes.has(meta.code)) throw Error(`${sourcePath}: code: duplicates ${meta.code}`);
    codes.add(meta.code);
    const chunks = content.split(/\n<!--\s*pagebreak\s*-->\n/i);
    if (chunks.length !== meta.pageCount) {
      throw Error(`${sourcePath}: pageCount: expected ${chunks.length}`);
    }
    validateImages(content, meta.code, manifests);
    documents.push({ meta, chunks, sourcePath });
  }
  return documents;
}
