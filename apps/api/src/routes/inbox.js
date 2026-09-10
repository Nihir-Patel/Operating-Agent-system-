/**
 * @file apps/api/src/routes/inbox.js
 * GitHub/Linear work inbox: import, claim worktree, HITL PR publish, HITL merge.
 */

const { execSync } = require('child_process');
const {
  parseGithubRepo,
  normalizeWorkItem,
  summarizeInbox,
  listGithubIssues,
  listLinearIssues,
  createGithubPullRequest
} = require('../../../../packages/engine/src/work-inbox');

function detectGithubRepo(workspaceRoot) {
  try {
    const remote = execSync('git remote get-url origin', {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return parseGithubRepo(remote);
  } catch {
    return null;
  }
}

function readToken(server, envKey, settingsKey) {
  const settings = server.store && typeof server.store.getSettings === 'function'
    ? server.store.getSettings()
    : {};
  return String(process.env[envKey] || settings[settingsKey] || '').trim() || null;
}

function inboxFetch(server) {
  return server.inboxFetch || globalThis.fetch;
}

function requireItem(store, id) {
  if (!store || typeof store.getWorkItem !== 'function') {
    const err = new Error('Work inbox store is unavailable');
    err.statusCode = 500;
    throw err;
  }
  const item = store.getWorkItem(id);
  if (!item) {
    const err = new Error('Work item not found');
    err.statusCode = 404;
    err.code = 'INBOX_NOT_FOUND';
    throw err;
  }
  return item;
}

async function loadImportItems(server, source, body) {
  if (source === 'items') {
    const raw = Array.isArray(body.items) ? body.items : [];
    return raw.map(item => normalizeWorkItem(item));
  }
  const adapter = server.inboxAdapters && server.inboxAdapters[source];
  if (adapter && typeof adapter.list === 'function') {
    const listed = await adapter.list({ ...body, repo: body.repo || detectGithubRepo(server.workspaceRoot) });
    return (listed || []).map(item => normalizeWorkItem(item));
  }
  if (source === 'github') {
    return listGithubIssues({
      repo: body.repo || detectGithubRepo(server.workspaceRoot),
      token: readToken(server, 'GITHUB_TOKEN', 'githubToken'),
      fetchImpl: inboxFetch(server)
    });
  }
  if (source === 'linear') {
    return listLinearIssues({
      token: readToken(server, 'LINEAR_API_KEY', 'linearApiKey'),
      fetchImpl: inboxFetch(server)
    });
  }
  const err = new Error(`${source} import is not configured. Provide items or an inbox adapter / API token.`);
  err.statusCode = 503;
  err.code = 'INBOX_UNCONFIGURED';
  throw err;
}

module.exports = async function inboxRoutes(req, res, pathname) {
  if (pathname === '/api/inbox' && req.method === 'GET') {
    const items = this.store.listWorkItems ? this.store.listWorkItems() : [];
    return this.sendJson(res, 200, {
      schemaVersion: 'oas.inbox.v1',
      source: 'inbox',
      repo: detectGithubRepo(this.workspaceRoot),
      items,
      counts: summarizeInbox(items)
    });
  }

  if (pathname === '/api/inbox/import' && req.method === 'POST') {
    try {
      const body = await this.parseBody(req);
      const source = String(body.source || 'items').trim() || 'items';
      const incoming = await loadImportItems(this, source, body);
      const saved = incoming.map(item => this.store.saveWorkItem(item));
      const items = this.store.listWorkItems();
      return this.sendJson(res, 200, {
        source,
        imported: saved.length,
        items: saved,
        counts: summarizeInbox(items)
      });
    } catch (err) {
      return this.sendJson(res, err.statusCode || 400, { error: err.message, errorCode: err.code || 'INBOX_IMPORT_FAILED' });
    }
  }

  if (pathname.startsWith('/api/inbox/') && pathname.endsWith('/claim') && req.method === 'POST') {
    try {
      const id = decodeURIComponent(pathname.slice('/api/inbox/'.length, pathname.length - '/claim'.length));
      const body = await this.parseBody(req);
      const item = requireItem(this.store, id);
      const agentId = String(body.agentId || 'planner').trim() || 'planner';
      const worktree = this.worktrees.spawnWorktree(item.sourceId || item.id, agentId);
      const session = this.store.createSession({
        title: item.title,
        lead_agent_id: agentId,
        metadata: { source: 'inbox', workItemId: item.id }
      });
      const updated = this.store.saveWorkItem({
        ...item,
        status: 'claimed',
        worktreeId: worktree.id,
        sessionId: session.id
      });
      return this.sendJson(res, 200, { item: updated, worktree, sessionId: session.id });
    } catch (err) {
      return this.sendJson(res, err.statusCode || 400, { error: err.message, errorCode: err.code || 'INBOX_CLAIM_FAILED' });
    }
  }

  if (pathname.startsWith('/api/inbox/') && pathname.endsWith('/pr') && req.method === 'POST') {
    try {
      const id = decodeURIComponent(pathname.slice('/api/inbox/'.length, pathname.length - '/pr'.length));
      const body = await this.parseBody(req);
      const item = requireItem(this.store, id);
      const title = body.title || `fix: ${item.title}`;
      const branch = body.branch || (item.worktreeId ? `oas/${item.worktreeId}` : 'feat/inbox');
      const draft = {
        published: false,
        capability: 'draft-only',
        branch,
        baseBranch: body.baseBranch || 'main',
        prTitle: title,
        prBody: [
          `## ${title}`,
          '',
          `Closes ${item.source === 'github-issue' ? `#${item.sourceId}` : item.sourceId}`,
          item.url ? `Source: ${item.url}` : '',
          '',
          'Draft only. Set confirmPublish=true with a GitHub adapter or token to open a real PR.'
        ].filter(Boolean).join('\n')
      };
      if (!body.confirmPublish) {
        return this.sendJson(res, 200, draft);
      }
      const adapter = this.inboxAdapters && this.inboxAdapters.github;
      const repo = item.repo || detectGithubRepo(this.workspaceRoot);
      let pullRequest;
      if (adapter && typeof adapter.createPullRequest === 'function') {
        pullRequest = await adapter.createPullRequest({
          title,
          body: draft.prBody,
          head: branch,
          base: draft.baseBranch,
          repo
        });
      } else {
        const token = readToken(this, 'GITHUB_TOKEN', 'githubToken');
        if (!token) {
          return this.sendJson(res, 503, {
            ...draft,
            error: 'GitHub PR publish is not configured',
            errorCode: 'GITHUB_UNCONFIGURED'
          });
        }
        pullRequest = await createGithubPullRequest({
          title,
          body: draft.prBody,
          head: branch,
          base: draft.baseBranch,
          repo,
          token,
          fetchImpl: inboxFetch(this)
        });
      }
      const updated = this.store.saveWorkItem({
        ...item,
        status: 'pr-open',
        pullRequest
      });
      return this.sendJson(res, 201, {
        published: true,
        capability: 'github-pr',
        item: updated,
        pullRequest
      });
    } catch (err) {
      return this.sendJson(res, err.statusCode || 400, { error: err.message, errorCode: err.code || 'INBOX_PR_FAILED' });
    }
  }

  if (pathname.startsWith('/api/inbox/') && pathname.endsWith('/merge') && req.method === 'POST') {
    try {
      const id = decodeURIComponent(pathname.slice('/api/inbox/'.length, pathname.length - '/merge'.length));
      const body = await this.parseBody(req);
      if (!body.confirmMerge) {
        return this.sendJson(res, 400, {
          error: 'HITL confirmMerge is required before merging inbox worktree',
          errorCode: 'HITL_REQUIRED'
        });
      }
      const item = requireItem(this.store, id);
      if (!item.worktreeId) {
        return this.sendJson(res, 409, { error: 'Work item has no claimed worktree', errorCode: 'INBOX_NO_WORKTREE' });
      }
      const result = this.worktrees.mergeWorktree(item.worktreeId, body.targetBranch || 'HEAD');
      if (result.success) {
        this.worktrees.removeWorktree(item.worktreeId);
        this.store.saveWorkItem({ ...item, status: 'merged', worktreeId: null });
      }
      return this.sendJson(res, result.success ? 200 : 409, {
        ...result,
        merged: Boolean(result.success)
      });
    } catch (err) {
      return this.sendJson(res, err.statusCode || 400, { error: err.message, errorCode: err.code || 'INBOX_MERGE_FAILED' });
    }
  }
};
