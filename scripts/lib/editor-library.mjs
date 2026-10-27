import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SECTIONS, SECTION_CODES, loadDocument } from './metadata.mjs';
import { readAssetBytes } from './asset-validation.mjs';
import { updateMetadataFields } from '../../editor/editor-model.js';

const FOLDERS = ['start-here', 'alerts-communication', 'evacuation-shelter', 'water-food-cooking', 'home-utilities', 'hands-on-skills', 'hazard-guides', 'plans-records'];
export const HANDOUT_TEMPLATES = [
  { id: 'starter', title: 'Basic handout', description: 'Purpose, actions, and local information.', body: '## Purpose\n\n[VERIFY and describe the purpose of this handout.]\n\n## What to do\n\n[VERIFY and add reviewed instructions.]\n\n<div class="local-info"><p>[VERIFY local information.]</p></div>\n' },
  { id: 'checklist', title: 'Checklist', description: 'A printable list of things to prepare or check.', body: '## Preparation checklist\n\n<div class="checklist"><ul>\n<li>[VERIFY and add a checklist item.]</li>\n<li>[VERIFY and add another checklist item.]</li>\n</ul></div>\n' },
  { id: 'procedure', title: 'Step-by-step guide', description: 'Numbered instructions with a warning block.', body: '<div class="warning"><p>[VERIFY when this procedure is appropriate and add precautions.]</p></div>\n\n## Steps\n\n<ol class="procedure">\n<li>[VERIFY and describe the first step.]</li>\n<li>[VERIFY and describe the next step.]</li>\n</ol>\n' }
];
const fail = (message, status = 422) => { throw Object.assign(Error(message), { status }); };

export function libraryOptions(documents, manifests, privateRoot) {
  return {
    sections: SECTIONS.map((title, index) => {
      const prefix = SECTION_CODES[index];
      const reserved = [...documents.map(document => document.meta.code), ...manifests.keys()];
      const last = Math.max(0, ...reserved.filter(code => new RegExp(`^${prefix}-\\d{3}$`).test(code)).map(code => Number(code.slice(-3))));
      return { title, number: index + 1, prefix, nextCode: last < 999 ? `${prefix}-${String(last + 1).padStart(3, '0')}` : null };
    }),
    templates: HANDOUT_TEMPLATES.map(({ id, title, description }) => ({ id, title, description })),
    libraries: privateRoot ? ['public', 'private'] : ['public']
  };
}

