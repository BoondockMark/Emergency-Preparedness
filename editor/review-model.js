export function localReviewDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function reviewDueDate(value, months = 12) {
  if (!validDate(value) || ![3, 6, 12, 24].includes(months)) return '';
  const [, month, day] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(1); date.setUTCMonth(month - 1 + months);
  const last = new Date(date); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return date.toISOString().slice(0, 10);
}
export function reviewFlags(row, today, months = 12) {
  const missing = row.metadataError || row.readError ? [] : ['editor', 'subjectMatter'].filter(role => !row.reviewers?.[role]?.trim() || row.reviewers[role].trim().toLowerCase() === 'unassigned');
  const sameReviewers = !missing.length && typeof row.reviewers?.editor === 'string' && typeof row.reviewers?.subjectMatter === 'string' && row.reviewers.editor.trim().toLowerCase() === row.reviewers.subjectMatter.trim().toLowerCase();
  const due = reviewDueDate(row.lastReviewed, months);
  const dateProblem = row.metadataError || row.readError ? 'Fix the saved-file error to read its review date' : !due ? 'Missing or invalid review date' : row.lastReviewed > today ? 'Review date is in the future' : '';
  const overdue = Boolean(due && validDate(today) && due <= today && !dateProblem);
  const errors = row.validation?.formatting === 'error' || Boolean(row.metadataError);
  const unchecked = !['valid', 'error'].includes(row.validation?.formatting);
  const other = Boolean(row.metadataError || row.readError || dateProblem || sameReviewers);
  return { missing, sameReviewers, due, dateProblem, overdue, errors, unchecked, other, attention: Boolean(missing.length || overdue || errors || unchecked || other || row.status !== 'approved') };
}
export function filterReviewRows(rows, { query = '', filter = 'attention', status = '', library = '', section = '', today, months = 12 } = {}) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.map(row => ({ ...row, flags: reviewFlags(row, today, months) })).filter(row => {
    const flags = row.flags;
    return terms.every(term => `${row.code} ${row.title} ${row.section} ${row.reviewers?.editor || ''} ${row.reviewers?.subjectMatter || ''}`.toLocaleLowerCase().includes(term))
      && (!status || row.status === status) && (!library || (library === 'private') === row.private) && (!section || row.section === section)
      && (filter === 'all' || filter === 'attention' && flags.attention || filter === 'errors' && flags.errors || filter === 'reviewers' && (flags.missing.length || flags.sameReviewers) || filter === 'due' && flags.overdue || filter === 'unchecked' && flags.unchecked);
  }).sort((a, b) => Number(b.flags.errors) - Number(a.flags.errors) || Number(b.flags.other) - Number(a.flags.other) || Number(b.flags.overdue) - Number(a.flags.overdue) || (a.flags.due || '9999').localeCompare(b.flags.due || '9999') || a.code.localeCompare(b.code));
}
