/**
 * @file tests/heal-worktree.test.js
 * Auto-heal applies suggestions in an isolated worktree and merges only after HITL.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const { MemoryStore } = require('../packages/db/src/index');
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

function readLf(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function initGitRepo(dir) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'oas@example.test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'OAS Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("ok");\n');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
}

async function run() {
  console.log('\n======================================================');
  console.log('  OAS HEAL WORKTREE + HITL MERGE');
  console.log('======================================================\n');

  const repo = tmpDir('oas-heal-git-');
  try {
    initGitRepo(repo);
  } catch {
    console.log('  WARNING: skip heal worktree tests: git init blocked');
    return;
  }
  const server = new OasControlPlaneServer({
    port: 0,
    workspaceRoot: repo,
    store: new MemoryStore({ storagePath: path.join(tmpDir('oas-heal-store-'), 'store.json') })
  });

  console.log('1. Suggest-only heal does not touch the main worktree');
  const suggest = await dispatch(server, 'POST', '/api/loop/heal', {
    errorTrace: 'TypeError: boom at app.js:1:1',
    targetFile: 'app.js',
    apply: false
  });
  assert.strictEqual(suggest.status, 200);
  assert.strictEqual(suggest.body.capability, 'suggest-only');
  assert.strictEqual(suggest.body.applied, false);
  assert.strictEqual(suggest.body.appliedInWorktree, false);
  assert.strictEqual(readLf(path.join(repo, 'app.js')), 'console.log("ok");\n');
  console.log('   suggest-only leaves main clean');

  console.log('2. apply=true writes the suggestion in an isolated worktree');
  const applied = await dispatch(server, 'POST', '/api/loop/heal', {
    errorTrace: 'TypeError: boom at app.js:1:1',
    targetFile: 'app.js',
    apply: true,
    verifyCommand: 'true',
    replaceContent: 'console.log("healed");\n'
  });
  assert.strictEqual(applied.status, 200);
  assert.strictEqual(applied.body.capability, 'worktree-apply');
  assert.strictEqual(applied.body.applied, false, 'main tree must stay unmodified until HITL merge');
  assert.strictEqual(applied.body.appliedInWorktree, true);
  assert.ok(applied.body.worktree && applied.body.worktree.id);
  assert.strictEqual(applied.body.written, 'app.js');
  assert.strictEqual(applied.body.verified, true);
  assert.strictEqual(readLf(path.join(repo, 'app.js')), 'console.log("ok");\n');
  const isolated = readLf(path.join(applied.body.worktree.path, 'app.js'));
  assert.strictEqual(isolated, 'console.log("healed");\n');
  console.log('   isolated apply + verify');

  console.log('3. Merge without HITL confirm is refused');
  const refused = await dispatch(server, 'POST', '/api/loop/heal/merge', {
    worktreeId: applied.body.worktree.id
  });
  assert.strictEqual(refused.status, 400);
  assert.strictEqual(readLf(path.join(repo, 'app.js')), 'console.log("ok");\n');
  console.log('   confirmMerge required');

  console.log('4. HITL confirmMerge brings the patch onto main');
  const merged = await dispatch(server, 'POST', '/api/loop/heal/merge', {
    worktreeId: applied.body.worktree.id,
    confirmMerge: true
  });
  assert.strictEqual(merged.status, 200);
  assert.strictEqual(merged.body.success, true);
  assert.strictEqual(readLf(path.join(repo, 'app.js')), 'console.log("healed");\n');
  console.log('   HITL merge');

  console.log('\n======================================================');
  console.log('  PASS: HEAL WORKTREE CONTRACTS PASSED');
  console.log('======================================================\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('FAIL: Heal worktree test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
