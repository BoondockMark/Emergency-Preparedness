import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { linkPrivateCheckout, resolvePrivateDirectory, LOCAL_CONFIG } from '../scripts/lib/local-setup.mjs';
import { loadBuildContent } from '../scripts/lib/private-content.mjs';

async function setup(t, { sibling = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'binder-local-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'Public project with spaces');
  const privateRoot = path.join(directory, 'Emergency-Preparedness-Private');
  await fs.mkdir(path.join(root, 'handouts'), { recursive: true });
  if (sibling) await fs.mkdir(path.join(privateRoot, 'handouts'), { recursive: true });
  return { root, privateRoot };
}

test('installation links an existing sibling and subsequent processes can resolve it', async t => {
  const { root, privateRoot } = await setup(t);
  assert.match(await linkPrivateCheckout(root, { configured: '' }), /Linked/);
  assert.equal(await resolvePrivateDirectory(root, ''), await fs.realpath(privateRoot));
  const first = await fs.readFile(path.join(root, LOCAL_CONFIG), 'utf8');
  assert.match(await linkPrivateCheckout(root, { configured: '' }), /already exists/);
  assert.equal(await fs.readFile(path.join(root, LOCAL_CONFIG), 'utf8'), first);
  const content = await loadBuildContent(root, { privateDirectory: '', requirePrivate: true });
  assert.equal(content.privateRoot, await fs.realpath(privateRoot));
});

test('installation without private content succeeds without creating a link', async t => {
  const { root } = await setup(t, { sibling: false });
  assert.match(await linkPrivateCheckout(root, { configured: '' }), /No sibling/);
  assert.equal(await resolvePrivateDirectory(root, ''), undefined);
  await assert.rejects(fs.access(path.join(root, LOCAL_CONFIG)), /ENOENT/);
  const content = await loadBuildContent(root, { privateDirectory: '' });
  assert.equal(content.privateRoot, undefined);
});

test('explicit environment setting wins over automatic and saved links', async t => {
  const { root } = await setup(t);
  assert.match(await linkPrivateCheckout(root, { configured: '../custom-private' }), /keeping your setting/);
  await assert.rejects(fs.access(path.join(root, LOCAL_CONFIG)), /ENOENT/);
  await linkPrivateCheckout(root, { configured: '' });
  assert.equal(await resolvePrivateDirectory(root, '../custom-private'), '../custom-private');
});

test('installation preserves existing configuration; malformed config fails clearly only when used', async t => {
  const { root } = await setup(t);
  await fs.writeFile(path.join(root, LOCAL_CONFIG), 'invalid json');
  assert.match(await linkPrivateCheckout(root, { configured: '' }), /keeping your local link/);
  await assert.rejects(resolvePrivateDirectory(root, ''), /cannot read local setup/);
  const content = await loadBuildContent(root, { publicOnly: true });
  assert.equal(content.privateRoot, undefined);
});

test('public override ignores a stale automatic private link', async t => {
  const { root, privateRoot } = await setup(t);
  await linkPrivateCheckout(root, { configured: '' });
  await fs.rm(privateRoot, { recursive: true });
  assert.equal((await loadBuildContent(root, { publicOnly: true })).privateRoot, undefined);
  await assert.rejects(loadBuildContent(root, { privateDirectory: '' }), /ENOENT/);
});
