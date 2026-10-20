import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadBuildContent } from '../scripts/lib/private-content.mjs';
import { generateMoodleIndex } from '../scripts/lib/index-generation.mjs';
import { generateTableOfContentsPages } from '../scripts/lib/binder-generation.mjs';

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'private-content-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'handouts'));
  const source = (await fs.readFile(new URL('./unit-fixtures/front-matter.md', import.meta.url), 'utf8'))
    .replace('pageCount: 1', 'private: true\npageCount: 2')
    .replace('Fixture body.', 'Private page placeholder.\n<!-- pagebreak -->\nPrivate page placeholder.');
  await fs.writeFile(path.join(root, 'handouts/record.md'), source);
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'private-checkout-'));
  t.after(() => fs.rm(privateRoot, { recursive: true, force: true }));
  const addPrivate = async (replacement = source.replaceAll('Private page placeholder.', 'SECRET TEST CONTENT')) => {
    await fs.mkdir(path.join(privateRoot, 'handouts'), { recursive: true });
    await fs.writeFile(path.join(privateRoot, 'handouts/record.md'), replacement);
  };
  return { root, source, privateRoot, addPrivate, options: { privateDirectory: privateRoot } };
}

test('unavailable private checkout produces placeholders; private mode requires it', async t => {
  const { root } = await setup(t);
  const { documents, privateRoot } = await loadBuildContent(root);
  assert.equal(privateRoot, undefined);
  assert.match(documents[0].chunks[0], /placeholder/);
  await assert.rejects(loadBuildContent(root, { requirePrivate: true }), /BINDER_PRIVATE_DIR/);
});

test('authorized checkout replaces slots and keeps table of contents page positions', async t => {
  const { root, addPrivate, options } = await setup(t);
  const before = await loadBuildContent(root);
  await addPrivate();
  const after = await loadBuildContent(root, options);
  assert.match(after.documents[0].chunks[0], /SECRET TEST CONTENT/);
  assert.equal(after.documents[0].meta.private, true);
  assert.equal(generateTableOfContentsPages(before.documents), generateTableOfContentsPages(after.documents));
});

test('public mode never reads even a broken private checkout', async t => {
  const { root, addPrivate, options } = await setup(t);
  await addPrivate('invalid private source');
  const { documents, privateRoot } = await loadBuildContent(root, { ...options, publicOnly: true });
  assert.equal(privateRoot, undefined);
  assert.doesNotMatch(JSON.stringify(documents), /invalid private source/);
  await assert.rejects(loadBuildContent(root, options), /frontMatter/);
});

test('private replacement must preserve code and section; lengths can differ', async t => {
  const { root, source, addPrivate, options } = await setup(t);
  await addPrivate(source.replace('STH-001', 'STH-002'));
  await assert.rejects(loadBuildContent(root, options), /match public code/);
  await addPrivate(source.replace('pageCount: 2', 'pageCount: 1').replace('\n<!-- pagebreak -->\nPrivate page placeholder.', ''));
  assert.equal((await loadBuildContent(root, options)).documents[0].meta.pageCount, 1);
});

test('private source cannot override an ordinary public handout', async t => {
  const { root, source, addPrivate, options } = await setup(t);
  await fs.writeFile(path.join(root, 'handouts/record.md'), source.replace('private: true', 'private: false'));
  await addPrivate();
  await assert.rejects(loadBuildContent(root, options), /matching public placeholder/);
});

test('private documents never enter the Moodle index, including approved documents', () => {
  const result = generateMoodleIndex([{ meta: { private: true, status: 'approved', section: 'Start Here', title: 'Secret title', code: 'STH-001' } }]);
  assert.doesNotMatch(result, /Secret title|STH-001/);
});

test('private checkout inside public sources is refused', async t => {
  const { root } = await setup(t);
  await assert.rejects(loadBuildContent(root, { privateDirectory: root }), /outside the public checkout/);
});

test('escaping private source and asset symlinks are refused', async t => {
  const { root, privateRoot, options, addPrivate } = await setup(t);
  await addPrivate();
  await fs.symlink(path.join(root, 'handouts/record.md'), path.join(privateRoot, 'handouts/escape.md'));
  await assert.rejects(loadBuildContent(root, options), /symlinks/);
});
