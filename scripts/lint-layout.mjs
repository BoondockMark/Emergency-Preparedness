import path from 'node:path';
import process from 'node:process';
import { lintLayouts } from './lib/artifact-generation.mjs';
import { loadAssetManifests } from './lib/asset-validation.mjs';
import { discoverDocuments } from './lib/filesystem-discovery.mjs';

const root = path.resolve(import.meta.dirname, '..');
const requestedCodes = new Set(process.argv.slice(2).map(code => code.toUpperCase()));
const manifests = await loadAssetManifests(root);
const discovered = await discoverDocuments(root, manifests);
const documents = requestedCodes.size
  ? discovered.filter(({ meta }) => requestedCodes.has(meta.code))
  : discovered;

if (requestedCodes.size) {
  const found = new Set(documents.map(({ meta }) => meta.code));
  const unknown = [...requestedCodes].filter(code => !found.has(code));
  if (unknown.length) throw Error(`Unknown handout code(s): ${unknown.join(', ')}`);
}

const outputRoot = path.join(root, 'build');
await lintLayouts({ root, outputRoot, documents, manifests });
console.log(`Layout lint passed for ${documents.length} handout${documents.length === 1 ? '' : 's'}.`);
