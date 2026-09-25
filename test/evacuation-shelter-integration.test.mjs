import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadDocument } from '../scripts/lib/metadata.mjs';

const directory = new URL('../handouts/evacuation-shelter/', import.meta.url);
const catalog = new Map([
  ['EVS-001', ['EVS-001-evacuation-readiness-checklist.md', 'Evacuation Readiness Checklist']],
  ['EVS-002', ['EVS-002-go-bag-checklist.md', 'Go-Bag Checklist']],
  ['EVS-003', ['EVS-003-leave-early.md', 'Leave Early When Evacuation Is Possible']],
  ['EVS-004', ['EVS-004-plan-two-evacuation-routes.md', 'Plan Two Evacuation Routes']],
  ['EVS-005', ['EVS-005-evacuation-transportation.md', 'Evacuation Transportation Plan']],
  ['EVS-006', ['EVS-006-children-pets-livestock.md', 'Evacuating Children and Animals']],
  ['EVS-007', ['EVS-007-shelter-in-place-basics.md', 'Shelter-in-Place Basics']],
  ['EVS-008', ['EVS-008-cleaner-air-room.md', 'Set Up a Cleaner-Air Room for Wildfire Smoke']],
  ['EVS-009', ['EVS-009-returning-home.md', 'Returning Home After an Evacuation']],
  ['EVS-010', ['EVS-010-accessible-evacuation-planning.md', 'Accessible Evacuation Planning']]
]);

async function loadCatalog() {
  const files = (await readdir(directory)).filter(name => /^EVS-\d{3}.*\.md$/.test(name)).sort();
  return Promise.all(files.map(async filename => {
    const raw = await readFile(new URL(filename, directory), 'utf8');
    return { filename, raw, ...loadDocument(raw, path.join('handouts/evacuation-shelter', filename)) };
  }));
}

test('EVS-001 through EVS-010 have one canonical file, title, section, and source block', async () => {
  const documents = await loadCatalog();
  assert.equal(documents.length, catalog.size);
  assert.deepEqual([...new Set(documents.map(document => document.data.code))].sort(), [...catalog.keys()]);

  for (const document of documents) {
    const expected = catalog.get(document.data.code);
    assert.ok(expected, `unexpected evacuation handout ${document.data.code}`);
    assert.equal(document.filename, expected[0], `${document.data.code} filename`);
    assert.equal(document.data.title, expected[1], `${document.data.code} title`);
    assert.equal(document.data.section, 'Evacuation & Shelter');
    assert.equal(document.data.sectionNumber, 3);
    assert.ok(document.data.sources.length > 0, `${document.data.code} structured sources`);
    assert.equal((document.content.match(/class="sources"/g) ?? []).length, 1, `${document.data.code} visible sources block`);
  }
});

test('every EVS cross-reference names an existing handout', async () => {
  for (const document of await loadCatalog()) {
    const references = document.content.match(/\bEVS-\d{3}\b/g) ?? [];
    for (const reference of references) {
      assert.ok(catalog.has(reference), `${document.data.code} references missing ${reference}`);
    }
  }
});

test('draft local-information blocks retain a visible verification label', async () => {
  for (const document of await loadCatalog()) {
    if (document.data.status === 'approved' || !document.content.includes('class="local-info"')) continue;
    assert.match(document.content, /VERIFY|UNVERIFIED/i, `${document.data.code} local details must remain marked`);
  }
});
