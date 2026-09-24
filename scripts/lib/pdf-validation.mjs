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
