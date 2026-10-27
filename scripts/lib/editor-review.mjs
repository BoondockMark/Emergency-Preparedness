import { parseMetadataYaml } from './metadata.mjs';

// Read incomplete saved drafts too; one broken file must not hide the queue.
export function reviewMetadata(source, record) {
  const fallback = { path: record.sourcePath, code: record.meta.code, title: record.meta.title, section: record.meta.section, status: record.meta.status, private: Boolean(record.contentRoot) };
  try {
    const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!header) throw Error('Missing front matter delimiters.');
    const meta = parseMetadataYaml(header[1], record.sourcePath);
    const text = value => typeof value === 'string' ? value : '';
    return { ...fallback, code: text(meta.code) || fallback.code, title: text(meta.title) || fallback.title,
      section: text(meta.section) || fallback.section, status: text(meta.status), lastReviewed: text(meta.lastReviewed),
      reviewers: { editor: text(meta.reviewers?.editor), subjectMatter: text(meta.reviewers?.subjectMatter) },
      placeholder: !fallback.private && meta.private === true };
  } catch (error) { return { ...fallback, metadataError: error.message, reviewers: {}, lastReviewed: '' }; }
}
