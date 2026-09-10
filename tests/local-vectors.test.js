/**
 * @file tests/local-vectors.test.js
 */

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { rankByLocalVector, cosineSimilarity, embedText } = require('../packages/db/src/local-vectors');
const { MemoryStore } = require('../packages/db/src/index');
const { OasControlPlaneServer } = require('../apps/api/src/server');

class MockIncomingMessage extends EventEmitter {
  constructor(method, url) {
    super();
    this.method = method;
    this.url = url;
    this.headers = { host: 'localhost' };
  }
  start() {
    process.nextTick(() => this.emit('end'));
  }
}
class MockServerResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.body = '';
  }
  setHeader(n, v) { this.headers[n] = v; }
  writeHead(s, h = {}) {
    this.statusCode = s;
    Object.assign(this.headers, h);
    this.headersSent = true;
  }
  write(c) { this.body += c; }
  end(c) { if (c) this.body += c; this.writableEnded = true; this.emit('finish'); }
}
function dispatch(server, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = new MockIncomingMessage(method, urlPath);
    const res = new MockServerResponse();
    res.on('finish', () => resolve({ status: res.statusCode, body: JSON.parse(res.body || '[]') }));
    server.handleRequest(req, res).catch(reject);
    req.start();
  });
}

async function run() {
  console.log('\n=== LOCAL HASH VECTORS ===\n');
  assert.ok(cosineSimilarity(embedText('rate limiter tests'), embedText('rate limiter tests')) > 0.99);
  const ranked = rankByLocalVector([
    { id: 'a', title: 'Rate limiter TDD', body: 'immutable token bucket tests' },
    { id: 'b', title: 'Unrelated', body: 'photos of cats' }
  ], 'token bucket rate limiter');
  assert.strictEqual(ranked[0].id, 'a');
  assert.strictEqual(ranked[0].vectorSource, 'local-hash-vectors');
  console.log('   cosine rank prefers related memory');

  const store = new MemoryStore({ storagePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oas-vec-')), 's.json') });
  store.addMemory({ title: 'Rate limiter TDD', body: 'immutable token bucket tests' });
  store.addMemory({ title: 'Cats', body: 'photos of cats' });
  const server = new OasControlPlaneServer({ port: 0, workspaceRoot: os.tmpdir(), store });
  const res = await dispatch(server, 'GET', '/api/memory?mode=semantic&q=token%20bucket');
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.strictEqual(res.body[0].title, 'Rate limiter TDD');
  console.log('   GET /api/memory?mode=semantic ranks locally (not pgvector)');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
