const SECTIONS = ['Start Here', 'Alerts & Communication', 'Evacuation & Shelter', 'Water, Food & Cooking', 'Home & Utilities', 'Hands-On Skills', 'Hazard Guides', 'Plans & Records'];
const SECTION_CODES = ['STH', 'COM', 'EVS', 'WFC', 'HUT', 'SKL', 'HZD', 'PRP'];
const STATUSES = ['draft', 'under-review', 'approved'];
const SOURCE_TYPES = ['web', 'non-web', 'interview', 'local'];
const REQUIRED = ['code', 'title', 'section', 'sectionNumber', 'status', 'version', 'lastReviewed', 'reviewers', 'sources'];
const MARKER = /PLACEHOLDER|\[VERIFY(?:[^\]]*)?\]|SAMPLE[ -]TEXT|REQUIRES? VERIFICATION|NOT APPROVED ADVICE/i;

// These values protect the fixed/repeated page furniture, not YAML storage. The
// title allowance reserves room for the rendered " — continued" suffix in the
// compact heading; the other allowances fit the edge label, status, and footer
// columns. Browser geometry validation remains the final, font-aware defense.
export const METADATA_LENGTH_LIMITS = Object.freeze({
  code: 7,
  title: 72,
  section: 22,
  status: 12,
  version: 9,
  lastReviewed: 10
});

const RENDERED_TEXT_FIELDS = ['code', 'title', 'section', 'status', 'version', 'lastReviewed'];

export class MetadataError extends Error {}

function fail(sourcePath, field, message) {
  throw new MetadataError(`${sourcePath}: ${field}: ${message}`);
}

