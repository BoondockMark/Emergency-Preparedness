import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectEmbeddedFonts, normalizePdfDates } from '../scripts/lib/pdf-validation.mjs';
import { renderPrintPdf } from '../scripts/lib/artifact-generation.mjs';

test('PDF validation detects system fallback fonts declared only in FontName', async () => {
  const pdf = Buffer.from(`%PDF-1.4
1 0 obj
<</Type /Catalog /Pages 2 0 R>>
endobj
2 0 obj
<</Type /Pages /Count 1>>
endobj
3 0 obj
<</BaseFont /AAAAAA+DejaVuSans /FontFile2 4 0 R>>
endobj
5 0 obj
<</FontName /BAAAAA+NotoSansSymbols2-Regular>>
endobj
6 0 obj
<</CreationDate (D:20261029000000+00'00') /ModDate (D:20261029000000+00'00')>>
endobj
trailer
<</Root 1 0 R>>
`, 'latin1');
  assert.deepEqual(inspectEmbeddedFonts(pdf).fontNames, ['AAAAAA+DejaVuSans', 'BAAAAA+NotoSansSymbols2-Regular']);
  await assert.rejects(renderPrintPdf({ pdf: async () => pdf }, 'TEST', 1), /unbundled fonts.*NotoSansSymbols2/);
  const bundledOnly = Buffer.from(pdf.toString('latin1').replace('BAAAAA+NotoSansSymbols2-Regular', 'AAAAAA+DejaVuSans'));
  await renderPrintPdf({ pdf: async () => bundledOnly }, 'TEST', 1);
});

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
