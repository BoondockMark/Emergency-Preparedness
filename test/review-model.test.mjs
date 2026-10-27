import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDueDate, reviewFlags, filterReviewRows } from '../editor/review-model.js';
import { reviewMetadata } from '../scripts/lib/editor-review.mjs';

const row = { code: 'STH-001', title: 'Example', section: 'Start Here', status: 'approved', private: false, reviewers: { editor: 'Alex', subjectMatter: 'Blair' }, lastReviewed: '2024-02-29', validation: { formatting: 'valid' } };

test('review reminders use calendar months, clamp leap/month ends, and are due on the reference day', () => {
  assert.equal(reviewDueDate('2024-02-29'), '2025-02-28');
  assert.equal(reviewDueDate('2025-08-31', 6), '2026-02-28');
  assert.equal(reviewDueDate('2025-11-30', 3), '2026-02-28');
  assert.equal(reviewDueDate('2024-02-29', 24), '2026-02-28');
  assert.equal(reviewDueDate('2025-02-30'), ''); assert.equal(reviewDueDate('', 12), '');
  assert.equal(reviewFlags(row, '2025-02-27').overdue, false);
  assert.equal(reviewFlags(row, '2025-02-28').overdue, true);
  assert.equal(reviewFlags(row, '2023-01-01').dateProblem, 'Review date is in the future');
});

test('review queue separates missing reviewers, duplicate roles, invalid metadata and unchecked results from approval', () => {
  const flags = reviewFlags({ ...row, reviewers: { editor: ' Unassigned ', subjectMatter: '' }, validation: { formatting: 'unchecked' } }, '2024-03-01');
  assert.deepEqual(flags.missing, ['editor', 'subjectMatter']); assert.equal(flags.unchecked, true); assert.equal(flags.attention, true);
  assert.equal(reviewFlags({ ...row, reviewers: { editor: 'Alex', subjectMatter: ' ALEX ' } }, '2024-03-01').sameReviewers, true);
  const broken = reviewFlags({ ...row, metadataError: 'Invalid YAML', reviewers: {} }, '2024-03-01');
  assert.equal(broken.errors, true); assert.deepEqual(broken.missing, []);
  assert.equal(reviewFlags({ ...row, status: 'draft' }, '2024-03-01').attention, true);
  assert.equal(reviewFlags(row, '2024-03-01').attention, false);
});

test('review filters combine search, library, status and section with actionable sorting', () => {
  const rows = [row, { ...row, code: 'STH-002', title: 'Private route', status: 'draft', private: true, validation: { formatting: 'error' } }];
  assert.equal(filterReviewRows(rows, { today: '2024-03-01', filter: 'all' })[0].code, 'STH-002');
  assert.equal(filterReviewRows(rows, { today: '2024-03-01', filter: 'all', query: 'route Alex', library: 'private', status: 'draft', section: 'Start Here' }).length, 1);
  assert.equal(filterReviewRows(rows, { today: '2024-03-01', filter: 'all', library: 'public' }).length, 1);
  assert.equal(filterReviewRows(rows, { today: '2024-03-01', filter: 'due' }).length, 0);
});

test('review metadata reads saved drafts without treating malformed YAML as missing reviewer assignments', () => {
  const record = { sourcePath: 'handouts/example.md', meta: row };
  const result = reviewMetadata('---\ntitle: Updated\nstatus: draft\nlastReviewed: 2020-01-01\nreviewers:\n  editor: Unassigned\n  subjectMatter: Blair\n---\nBody', record);
  assert.equal(result.title, 'Updated'); assert.equal(result.reviewers.editor, 'Unassigned'); assert.equal('source' in result, false);
  assert.match(reviewMetadata('Not YAML', record).metadataError, /delimiters/);
});
