import fs from 'node:fs/promises';
import path from 'node:path';

export const LOCAL_CONFIG = '.binder-local.json';

export async function resolvePrivateDirectory(root, configured = process.env.BINDER_PRIVATE_DIR) {
  if (configured) return configured;
  let config;
  try {
    config = JSON.parse(await fs.readFile(path.join(root, LOCAL_CONFIG), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw Error(`${LOCAL_CONFIG}: cannot read local setup (${error.message})`);
  }
  if (typeof config?.privateDirectory !== 'string' || !config.privateDirectory.trim()) {
    throw Error(`${LOCAL_CONFIG}: privateDirectory must be a nonempty path`);
  }
  return config.privateDirectory;
}

export async function linkPrivateCheckout(root, { configured = process.env.BINDER_PRIVATE_DIR } = {}) {
  // Explicit user settings and existing local links always win.
  if (configured) return 'BINDER_PRIVATE_DIR is configured; keeping your setting.';
  const configPath = path.join(root, LOCAL_CONFIG);
  try {
    await fs.lstat(configPath);
    return 'Private library setup already exists; keeping your local link.';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const candidate = path.resolve(root, '..', 'Emergency-Preparedness-Private');
  let privateDirectory;
  try {
    if (!(await fs.stat(path.join(candidate, 'handouts'))).isDirectory()) {
      return 'No sibling private library found; public placeholders remain available.';
    }
    privateDirectory = await fs.realpath(candidate);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return 'No sibling private library found; public placeholders remain available.';
    }
    throw error;
  }
  const publicRoot = await fs.realpath(root);
  if (privateDirectory === publicRoot || privateDirectory.startsWith(publicRoot + path.sep)) {
    throw Error('Private library must be outside the public checkout');
  }
  await fs.writeFile(configPath, JSON.stringify({ privateDirectory }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return 'Linked sibling private library. Editor and builds will include private pages; use :public commands for placeholders.';
}
