/**
 * Honest GitHub / sample labels for Studio sessions and inbox rows.
 */

const SAMPLE_FIXTURE_TITLES = new Set([
  'Fix intermittent timeout in test suite',
  'Fix security regression in auth',
]);

export function stripGithubTitlePrefix(title) {
  return String(title || '')
    .replace(/^Sample(?:\s+#\d+)?\s+·\s+/i, '')
    .replace(/^GitHub Issue #\d+:\s+/i, '')
    .trim();
}

export function hasGithubHtmlUrl(item = {}) {
  const url = String(item.url || item.html_url || '').trim();
  return /^https:\/\/github\.com\//i.test(url);
}

export function isSampleGithubWork(item = {}) {
  if (item.sample === true || (item.metadata && item.metadata.sample === true)) return true;
  if (hasGithubHtmlUrl(item)) return false;
  const source = String(item.source || (item.metadata && item.metadata.source) || '');
  if (source === 'github-issue' || source === 'github-pr' || source === 'github-webhook') return true;
  return SAMPLE_FIXTURE_TITLES.has(stripGithubTitlePrefix(item.title));
}

export function parseGithubIssueNumber(item = {}) {
  if (item.sourceId !== null && item.sourceId !== undefined && item.sourceId !== '') {
    return item.sourceId;
  }
  if (item.issueNumber !== null && item.issueNumber !== undefined && item.issueNumber !== '') {
    return item.issueNumber;
  }
  const fromMeta = item.metadata && item.metadata.issueNumber;
  if (fromMeta !== null && fromMeta !== undefined && fromMeta !== '') return fromMeta;
  const match = String(item.title || '').match(/#(\d+)/);
  return match ? match[1] : '';
}

export function formatStudioWorkLabel(item = {}) {
  const rawTitle = String(item.title || '').trim();
  if (!isSampleGithubWork(item)) return rawTitle;
  const title = stripGithubTitlePrefix(rawTitle) || 'Untitled issue';
  const sourceId = parseGithubIssueNumber(item);
  if (sourceId === '') return `Sample · ${title}`;
  return `Sample #${sourceId} · ${title}`;
}
