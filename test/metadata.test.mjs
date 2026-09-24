import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadDocument, MetadataError } from '../scripts/lib/metadata.mjs';

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
