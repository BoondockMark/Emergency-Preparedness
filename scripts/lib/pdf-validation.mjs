// A small structural PDF parser for the catalog/page-tree objects emitted by Chrome.
// Unlike the old `/Type /Page` byte search, this follows the trailer's Root reference
// and reads the authoritative Count from the PDF page tree.
function objectBody(source, reference) {
  const [number, generation] = reference;
  const marker = new RegExp(`(?:^|\\r?\\n)${number}\\s+${generation}\\s+obj\\b`);
  const match = marker.exec(source);
  if (!match) throw new Error(`PDF object ${number} ${generation} not found`);
  const start = match.index + match[0].length;
  const end = source.indexOf('endobj', start);
  if (end < 0) throw new Error(`PDF object ${number} ${generation} is unterminated`);
  return source.slice(start, end);
}

function reference(dictionary, key) {
  const match = dictionary.match(new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R\\b`));
  if (!match) throw new Error(`PDF dictionary has no ${key} reference`);
  return [Number(match[1]), Number(match[2])];
}

// Chrome stamps each PDF with the render time. Replace only those fixed-width
// metadata values so byte offsets in the xref table remain valid.
export function normalizePdfDates(bytes) {
  const source = Buffer.from(bytes).toString('latin1');
  const fixed = "D:20000101000000+00'00'";
  let result = source;
  for (const field of ['CreationDate', 'ModDate']) {
    const pattern = new RegExp(`(\\/${field} \\(D:)\\d{14}[+-]\\d{2}'\\d{2}'(\\))`, 'g');
    const matches = [...result.matchAll(pattern)];
    if (matches.length !== 1) throw Error(`PDF must contain exactly one ${field} metadata value`);
    result = result.replace(pattern, (_, prefix, suffix) => `${prefix}${fixed.slice(2)}${suffix}`);
  }
  if (result.length !== source.length) throw Error('PDF date normalization changed byte offsets');
  return Buffer.from(result, 'latin1');
}

export async function getPdfPageCount(bytes) {
  const source = Buffer.from(bytes).toString('latin1');
  const trailerPosition = source.lastIndexOf('trailer');
  if (trailerPosition < 0) throw new Error('PDF trailer not found');
  const root = reference(source.slice(trailerPosition), 'Root');
  const catalog = objectBody(source, root);
  const pages = objectBody(source, reference(catalog, 'Pages'));
  const count = pages.match(/\/Count\s+(\d+)\b/);
  if (!count) throw new Error('PDF page-tree root has no Count');
  return Number(count[1]);
}

export function inspectEmbeddedFonts(bytes) {
  const source = Buffer.from(bytes).toString('latin1');
  const fontNames = [...source.matchAll(/\/BaseFont\s*\/([^\s/<>{}\[\]()]+)/g)].map(match => match[1]);
  const embeddedPrograms = (source.match(/\/FontFile(?:2|3)?\b/g) || []).length;
  return { fontNames: [...new Set(fontNames)], embeddedPrograms };
}