// Every path component is checked, including pre-existing directories. A new
// handout must never write through a symlink into another checkout.
async function ensureDirectory(root, relative, created) {
  let current = await fs.realpath(root);
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    try { await fs.mkdir(current); created.push(current); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const entry = await fs.lstat(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail('Handout and asset directories must not contain symlinks');
  }
  return current;
}

function handoutSource(metadata, body) {
  // The workflow status stays unquoted for the existing status control.
  return updateMetadataFields('---\ncode: NEW\n---\n', metadata).replace(/^status: "draft"$/m, 'status: draft') + body;
}

export async function createHandout({ root, privateRoot, documents, manifests, request, reload }) {
  const { title, sectionNumber, library, template: templateId, sourcePath, revision, reviewDate } = request;
  if (typeof title !== 'string' || !title.trim() || [...title.trim()].length > 72 || /[\r\n]/.test(title)) fail('Title must be 1–72 characters on one line');
  const section = libraryOptions(documents, manifests, privateRoot).sections.find(section => section.number === sectionNumber);
  if (!section) fail('Choose a recognized binder section');
  if (!section.nextCode) fail('This section has no remaining three-digit handout codes', 409);
  if (!['public', 'private'].includes(library) || (library === 'private' && !privateRoot)) fail('The selected library is unavailable', 403);
  const starter = HANDOUT_TEMPLATES.find(template => template.id === templateId);
  const original = sourcePath ? documents.find(document => document.sourcePath === sourcePath) : null;
  if (sourcePath && !original) fail('Unknown handout to duplicate', 404);
  if (!original && !starter) fail('Choose a handout template');
  if (original?.meta.private && library !== 'private') fail('Private handouts can only be duplicated into the private library', 403);
  let originalMetadata;
  let body = starter?.body;
  if (original) {
    const sourceRoot = original.contentRoot || root;
    const realDirectory = await fs.realpath(path.join(sourceRoot, 'handouts'));
    const file = await fs.realpath(path.join(sourceRoot, sourcePath));
    if (!file.startsWith(realDirectory + path.sep)) fail('Handout source escapes its library', 403);
    const raw = await fs.readFile(file, 'utf8');
    if (createHash('sha256').update(raw).digest('hex') !== revision) fail('The original changed on disk. Revert or reload it before duplicating.', 409);
    const loaded = loadDocument(raw, sourcePath);
    originalMetadata = loaded.data;
    body = loaded.content.replaceAll(`../assets/handouts/${original.meta.code}/`, `../assets/handouts/${section.nextCode}/`);
  }
  const metadata = {
    code: section.nextCode, title: title.trim(), section: section.title, sectionNumber,
    status: 'draft', version: '0.1', lastReviewed: reviewDate,
    reviewers: { editor: 'Unassigned', subjectMatter: 'Unassigned' },
    sources: originalMetadata?.sources || [{ type: 'local', title: 'Draft source record', provider: 'Unassigned', location: '[VERIFY and record the source]', receivedDate: reviewDate }]
  };
  if (library === 'private') metadata.private = true;
  const source = handoutSource(metadata, body);
  loadDocument(source, 'new-handout.md');
  const slug = library === 'private' ? 'private-handout' : title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '') || 'handout';
  const relative = `handouts/${FOLDERS[sectionNumber - 1]}/${section.nextCode}-${slug}.md`;
  const destinationRoot = library === 'private' ? privateRoot : root;
  const assets = original ? [...(manifests.get(original.meta.code)?.values() || [])] : [];
  const copied = [];
  for (const asset of assets) {
    const sourceRoot = manifests.roots?.get(original.meta.code) || root;
    const directory = path.join(sourceRoot, 'assets/handouts', original.meta.code);
    const realDirectory = await fs.realpath(directory);
    if (!realDirectory.startsWith((await fs.realpath(sourceRoot)) + path.sep)) fail('Asset directory escapes its library', 403);
    let file = path.join(directory, asset.file);
    try { await fs.lstat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; file += '.base64'; }
    const entry = await fs.lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink()) fail('Duplicated assets must be regular files', 403);
    const bytes = await readAssetBytes(directory, asset.file);
    copied.push({ name: `${asset.file}.base64`, data: `${bytes.toString('base64').match(/.{1,76}/g).join('\n')}\n` });
  }
  const files = [];
  const directories = [];
  async function write(file, data, mode) {
    const handle = await fs.open(file, 'wx', mode);
    files.push(file);
    try { await handle.writeFile(data, 'utf8'); } finally { await handle.close(); }
  }
  try {
    if (assets.length) {
      const parent = await ensureDirectory(destinationRoot, 'assets/handouts', directories);
      const directory = path.join(parent, section.nextCode);
      await fs.mkdir(directory, { mode: library === 'private' ? 0o700 : 0o755 }); directories.push(directory);
      for (const file of copied) await write(path.join(directory, file.name), file.data, library === 'private' ? 0o600 : 0o644);
      await write(path.join(directory, 'manifest.json'), `${JSON.stringify({ assets }, null, 2)}\n`, library === 'private' ? 0o600 : 0o644);
    }
    const directory = await ensureDirectory(destinationRoot, path.posix.dirname(relative), directories);
    await write(path.join(directory, path.posix.basename(relative)), source, library === 'private' ? 0o600 : 0o644);
    if (library === 'private') {
      const placeholder = handoutSource({ ...metadata, title: `Private handout ${section.nextCode}`, sources: [{ type: 'local', title: 'Private binder slot', provider: 'Private library', location: 'Authorized private checkout', receivedDate: reviewDate }] }, '## Private binder slot\n\nThis page is reserved for a private handout. Consult the authorized private library.\n');
      const publicDirectory = await ensureDirectory(root, path.posix.dirname(relative), directories);
      await write(path.join(publicDirectory, path.posix.basename(relative)), placeholder, 0o644);
    }
    await reload();
    return { path: relative, code: section.nextCode, library };
  } catch (error) {
    for (const file of files.reverse()) await fs.rm(file, { force: true });
    for (const directory of directories.reverse()) await fs.rmdir(directory).catch(() => {});
    if (error.code === 'EEXIST') fail('A file or asset directory already uses this destination. Refresh the library and try again.', 409);
    throw error;
  }
}
