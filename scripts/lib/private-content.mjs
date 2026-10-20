import fs from 'node:fs/promises';
import path from 'node:path';
import { loadAssetManifests } from './asset-validation.mjs';
import { discoverDocuments } from './filesystem-discovery.mjs';

async function rejectSymlinks(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if ((await fs.lstat(directory)).isSymbolicLink()) throw Error('Private source directories cannot be symlinks');
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw Error('Private sources cannot contain symlinks');
    if (entry.isDirectory()) await rejectSymlinks(path.join(directory, entry.name));
  }
}

// No network access here: a private checkout is the access boundary.
export async function loadBuildContent(root, { publicOnly = false, requirePrivate = false, privateDirectory = process.env.BINDER_PRIVATE_DIR } = {}) {
  if (publicOnly && requirePrivate) throw Error('--public and --private cannot be combined');
  let privateRoot;
  if (!publicOnly && (requirePrivate || privateDirectory)) {
    if (!privateDirectory) throw Error('Private builds require BINDER_PRIVATE_DIR pointing to a private checkout');
    privateRoot = await fs.realpath(path.resolve(root, privateDirectory));
    const publicRoot = await fs.realpath(root);
    if (privateRoot === publicRoot || privateRoot.startsWith(publicRoot + path.sep)) {
      throw Error('Private checkout must be outside the public checkout');
    }
    await rejectSymlinks(path.join(privateRoot, 'handouts'));
    await rejectSymlinks(path.join(privateRoot, 'assets'));
    await rejectSymlinks(path.join(privateRoot, 'docs'));
  }
  const manifests = await loadAssetManifests(root);
  manifests.roots = new Map();
  if (privateRoot) {
    for (const [code, entries] of await loadAssetManifests(privateRoot)) {
      manifests.set(code, entries);
      manifests.roots.set(code, privateRoot);
    }
  }
  const documents = await discoverDocuments(root, manifests, { privateRoot });
  if (privateRoot) {
    const privateDocuments = await discoverDocuments(privateRoot, manifests);
    const slots = new Map(documents.filter(document => document.contentRoot).map(document => [document.meta.code, document.sourcePath]));
    for (const document of privateDocuments) {
      if (slots.get(document.meta.code) !== document.sourcePath) throw Error(`${document.meta.code}: private handout needs a matching public placeholder path`);
    }
    const privateCodes = new Set(documents.filter(document => document.contentRoot).map(document => document.meta.code));
    for (const code of manifests.roots.keys()) {
      if (!privateCodes.has(code)) throw Error(`${code}: private assets must belong to a private replacement`);
    }
  }
  return { documents, manifests, privateRoot };
}
