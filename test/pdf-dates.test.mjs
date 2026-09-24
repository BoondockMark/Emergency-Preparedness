import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePdfDates } from '../scripts/lib/pdf-validation.mjs';

test('Chrome PDF timestamps normalize without moving byte offsets', () => {
  const render = date => Buffer.from(
    `%PDF-1.4\n1 0 obj\n<</CreationDate (D:${date}+00'00')\n/ModDate (D:${date}+00'00')>>\nendobj\n`,
    'latin1'
  );
  const first = render('20260924221001');
  const second = render('20260924224559');
  const normalized = normalizePdfDates(first);
  assert.equal(normalized.length, first.length);
  assert.deepEqual(normalized, normalizePdfDates(second));
  assert.match(normalized.toString('latin1'), /CreationDate \(D:20000101000000\+00'00'\)/);
  assert.throws(() => normalizePdfDates(Buffer.from('%PDF-1.4')), /exactly one CreationDate/);
});
