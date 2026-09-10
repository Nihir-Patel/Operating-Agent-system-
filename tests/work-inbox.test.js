/**
 * @file tests/work-inbox.test.js
 * Studio work inbox: import GitHub/Linear items, HUD counts, HITL PR/merge.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const { MemoryStore, OasSqliteStore } = require('../packages/db/src/index');
const {
  parseGithubRepo,
  normalizeWorkItem,
  summarizeInbox,
  fromGithubIssue,
  fromLinearIssue,
  fromGithubWebhook,
  listGithubIssues
} = require('../packages/engine/src/work-inbox');
const { OasControlPlaneServer } = require('../apps/api/src/server');

class MockIncomingMessage extends EventEmitter {
  constructor(method = 'GET', url = '/', body = null) {
    super();
    this.method = method;
    this.url = url;
    this.headers = { host: 'localhost', 'content-type': 'application/json' };
    this._body = body ? JSON.stringify(body) : null;
  }

  start() {
    process.nextTick(() => {
      if (this._body) this.emit('data', Buffer.from(this._body));
      this.emit('end');
    });
  }
}

class MockServerResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.body = '';
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    Object.assign(this.headers, headers);
  }

  write(chunk) {
    this.body += chunk;
  }

  end(chunk) {
    if (chunk) this.body += chunk;
    this.emit('finish');
  }
}

function dispatch(server, method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const req = new MockIncomingMessage(method, urlPath, body);
    const res = new MockServerResponse();
    res.on('finish', () => {
      try {
        resolve({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : {} });
      } catch {
        resolve({ status: res.statusCode, raw: res.body });
      }
    });
    server.handleRequest(req, res).catch(reject);
    req.start();
  });
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initGitRepo(dir) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'oas@example.test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'OAS Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/app.git'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("ok");\n');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
}

async function run() {
  console.log('\n======================================================');
  console.log('  OAS WORK INBOX (GITHUB / LINEAR / HITL PR)');
  console.log('======================================================\n');

  console.log('1. Normalize GitHub/Linear payloads and summarize queues');
  assert.strictEqual(parseGithubRepo('git@github.com:acme/app.git'), 'acme/app');
  assert.strictEqual(parseGithubRepo('https://github.com/acme/app.git'), 'acme/app');
  assert.strictEqual(parseGithubRepo('acme/app'), 'acme/app');
  const issue = fromGithubIssue({ number: 42, title: 'Fix timeout', html_url: 'https://github.com/acme/app/issues/42', state: 'open' }, 'acme/app');
  assert.strictEqual(issue.source, 'github-issue');
  assert.strictEqual(issue.sourceId, '42');
  const pr = fromGithubIssue({ number: 7, title: 'Add leases', html_url: 'https://github.com/acme/app/pull/7', pull_request: { url: 'https://api.github.com/repos/acme/app/pulls/7' } }, 'acme/app');
  assert.strictEqual(pr.source, 'github-pr');
  const linear = fromLinearIssue({ id: 'lin_1', identifier: 'OAS-20', title: 'Inbox', url: 'https://linear.app/oas/issue/OAS-20', state: { name: 'In Progress' } });
  assert.strictEqual(linear.source, 'linear');
  assert.strictEqual(linear.sourceId, 'OAS-20');
  const webhookItem = fromGithubWebhook({ action: 'labeled', issue: { number: 9, title: 'Auth regression', html_url: 'https://github.com/acme/app/issues/9' } });
  assert.strictEqual(webhookItem.sourceId, '9');
  const summary = summarizeInbox([issue, pr, linear, normalizeWorkItem({ source: 'github-pr', sourceId: '8', title: 'Queued', status: 'merge-ready' })]);
  assert.strictEqual(summary.github.openIssues, 1);
  assert.strictEqual(summary.github.openPullRequests, 2);
  assert.strictEqual(summary.mergeQueue.length, 1);
  console.log('   payload mapping + queue math');

  console.log('2. Import persists items and HUD reads live inbox counts');
  const store = new MemoryStore({ storagePath: path.join(tmpDir('oas-inbox-mem-'), 'store.json') });
  const server = new OasControlPlaneServer({
    port: 0,
    workspaceRoot: tmpDir('oas-inbox-ws-'),
    store,
    inboxAdapters: {
      github: {
        list: async () => [
          fromGithubIssue({ number: 11, title: 'Flaky e2e', html_url: 'https://github.com/acme/app/issues/11' }, 'acme/app')
        ]
      },
      linear: {
        list: async () => [
          fromLinearIssue({ identifier: 'OAS-3', title: 'Operator inbox', url: 'https://linear.app/oas/issue/OAS-3' })
        ]
      }
    }
  });
  const imported = await dispatch(server, 'POST', '/api/inbox/import', { source: 'github' });
  assert.strictEqual(imported.status, 200);
  assert.strictEqual(imported.body.source, 'github');
  assert.strictEqual(imported.body.items.length, 1);
  const linearImport = await dispatch(server, 'POST', '/api/inbox/import', { source: 'linear' });
  assert.strictEqual(linearImport.status, 200);
  assert.strictEqual(linearImport.body.items.length, 1);
  const listed = await dispatch(server, 'GET', '/api/inbox');
  assert.strictEqual(listed.status, 200);
  assert.strictEqual(listed.body.items.length, 2);
  assert.strictEqual(listed.body.counts.github.openIssues, 1);
  const hud = await dispatch(server, 'GET', '/api/hud-status');
  assert.strictEqual(hud.status, 200);
  assert.strictEqual(hud.body.queueState.github.openIssues, 1);
  assert.strictEqual(hud.body.queueState.source, 'inbox');
  assert.ok(hud.body.sync.Linear.health);
  console.log('   import + HUD queueState.source=inbox');

  console.log('3. SQLite round-trips work items');
  const sql = new OasSqliteStore({ storagePath: path.join(tmpDir('oas-inbox-sql-'), 'db.sqlite') });
  sql.saveWorkItem(issue);
  assert.strictEqual(sql.listWorkItems().length, 1);
  const reloaded = new OasSqliteStore({ storagePath: sql.storagePath });
  assert.strictEqual(reloaded.listWorkItems()[0].title, 'Fix timeout');
  console.log('   sqlite persistence');

  console.log('4. Claim spawns a worktree; PR publish and merge require HITL');
  const repo = tmpDir('oas-inbox-git-');
  let gitReady = true;
  try {
    initGitRepo(repo);
  } catch {
    gitReady = false;
    console.log('  WARNING: skip git worktree inbox tests: git init blocked');
  }
  if (gitReady) {
  const gitServer = new OasControlPlaneServer({
    port: 0,
    workspaceRoot: repo,
    store: new MemoryStore({ storagePath: path.join(tmpDir('oas-inbox-git-store-'), 'store.json') }),
    inboxAdapters: {
      github: {
        createPullRequest: async payload => ({
          url: 'https://github.com/acme/app/pull/88',
          number: 88,
          title: payload.title
        })
      }
    }
  });
  const seeded = await dispatch(gitServer, 'POST', '/api/inbox/import', {
    source: 'items',
    items: [fromGithubIssue({ number: 42, title: 'Fix timeout', html_url: 'https://github.com/acme/app/issues/42' }, 'acme/app')]
  });
  const itemId = seeded.body.items[0].id;
  const claimed = await dispatch(gitServer, 'POST', `/api/inbox/${itemId}/claim`, { agentId: 'planner' });
  assert.strictEqual(claimed.status, 200);
  assert.strictEqual(claimed.body.item.status, 'claimed');
  assert.ok(claimed.body.worktree && claimed.body.worktree.id);
  assert.ok(claimed.body.sessionId);
  const draftPr = await dispatch(gitServer, 'POST', `/api/inbox/${itemId}/pr`, { title: 'fix: timeout' });
  assert.strictEqual(draftPr.status, 200);
  assert.strictEqual(draftPr.body.published, false);
  assert.strictEqual(draftPr.body.capability, 'draft-only');
  const refusedPr = await dispatch(gitServer, 'POST', `/api/inbox/${itemId}/pr`, { title: 'fix: timeout', confirmPublish: true });
  assert.strictEqual(refusedPr.status, 201);
  assert.strictEqual(refusedPr.body.published, true);
  assert.strictEqual(refusedPr.body.pullRequest.number, 88);
  const refusedMerge = await dispatch(gitServer, 'POST', `/api/inbox/${itemId}/merge`, {});
  assert.strictEqual(refusedMerge.status, 400);
  assert.strictEqual(refusedMerge.body.errorCode, 'HITL_REQUIRED');
  const merged = await dispatch(gitServer, 'POST', `/api/inbox/${itemId}/merge`, { confirmMerge: true });
  assert.strictEqual(merged.status, 200);
  assert.strictEqual(merged.body.merged, true);
  console.log('   claim / draft PR / HITL publish / HITL merge');

  console.log('5. Webhook upserts an inbox item without applying to main');
  const hook = await dispatch(gitServer, 'POST', '/api/webhooks/github', {
    action: 'opened',
    issue: { number: 99, title: 'New flake', html_url: 'https://github.com/acme/app/issues/99' }
  });
  assert.strictEqual(hook.status, 201);
  assert.ok(hook.body.workItemId);
  const afterHook = await dispatch(gitServer, 'GET', '/api/inbox');
  assert.ok(afterHook.body.items.some(item => item.sourceId === '99'));
  console.log('   webhook seeds inbox');
  }

  const html = fs.readFileSync(path.join(__dirname, '../apps/web/index.html'), 'utf8');
  assert.ok(html.includes('Work inbox') || html.includes('id="inbox-list"'));
  assert.ok(!html.includes('PASS: 40/40 E2E Passing'));
  console.log('   Studio inbox surface is honest');

  console.log('6. Unconfigured GitHub import is 503; token fetch stays injectable');
  const prevGithubToken = process.env.GITHUB_TOKEN;
  const prevLinearKey = process.env.LINEAR_API_KEY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.LINEAR_API_KEY;
  try {
    const bare = new OasControlPlaneServer({
      port: 0,
      workspaceRoot: tmpDir('oas-inbox-bare-'),
      store: new MemoryStore({ storagePath: path.join(tmpDir('oas-inbox-bare-store-'), 'store.json') })
    });
    const unconfigured = await dispatch(bare, 'POST', '/api/inbox/import', { source: 'github', repo: 'acme/app' });
    assert.strictEqual(unconfigured.status, 503);
    assert.strictEqual(unconfigured.body.errorCode, 'INBOX_UNCONFIGURED');

    const mapped = await listGithubIssues({
      repo: 'acme/app',
      token: 'test-token',
      fetchImpl: async (url, opts) => {
        assert.ok(String(url).includes('/repos/acme/app/issues'));
        assert.ok(String(opts.headers.Authorization).startsWith('Bearer '));
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([
            { number: 5, title: 'Token issue', html_url: 'https://github.com/acme/app/issues/5' }
          ])
        };
      }
    });
    assert.strictEqual(mapped[0].sourceId, '5');

    process.env.GITHUB_TOKEN = 'test-token';
    const tokenServer = new OasControlPlaneServer({
      port: 0,
      workspaceRoot: tmpDir('oas-inbox-token-'),
      store: new MemoryStore({ storagePath: path.join(tmpDir('oas-inbox-token-store-'), 'store.json') }),
      inboxFetch: async (url) => {
        assert.ok(String(url).includes('api.github.com/repos/acme/app/issues'));
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([
            { number: 12, title: 'Imported via token', html_url: 'https://github.com/acme/app/issues/12' }
          ])
        };
      }
    });
    const tokenImport = await dispatch(tokenServer, 'POST', '/api/inbox/import', { source: 'github', repo: 'acme/app' });
    assert.strictEqual(tokenImport.status, 200);
    assert.strictEqual(tokenImport.body.items[0].title, 'Imported via token');
    console.log('   unconfigured 503 + injectable token import');
  } finally {
    if (prevGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prevGithubToken;
    if (prevLinearKey === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = prevLinearKey;
  }

  console.log('\n======================================================');
  console.log('  PASS: WORK INBOX CONTRACTS PASSED');
  console.log('======================================================\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('FAIL: Work inbox test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
