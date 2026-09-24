import fs from 'node:fs/promises';
import path from 'node:path';

export function imageReferences(html, label) {
  return [...html.matchAll(/<img\b([^>]*)>/gi)].map(match => {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)]
        .map(([, key, , value]) => [key.toLowerCase(), value])
    );
    if (!('src' in attributes)) throw Error(`${label}: image is missing src`);
    if ('srcset' in attributes) {
      throw Error(`${label}: srcset is not supported; use one validated local print asset`);
    }
    if (!('alt' in attributes)) {
      throw Error(`${label}: image ${attributes.src} must have alt (use alt="" only for a manifest-declared decorative image)`);
    }
    return attributes;
  });
}

export function safeAssetPath(source, label) {
  if (/^(?:[a-z]+:|\/|\\|[a-z]:[\\/])/i.test(source)) {
    throw Error(`${label}: image paths must be repository-relative, not absolute or remote: ${source}`);
  }
  const match = source.match(/^\.\.\/assets\/handouts\/([^/]+)\/([^?#]+)$/);
  if (!match || match[2].includes('..')) {
    throw Error(`${label}: images must use ../assets/handouts/<CODE>/<file>: ${source}`);
  }
  return { code: match[1], file: match[2] };
}

export function validateImages(html, label, manifests) {
  for (const attributes of imageReferences(html, label)) {
    const reference = safeAssetPath(attributes.src, label);
    if (reference.code !== label) {
      throw Error(`${label}: image assets must be stored in their own code directory, not ${reference.code}`);
    }
    const entry = manifests.get(reference.code)?.get(reference.file);
    if (!entry) throw Error(`${label}: ${reference.file} is not declared in its asset manifest`);
    if (attributes.alt !== entry.alt) {
      throw Error(`${label}/${reference.file}: HTML alt text must exactly match manifest alt text`);
    }
  }
}

export async function validateLocalLinks(html, htmlFile, label) {
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|#|mailto:|data:)/.test(match[1])) continue;
    try {
      await fs.access(path.resolve(path.dirname(htmlFile), match[1]));
    } catch {
      throw Error(`${label}: broken local link ${match[1]}`);
    }
  }
}