function scalar(value, sourcePath, lineNumber) {
  const text = value.trim();
  if (!text) return null;
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  if (/^\d+$/.test(text)) return Number(text);
  if (/^(true|false)$/.test(text)) return text === 'true';
  if (/^(null|~)$/.test(text)) return null;
  if (/^[\[{]/.test(text)) fail(sourcePath, `line ${lineNumber}`, 'flow-style YAML is not supported');
  return text;
}

// This intentionally implements only the block-style YAML subset used by handout metadata.
// Rejecting aliases, tags, flow collections, and multi-line scalars keeps loading deterministic.
function parseMetadataYaml(source, sourcePath) {
  const lines = source.split('\n').map((raw, index) => {
    if (/\t/.test(raw)) fail(sourcePath, `line ${index + 1}`, 'tabs are not allowed in metadata');
    const match = raw.match(/^( *)(.*)$/);
    return { indent: match[1].length, text: match[2], number: index + 1 };
  }).filter(line => line.text.trim() && !line.text.trimStart().startsWith('#'));
  let position = 0;

  function parseBlock(indent) {
    const sequence = lines[position]?.indent === indent && lines[position].text.startsWith('- ');
    const output = sequence ? [] : {};
    while (position < lines.length && lines[position].indent === indent) {
      const line = lines[position];
      if (sequence) {
        if (!line.text.startsWith('- ')) fail(sourcePath, `line ${line.number}`, 'cannot mix list and mapping entries');
        const item = line.text.slice(2).trim();
        position++;
        const pair = item.match(/^([A-Za-z][A-Za-z0-9]*):(?:\s+(.*))?$/);
        if (pair) {
          const record = {};
          record[pair[1]] = pair[2] === undefined ? parseChild(indent + 2, line) : scalar(pair[2], sourcePath, line.number);
          if (position < lines.length && lines[position].indent === indent + 2) Object.assign(record, parseBlock(indent + 2));
          output.push(record);
        } else output.push(scalar(item, sourcePath, line.number));
      } else {
        const pair = line.text.match(/^([A-Za-z][A-Za-z0-9]*):(?:\s+(.*))?$/);
        if (!pair) fail(sourcePath, `line ${line.number}`, 'expected a metadata field');
        position++;
        if (Object.hasOwn(output, pair[1])) fail(sourcePath, pair[1], 'duplicate field');
        output[pair[1]] = pair[2] === undefined ? parseChild(indent + 2, line) : scalar(pair[2], sourcePath, line.number);
      }
    }
    return output;
  }
  function parseChild(indent, parent) {
    if (position >= lines.length || lines[position].indent < indent) return null;
    if (lines[position].indent !== indent) fail(sourcePath, `line ${lines[position].number}`, `expected ${indent} spaces of indentation after line ${parent.number}`);
    return parseBlock(indent);
  }
  const result = parseBlock(0);
  if (position !== lines.length) fail(sourcePath, `line ${lines[position].number}`, 'invalid indentation');
  return result;
}

function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function requireText(value, sourcePath, field) {
  if (typeof value !== 'string' || !value.trim()) fail(sourcePath, field, 'is required');
}

function normalizeAndValidateFurniture(meta, sourcePath) {
  for (const field of RENDERED_TEXT_FIELDS) {
    if (typeof meta[field] === 'string') meta[field] = meta[field].trim();
  }
  for (const [field, maximum] of Object.entries(METADATA_LENGTH_LIMITS)) {
    const actual = [...String(meta[field])].length;
    if (actual > maximum) fail(sourcePath, field, `length ${actual} exceeds allowed maximum ${maximum} Unicode code points`);
  }
}

export function validateMetadata(meta, body, sourcePath) {
  for (const field of REQUIRED) if (meta[field] === undefined || meta[field] === null || meta[field] === '') fail(sourcePath, field, 'is required');
  normalizeAndValidateFurniture(meta, sourcePath);
  requireText(meta.title, sourcePath, 'title');
  if (!/^[A-Z]{3}-\d{3}$/.test(meta.code)) fail(sourcePath, 'code', 'must match ABC-001');
  if (!/^\d+\.\d+$/.test(String(meta.version))) fail(sourcePath, 'version', 'must match MAJOR.MINOR');
  if (!isoDate(meta.lastReviewed)) fail(sourcePath, 'lastReviewed', 'must be a valid ISO calendar date (YYYY-MM-DD)');
  if (!SECTIONS.includes(meta.section)) fail(sourcePath, 'section', 'is not a recognized binder section');
  if (meta.sectionNumber !== SECTIONS.indexOf(meta.section) + 1) fail(sourcePath, 'sectionNumber', 'does not match section');
  const expectedCode = SECTION_CODES[meta.sectionNumber - 1];
  if (!meta.code.startsWith(`${expectedCode}-`)) fail(sourcePath, 'code', `must use the ${expectedCode} prefix for ${meta.section}`);
  if (!STATUSES.includes(meta.status)) fail(sourcePath, 'status', `must be one of ${STATUSES.join(', ')}`);
  if (meta.pageCount !== undefined && (!Number.isInteger(meta.pageCount) || meta.pageCount < 1)) {
    fail(sourcePath, 'pageCount', 'must be a positive integer when declared');
  }
  if (!meta.reviewers || typeof meta.reviewers !== 'object' || Array.isArray(meta.reviewers)) fail(sourcePath, 'reviewers', 'must record editor and subjectMatter roles');
  for (const role of ['editor', 'subjectMatter']) requireText(meta.reviewers?.[role], sourcePath, `reviewers.${role}`);
  if (!Array.isArray(meta.sources) || !meta.sources.length) fail(sourcePath, 'sources', 'must contain at least one structured source');
  meta.sources.forEach((entry, index) => {
    const field = `sources[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(sourcePath, field, 'must be a structured source record');
    if (!SOURCE_TYPES.includes(entry.type)) fail(sourcePath, `${field}.type`, `must be one of ${SOURCE_TYPES.join(', ')}`);
    requireText(entry.title, sourcePath, `${field}.title`);
    if (entry.publicationDate !== undefined && !isoDate(entry.publicationDate)) fail(sourcePath, `${field}.publicationDate`, 'must be a valid ISO calendar date');
    if (entry.updateDate !== undefined && !isoDate(entry.updateDate)) fail(sourcePath, `${field}.updateDate`, 'must be a valid ISO calendar date');
    if (entry.accessDate !== undefined && !isoDate(entry.accessDate)) fail(sourcePath, `${field}.accessDate`, 'must be a valid ISO calendar date');
  });
  if (meta.status === 'approved') {
    for (const role of ['editor', 'subjectMatter']) if (meta.reviewers[role].trim().toLowerCase() === 'unassigned') fail(sourcePath, `reviewers.${role}`, 'cannot be unassigned when approved');
    if (meta.reviewers.editor.trim().toLowerCase() === meta.reviewers.subjectMatter.trim().toLowerCase()) fail(sourcePath, 'reviewers', 'editor and subjectMatter must name different reviewers');
    meta.sources.forEach((entry, index) => {
      const field = `sources[${index}]`;
      for (const [name, value] of Object.entries(entry)) if (typeof value === 'string' && MARKER.test(value)) fail(sourcePath, `${field}.${name}`, 'contains an unresolved marker');
      if (entry.type === 'web') {
        requireText(entry.organization, sourcePath, `${field}.organization`);
        requireText(entry.url, sourcePath, `${field}.url`);
        try { if (!/^https?:$/.test(new URL(entry.url).protocol)) throw new Error(); } catch { fail(sourcePath, `${field}.url`, 'must be an absolute HTTP(S) URL'); }
        if (!isoDate(entry.accessDate)) fail(sourcePath, `${field}.accessDate`, 'is required as a valid ISO calendar date');
      } else if (entry.type === 'non-web') {
        requireText(entry.organization, sourcePath, `${field}.organization`);
        requireText(entry.citation, sourcePath, `${field}.citation`);
      } else if (entry.type === 'interview') {
        requireText(entry.interviewee, sourcePath, `${field}.interviewee`);
        requireText(entry.role, sourcePath, `${field}.role`);
        if (!isoDate(entry.interviewDate)) fail(sourcePath, `${field}.interviewDate`, 'is required as a valid ISO calendar date');
      } else {
        requireText(entry.provider, sourcePath, `${field}.provider`);
        requireText(entry.location, sourcePath, `${field}.location`);
        if (!isoDate(entry.receivedDate)) fail(sourcePath, `${field}.receivedDate`, 'is required as a valid ISO calendar date');
      }
    });
    if (MARKER.test(body)) fail(sourcePath, 'body', 'contains sample text or an unresolved verification marker');
  }
  return meta;
}

export function loadDocument(raw, sourcePath) {
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) fail(sourcePath, 'frontMatter', 'missing opening or closing --- delimiter');
  const metadata = parseMetadataYaml(match[1], sourcePath);
  validateMetadata(metadata, match[2], sourcePath);
  const contentStartLine = `---\n${match[1]}\n---\n`.split('\n').length;
  return { data: metadata, content: match[2], contentStartLine };
}

export { SECTIONS, SECTION_CODES };
