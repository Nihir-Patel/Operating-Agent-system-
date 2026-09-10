/**
 * @file tests/path-leases.test.js
 * TCAS path leases: overlap detection, persistence, write blocking, proximity.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { MemoryStore, OasSqliteStore } = require('../packages/db/src/index');
const { PathLeaseRegistry, pathsOverlap, normalizeLeasePath } = require('../packages/engine/src/path-leases');
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

async function run() {
  console.log('\n======================================================');
  console.log('  OAS PATH LEASES & WRITE DECONFLICTION');
  console.log('======================================================\n');

  console.log('1. Path overlap treats files and parent dirs as collisions');
  assert.strictEqual(normalizeLeasePath('/src/app.js'), 'src/app.js');
  assert.strictEqual(pathsOverlap('src/app.js', 'src/app.js'), true);
  assert.strictEqual(pathsOverlap('src', 'src/app.js'), true);
  assert.strictEqual(pathsOverlap('docs/a.md', 'src/app.js'), false);
  console.log('   overlap rules');

  console.log('2. Registry grants exclusive leases and rejects overlap');
  const mem = new MemoryStore({ storagePath: path.join(tmpDir('oas-lease-mem-'), 'store.json') });
  const registry = new PathLeaseRegistry({ store: mem });
  const first = registry.acquire({ holderId: 'planner', paths: ['apps/api/src/server.js'] });
  assert.ok(first.id);
  assert.strictEqual(first.holderId, 'planner');
  let conflict = null;
  try {
    registry.acquire({ holderId: 'tdd-guide', paths: ['apps/api/src/server.js'] });
  } catch (err) {
    conflict = err;
  }
  assert.ok(conflict);
  assert.strictEqual(conflict.code, 'PATH_LEASE_CONFLICT');
  registry.assertWritable('apps/api/src/server.js', 'planner');
  let blocked = null;
  try {
    registry.assertWritable('apps/api/src/server.js', 'tdd-guide');
  } catch (err) {
    blocked = err;
  }
  assert.strictEqual(blocked.code, 'PATH_LEASE_CONFLICT');
  registry.release(first.id);
  const second = registry.acquire({ holderId: 'tdd-guide', paths: ['apps/api/src/server.js'] });
  assert.strictEqual(second.holderId, 'tdd-guide');
  console.log('   exclusive acquire / release');

  console.log('3. Expired leases are purged; SQLite round-trips');
  let now = 1_000_000;
  const sql = new OasSqliteStore({ storagePath: path.join(tmpDir('oas-lease-sql-'), 'db.sqlite') });
  const timed = new PathLeaseRegistry({ store: sql, clock: () => now });
  timed.acquire({ holderId: 'code-reviewer', paths: ['packages/db/src/index.js'], ttlMs: 50 });
  now = 1_000_200;
  const afterExpiry = new PathLeaseRegistry({ store: sql, clock: () => now });
  assert.strictEqual(afterExpiry.list().length, 0);
  afterExpiry.acquire({ holderId: 'security-reviewer', paths: ['packages/db/src/index.js'] });
  const reloaded = new PathLeaseRegistry({ store: sql, clock: () => now });
  assert.strictEqual(reloaded.list().length, 1);
  console.log('   TTL + sqlite persistence');

  console.log('4. Control plane leases block overlapping FS writes');
  const workspace = tmpDir('oas-lease-ws-');
  fs.writeFileSync(path.join(workspace, 'note.txt'), 'alpha\n');
  const server = new OasControlPlaneServer({
    port: 0,
    workspaceRoot: workspace,
    store: new MemoryStore({ storagePath: path.join(tmpDir('oas-lease-api-'), 'store.json') })
  });
  const acquired = await dispatch(server, 'POST', '/api/leases', {
    holderId: 'planner',
    paths: ['note.txt']
  });
  assert.strictEqual(acquired.status, 201);
  const overlap = await dispatch(server, 'POST', '/api/leases', {
    holderId: 'tdd-guide',
    paths: ['note.txt']
  });
  assert.strictEqual(overlap.status, 409);
  const stolen = await dispatch(server, 'POST', '/api/fs/write', {
    path: 'note.txt',
    content: 'stolen\n',
    holderId: 'tdd-guide'
  });
  assert.strictEqual(stolen.status, 409);
  const owned = await dispatch(server, 'POST', '/api/fs/write', {
    path: 'note.txt',
    content: 'planner-ok\n',
    holderId: 'planner'
  });
  assert.strictEqual(owned.status, 200);
  assert.strictEqual(fs.readFileSync(path.join(workspace, 'note.txt'), 'utf8'), 'planner-ok\n');
  console.log('   FS write respects holder');

  console.log('5. Proximity scan uses live leases instead of the sample roster');
  const prox = await dispatch(server, 'GET', '/api/proximity');
  assert.strictEqual(prox.status, 200);
  assert.strictEqual(prox.body.source, 'leases');
  assert.ok(prox.body.leases.some(l => l.holderId === 'planner'));
  assert.ok((prox.body.positions || []).some(p => p.agentId === 'planner'));
  console.log('   proximity source=leases');

  console.log('\n======================================================');
  console.log('  PASS: PATH LEASE CONTRACTS PASSED');
  console.log('======================================================\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('FAIL: Path lease test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
