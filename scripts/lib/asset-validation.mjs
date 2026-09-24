import fs from 'node:fs/promises';
import path from 'node:path';

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  for (let offset = 2; offset + 9 < buffer.length;) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}

export function sanitizeSvg(source, label) {
  const unsafe = !/^\s*<svg\b/i.test(source)
    || /<!DOCTYPE|<!ENTITY/i.test(source)
    || /<\/?(?:script|foreignObject|iframe|object|embed|audio|video)\b/i.test(source)
    || /\son[a-z]+\s*=/i.test(source)
    || /(?:href|src)\s*=\s*["'](?!#)[^"']+/i.test(source)
    || /url\s*\(\s*["']?(?!#)/i.test(source);
  if (unsafe) throw Error(`${label}: SVG contains disallowed active or external content`);
  return source;
}

export function validateAssetEntry(entry, code) {
  for (const field of ['file', 'type', 'creator', 'source', 'license', 'decorative']) {
    if (entry[field] === undefined || entry[field] === '') {
      throw Error(`${code}/${entry.file || '?'}: missing asset metadata '${field}'`);
    }
  }
  if (typeof entry.decorative !== 'boolean') {
    throw Error(`${code}/${entry.file}: decorative must be true or false`);
  }
  if (entry.decorative) {
    if (entry.alt !== '') throw Error(`${code}/${entry.file}: decorative assets must set alt to an empty string`);
  } else if (typeof entry.alt !== 'string' || !entry.alt.trim()) {
    throw Error(`${code}/${entry.file}: non-decorative assets require useful alt text`);
  }
  if (!['photograph', 'illustration', 'diagram'].includes(entry.type)) {
    throw Error(`${code}/${entry.file}: invalid asset type`);
  }
  if (path.basename(entry.file) !== entry.file) {
    throw Error(`${code}: asset file names cannot contain directories`);
  }
  const extension = path.extname(entry.file).toLowerCase();
  if (!['.svg', '.png', '.jpg', '.jpeg'].includes(extension)) {
    throw Error(`${code}/${entry.file}: unsuitable print format; use SVG, PNG, or JPEG`);
  }
  if (entry.type === 'diagram' && extension !== '.svg') {
    throw Error(`${code}/${entry.file}: diagrams must use sanitized SVG`);
  }
}

export async function loadAssetManifests(root) {
  const assetRoot = path.join(root, 'assets/handouts');
  const manifests = new Map();
  let directories;
  try {
    directories = await fs.readdir(assetRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return manifests;
    throw error;
  }

  for (const directory of directories) {
    if (!directory.isDirectory()) {
      throw Error(`assets/handouts may contain only <CODE> directories: ${directory.name}`);
    }
    const code = directory.name;
    const location = path.join(assetRoot, code);
    const manifestFile = path.join(location, 'manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    } catch (error) {
      throw Error(`${path.relative(root, manifestFile)}: missing or invalid manifest (${error.message})`);
    }
    if (!Array.isArray(manifest.assets)) throw Error(`${code}: manifest must contain an assets array`);
    const entries = new Map();
    for (const entry of manifest.assets) {
      validateAssetEntry(entry, code);
      if (entries.has(entry.file)) throw Error(`${code}: asset file names must be unique`);
      const extension = path.extname(entry.file).toLowerCase();
      let bytes;
      try {
        bytes = await fs.readFile(path.join(location, entry.file));
      } catch {
        throw Error(`${code}: manifest asset is missing: ${entry.file}`);
      }
      if (extension === '.svg') {
        sanitizeSvg(bytes.toString('utf8'), `${code}/${entry.file}`);
      } else if (!(extension === '.png' ? pngSize(bytes) : jpegSize(bytes))) {
        throw Error(`${code}/${entry.file}: file contents do not match its supported extension`);
      }
      entries.set(entry.file, entry);
    }
    manifests.set(code, entries);
  }
  return manifests;
}
