/**
 * @file packages/engine/src/studio-labels.js
 * Honest labels for GitHub-backed Studio sessions and inbox rows.
 */

const SAMPLE_FIXTURE_TITLES = new Set([
  'Fix intermittent timeout in test suite',
  'Fix security regression in auth',
]);

function stripGithubTitlePrefix(title) {
  return String(title || '')
    .replace(/^Sample(?:\s+#\d+)?\s+·\s+/i, '')
    .replace(/^GitHub Issue #\d+:\s+/i, '')
    .trim();
}

function hasGithubHtmlUrl(item = {}) {
  const url = String(item.url || item.html_url || '').trim();
  return /^https:\/\/github\.com\//i.test(url);
}

function isSampleGithubWork(item = {}) {
  if (item.sample === true || (item.metadata && item.metadata.sample === true)) return true;
  if (hasGithubHtmlUrl(item)) return false;
  const source = String(item.source || item.metadata && item.metadata.source || '');
  if (source === 'github-issue' || source === 'github-pr' || source === 'github-webhook') return true;
  const bareTitle = stripGithubTitlePrefix(item.title);
  return SAMPLE_FIXTURE_TITLES.has(bareTitle);
}

function formatGithubSessionTitle({ issueNumber, issueTitle, sample } = {}) {
  const title = String(issueTitle || 'Untitled issue').trim() || 'Untitled issue';
  const hasNumber = issueNumber !== null && issueNumber !== undefined && issueNumber !== '';
  const num = hasNumber ? `#${issueNumber}` : '';
  if (sample) {
    return num ? `Sample ${num} · ${title}` : `Sample · ${title}`;
  }
  return num ? `GitHub Issue ${num}: ${title}` : `GitHub issue: ${title}`;
}

function parseGithubIssueNumber(item = {}) {
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

function formatStudioWorkLabel(item = {}) {
  const rawTitle = String(item.title || '').trim();
  if (!isSampleGithubWork(item)) return rawTitle;
  const title = stripGithubTitlePrefix(rawTitle) || 'Untitled issue';
  const sourceId = parseGithubIssueNumber(item);
  if (sourceId === '') return `Sample · ${title}`;
  return `Sample #${sourceId} · ${title}`;
}

module.exports = {
  SAMPLE_FIXTURE_TITLES,
  stripGithubTitlePrefix,
  hasGithubHtmlUrl,
  isSampleGithubWork,
  formatGithubSessionTitle,
  formatStudioWorkLabel,
};
