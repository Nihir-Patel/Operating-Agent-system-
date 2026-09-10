/**
 * @file packages/engine/src/work-inbox.js
 * Normalize GitHub/Linear work items and summarize HUD queues.
 */

function cloneRecord(value) {
  return JSON.parse(JSON.stringify(value));
}

function isGithubSlug(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value || '').trim());
}

function parseGithubRepo(remoteUrl) {
  const raw = String(remoteUrl || '').trim();
  const match = raw.match(/github\.com[:/]([^/\s]+)\/([^/\s.]+)(?:\.git)?/i);
  if (match) {
    const owner = match[1];
    const name = match[2];
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) return null;
    return `${owner}/${name}`;
  }
  return isGithubSlug(raw) ? raw : null;
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function fetchJson(url, options = {}, fetchImpl) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    const err = new Error('HTTP fetch is not available in this runtime');
    err.statusCode = 503;
    err.code = 'INBOX_UNCONFIGURED';
    throw err;
  }
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal
    });
    const payload = await readJsonResponse(res);
    if (!res.ok) {
      const err = new Error(`Remote inbox request failed (${res.status})`);
      err.statusCode = res.status >= 500 ? 502 : 502;
      err.code = 'INBOX_REMOTE_FAILED';
      throw err;
    }
    return payload;
  } catch (err) {
    if (err.code === 'INBOX_REMOTE_FAILED' || err.code === 'INBOX_UNCONFIGURED') throw err;
    const wrapped = new Error('Remote inbox request failed');
    wrapped.statusCode = 502;
    wrapped.code = 'INBOX_REMOTE_FAILED';
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

async function listGithubIssues({ repo, token, fetchImpl } = {}) {
  const slug = parseGithubRepo(repo);
  const auth = String(token || '').trim();
  if (!slug || !auth) {
    const err = new Error('GitHub import needs GITHUB_TOKEN and an owner/repo slug');
    err.statusCode = 503;
    err.code = 'INBOX_UNCONFIGURED';
    throw err;
  }
  const issues = await fetchJson(
    `https://api.github.com/repos/${slug}/issues?state=open&per_page=50`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${auth}`,
        'User-Agent': 'OAS-Studio',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    },
    fetchImpl
  );
  const list = Array.isArray(issues) ? issues : [];
  return list.map(issue => fromGithubIssue(issue, slug));
}

async function listLinearIssues({ token, fetchImpl } = {}) {
  const auth = String(token || '').trim();
  if (!auth) {
    const err = new Error('Linear import needs LINEAR_API_KEY');
    err.statusCode = 503;
    err.code = 'INBOX_UNCONFIGURED';
    throw err;
  }
  const payload = await fetchJson(
    'https://api.linear.app/graphql',
    {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: '{ issues(first: 30) { nodes { id identifier title url state { name } } } }'
      })
    },
    fetchImpl
  );
  const nodes = payload && payload.data && payload.data.issues && Array.isArray(payload.data.issues.nodes)
    ? payload.data.issues.nodes
    : [];
  return nodes.map(issue => fromLinearIssue(issue));
}

async function createGithubPullRequest({ repo, token, title, body, head, base, fetchImpl } = {}) {
  const slug = parseGithubRepo(repo);
  const auth = String(token || '').trim();
  if (!slug || !auth) {
    const err = new Error('GitHub PR publish is not configured');
    err.statusCode = 503;
    err.code = 'GITHUB_UNCONFIGURED';
    throw err;
  }
  const created = await fetchJson(
    `https://api.github.com/repos/${slug}/pulls`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${auth}`,
        'User-Agent': 'OAS-Studio',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        title: String(title || 'OAS inbox change').slice(0, 256),
        body: String(body || '').slice(0, 65000),
        head: String(head || '').slice(0, 255),
        base: String(base || 'main').slice(0, 255)
      })
    },
    fetchImpl
  );
  return {
    url: created.html_url || created.url || '',
    number: created.number || null,
    title: created.title || title
  };
}

function makeWorkItemId(source, sourceId) {
  const src = String(source || 'manual').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const sid = String(sourceId || Date.now().toString(36)).replace(/[^a-zA-Z0-9._-]/g, '-');
  return `wi_${src}_${sid}`;
}

function normalizeWorkItem(input = {}) {
  const source = String(input.source || 'manual').trim() || 'manual';
  const sourceId = String(input.sourceId || input.id || '').trim() || Date.now().toString(36);
  const now = new Date().toISOString();
  return {
    id: input.id || makeWorkItemId(source, sourceId),
    source,
    sourceId,
    title: String(input.title || 'Untitled work item').slice(0, 300),
    status: String(input.status || 'open').slice(0, 40),
    url: String(input.url || '').slice(0, 500),
    repo: input.repo || null,
    priority: input.priority || null,
    sessionId: input.sessionId || null,
    worktreeId: input.worktreeId || null,
    pullRequest: input.pullRequest || null,
    importedAt: input.importedAt || now,
    updatedAt: now
  };
}

function fromGithubIssue(issue = {}, repo = null) {
  const isPr = Boolean(issue.pull_request || issue.pullRequest);
  const number = String(issue.number || issue.sourceId || '');
  return normalizeWorkItem({
    source: isPr ? 'github-pr' : 'github-issue',
    sourceId: number,
    title: issue.title || (isPr ? `PR #${number}` : `Issue #${number}`),
    status: issue.state === 'closed' ? 'closed' : 'open',
    url: issue.html_url || issue.url || '',
    repo
  });
}

function fromLinearIssue(issue = {}) {
  return normalizeWorkItem({
    source: 'linear',
    sourceId: issue.identifier || issue.id,
    title: issue.title || issue.identifier || 'Linear issue',
    status: (issue.state && issue.state.name) || issue.status || 'open',
    url: issue.url || ''
  });
}

function fromGithubWebhook(body = {}) {
  const issue = body.issue || body.pull_request || {};
  const repo = body.repository && body.repository.full_name ? body.repository.full_name : null;
  if (body.pull_request && !body.issue) {
    return fromGithubIssue({ ...body.pull_request, pull_request: body.pull_request }, repo);
  }
  return fromGithubIssue(issue, repo);
}

function summarizeInbox(items) {
  const list = Array.isArray(items) ? items : [];
  const openIssues = list.filter(i => i.source === 'github-issue' && i.status !== 'closed').length;
  const openPrs = list.filter(i => i.source === 'github-pr' && i.status !== 'closed').length;
  const mergeQueue = list.filter(i => i.status === 'merge-ready' || i.status === 'pr-open').map(i => ({
    id: i.id,
    title: i.title,
    source: i.source
  }));
  return {
    github: {
      openPullRequests: openPrs,
      openIssues,
      openDiscussions: 0
    },
    mergeQueue,
    conflictQueue: [],
    staleSalvageQueue: [],
    linearOpen: list.filter(i => i.source === 'linear' && i.status !== 'closed' && i.status !== 'Done').length,
    total: list.length
  };
}

module.exports = {
  parseGithubRepo,
  makeWorkItemId,
  normalizeWorkItem,
  fromGithubIssue,
  fromLinearIssue,
  fromGithubWebhook,
  summarizeInbox,
  listGithubIssues,
  listLinearIssues,
  createGithubPullRequest,
  cloneRecord
};
