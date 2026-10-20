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

export async function discoverDocuments(root, manifests, { privateRoot } = {}) {
  const files = (await walk(path.join(root, 'handouts')))
    .filter(file => file.endsWith('.md'))
    .sort();
  const documents = [];
  const codes = new Set();

  for (const file of files) {
    const sourcePath = path.relative(root, file);
    const document = parseHandoutSource(await fs.readFile(file, 'utf8'), sourcePath, manifests);
    let selected = document;
    if (document.meta.private && privateRoot) {
      const privateFile = path.join(privateRoot, sourcePath);
      selected = parseHandoutSource(await fs.readFile(privateFile, 'utf8'), sourcePath, manifests);
      for (const field of ['code', 'section', 'sectionNumber']) {
        if (selected.meta[field] !== document.meta[field]) {
          throw Error(`${sourcePath}: private replacement must match public ${field}`);
        }
      }
      selected.meta.private = true;
      selected.contentRoot = privateRoot;
    }
    const { meta } = selected;
    if (codes.has(meta.code)) throw Error(`${sourcePath}: code: duplicates ${meta.code}`);
    codes.add(meta.code);
    documents.push(selected);
  }
  return documents;
}
