import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeSvg, validateAssetEntry } from './asset-validation.mjs';

const IMAGE_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/svg+xml', '.svg']
]);

export const sourceVersion = source => createHash('sha256').update(source).digest('hex');

export function safeHandoutPath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.endsWith('.md')) throw Error('A Markdown handout path is required');
  const handouts = path.resolve(root, 'handouts');
  const resolved = path.resolve(root, relativePath);
  if (resolved === handouts || !resolved.startsWith(`${handouts}${path.sep}`)) throw Error('Handout path must remain inside handouts/');
  return resolved;
}

export function safeAssetName(name, mimeType) {
  const extension = IMAGE_TYPES.get(mimeType);
  if (!extension) throw Error('Images must be PNG, JPEG, or SVG');
  const base = path.basename(name);
  const originalExtension = path.extname(base);
  const suppliedExtension = originalExtension.toLowerCase();
  let stem = path.basename(base, originalExtension)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (!stem) stem = 'image';
  const normalizedExtension = mimeType === 'image/jpeg' && suppliedExtension === '.jpeg' ? '.jpeg' : extension;
  return `${stem}${normalizedExtension}`;
}

export function decodeImage(dataUrl, mimeType, label) {
  const prefix = `data:${mimeType};base64,`;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) throw Error(`${label}: invalid image data`);
  const bytes = Buffer.from(dataUrl.slice(prefix.length), 'base64');
  if (!bytes.length) throw Error(`${label}: image is empty`);
  if (mimeType === 'image/svg+xml') sanitizeSvg(bytes.toString('utf8'), label);
  if (mimeType === 'image/png' && (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a')) throw Error(`${label}: file contents are not PNG`);
  if (mimeType === 'image/jpeg' && (bytes[0] !== 0xff || bytes[1] !== 0xd8)) throw Error(`${label}: file contents are not JPEG`);
  return bytes;
}

export async function readManifest(root, code) {
  const directory = path.join(root, 'assets', 'handouts', code);
  const file = path.join(directory, 'manifest.json');
  try {
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(manifest.assets)) throw Error('manifest must contain an assets array');
    return { directory, file, manifest };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { directory, file, manifest: { assets: [] } };
  }
}

export async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

export async function addAsset(root, code, request) {
  const { directory, file: manifestFile, manifest } = await readManifest(root, code);
  const file = safeAssetName(request.name, request.mimeType);
  if (manifest.assets.some(asset => asset.file === file)) throw Error(`${file} already exists`);
  const entry = {
    file,
    type: request.type,
    creator: request.creator?.trim(),
    source: request.source?.trim(),
    license: request.license?.trim(),
    alt: request.decorative ? '' : request.alt?.trim(),
    ...(request.caption?.trim() ? { caption: request.caption.trim() } : {}),
    decorative: Boolean(request.decorative)
  };
  validateAssetEntry(entry, code);
  const bytes = decodeImage(request.dataUrl, request.mimeType, `${code}/${file}`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, file), bytes, { flag: 'wx' });
  try {
    manifest.assets.push(entry);
    await writeJsonAtomic(manifestFile, manifest);
  } catch (error) {
    await fs.rm(path.join(directory, file), { force: true });
    throw error;
  }
  return entry;
}

export async function deleteAsset(root, code, file, handoutSource) {
  if (path.basename(file) !== file) throw Error('Invalid asset file name');
  const reference = `../assets/handouts/${code}/${file}`;
  if (handoutSource.includes(reference)) throw Error('Remove the image from the handout and save before deleting its asset');
  const record = await readManifest(root, code);
  const index = record.manifest.assets.findIndex(asset => asset.file === file);
  if (index < 0) throw Error(`${file} is not in the asset manifest`);
  record.manifest.assets.splice(index, 1);
  await writeJsonAtomic(record.file, record.manifest);
  await fs.rm(path.join(record.directory, file), { force: true });
}

export function figureMarkup(code, asset, options = {}) {
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const width = options.width === 'half' ? 'figure--half' : 'figure--full';
  const align = width === 'figure--half' && ['left', 'right'].includes(options.align) ? ` figure--${options.align}` : '';
  const crop = ['3x2', '4x3', 'square'].includes(options.crop) ? ` figure--crop-${options.crop}` : options.crop === 'contain' ? ' figure--contain' : '';
  const position = /^\d{1,3}% \d{1,3}%$/.test(options.position || '') ? ` style="--crop-position: ${options.position}"` : '';
  const captionId = `${code.toLowerCase()}-${asset.file.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-]/g, '-')}-caption`;
  const labelled = asset.caption ? ` aria-labelledby="${captionId}"` : '';
  const caption = asset.caption ? `\n  <figcaption id="${captionId}">${escape(asset.caption)}</figcaption>` : '';
  return `<figure class="figure ${width}${align}${crop}"${position}${labelled}>\n  <img src="../assets/handouts/${code}/${asset.file}" alt="${escape(asset.alt)}">${caption}\n</figure>${width === 'figure--half' ? '\n<div class="figure-clear"></div>' : ''}`;
}
