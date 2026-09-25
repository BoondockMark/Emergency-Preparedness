import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadDocument, METADATA_LENGTH_LIMITS, MetadataError } from '../scripts/lib/metadata.mjs';

const fixture = async name => readFile(new URL(`./metadata-fixtures/${name}`, import.meta.url), 'utf8');

test('loads a valid approved metadata fixture', async () => {
  const document = loadDocument(await fixture('valid-approved.md'), 'test/metadata-fixtures/valid-approved.md');
  assert.equal(document.data.sources[0].type, 'web');
  assert.equal(document.data.reviewers.editor, 'Avery Editor');
});

const invalid = {
  'invalid-reviewer-unassigned.md': 'reviewers.editor',
  'invalid-reviewer-roles.md': 'reviewers',
  'invalid-source-marker.md': 'sources[0].title',
  'invalid-source-incomplete.md': 'sources[0].accessDate',
  'invalid-body-marker.md': 'body',
  'invalid-date.md': 'lastReviewed',
  'invalid-version.md': 'version',
  'invalid-code.md': 'code'
};

for (const [name, field] of Object.entries(invalid)) {
  test(`rejects ${name}`, async () => {
    const sourcePath = `test/metadata-fixtures/${name}`;
    const raw = await fixture(name);
    assert.throws(
      () => loadDocument(raw, sourcePath),
      error => error instanceof MetadataError && error.message.startsWith(`${sourcePath}: ${field}:`)
    );
  });
}

test('accepts title and version values exactly at their furniture limits', async () => {
  const raw = await fixture('valid-approved.md');
  const title = 'T'.repeat(METADATA_LENGTH_LIMITS.title);
  const version = '1234.5678';
  const document = loadDocument(
    raw.replace('title: Fixture', `title: ${title}`).replace('version: 1.0', `version: ${version}`),
    'at-limit.md'
  );
  assert.equal([...document.data.title].length, METADATA_LENGTH_LIMITS.title);
  assert.equal([...document.data.version].length, METADATA_LENGTH_LIMITS.version);
});

test('rejects a title one Unicode code point over its furniture limit', async () => {
  const raw = (await fixture('valid-approved.md')).replace(
    'title: Fixture',
    `title: ${'T'.repeat(METADATA_LENGTH_LIMITS.title + 1)}`
  );
  assert.throws(
    () => loadDocument(raw, 'long-title.md'),
    error => error instanceof MetadataError
      && error.message === `long-title.md: title: length 73 exceeds allowed maximum 72 Unicode code points`
  );
});

test('counts multibyte title characters as Unicode code points and trims furniture fields', async () => {
  const raw = (await fixture('valid-approved.md'))
    .replace('title: Fixture', `title: '  ${'🔥'.repeat(METADATA_LENGTH_LIMITS.title)}  '`)
    .replace('version: 1.0', "version: '  1.0  '");
  const document = loadDocument(raw, 'multibyte-title.md');
  assert.equal(document.data.title, '🔥'.repeat(METADATA_LENGTH_LIMITS.title));
  assert.equal(document.data.version, '1.0');
});

test('rejects an overlong version with its actual and allowed lengths', async () => {
  const raw = (await fixture('valid-approved.md')).replace('version: 1.0', 'version: 12345.6789');
  assert.throws(
    () => loadDocument(raw, 'long-version.md'),
    error => error instanceof MetadataError
      && error.message === 'long-version.md: version: length 10 exceeds allowed maximum 9 Unicode code points'
  );
});
