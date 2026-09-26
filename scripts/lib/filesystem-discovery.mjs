import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHandoutSource } from './content-rendering.mjs';

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
    const document = parseHandoutSource(await fs.readFile(file, 'utf8'), sourcePath, manifests);
    const { meta } = document;
    if (codes.has(meta.code)) throw Error(`${sourcePath}: code: duplicates ${meta.code}`);
    codes.add(meta.code);
    documents.push(document);
  }
  return documents;
}
