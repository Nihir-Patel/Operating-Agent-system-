/**
 * @file tests/mcp-read-plane.test.js
 */

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { MemoryStore } = require('../packages/db/src/index');
const { handleReadTool, READ_TOOLS } = require('../packages/engine/src/mcp-read-plane');
const { OasControlPlaneServer } = require('../apps/api/src/server');

class MockIncomingMessage extends EventEmitter {
  constructor(method, url, body = null) {
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
  setHeader(n, v) { this.headers[n] = v; }
  writeHead(s, h = {}) { this.statusCode = s; Object.assign(this.headers, h); this.headersSent = true; }
  write(c) { this.body += c; }
  end(c) { if (c) this.body += c; this.writableEnded = true; this.emit('finish'); }
}
function dispatch(server, method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const req = new MockIncomingMessage(method, urlPath, body);
    const res = new MockServerResponse();
    res.on('finish', () => {
      try { resolve({ status: res.statusCode, body: JSON.parse(res.body || '{}') }); }
      catch { resolve({ status: res.statusCode, raw: res.body }); }
    });
    server.handleRequest(req, res).catch(reject);
    req.start();
  });
}

async function run() {
  console.log('\n=== MCP READ PLANE ===\n');
  assert.ok(READ_TOOLS.some(t => t.name === 'list_sessions'));
  const store = new MemoryStore({ storagePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oas-rp-')), 's.json') });
  store.createSession({ title: 'Read plane', lead_agent_id: 'planner' });
  const listed = handleReadTool('list_sessions', { store });
  assert.strictEqual(listed.data.length, 1);
  assert.strictEqual(listed.data[0].title, 'Read plane');
  try {
    handleReadTool('delete_session', { store });
    assert.fail('mutating tools must be denied');
  } catch (err) {
    assert.strictEqual(err.code, 'READ_PLANE_DENIED');
  }
  console.log('   list_sessions works; mutations denied');

  const server = new OasControlPlaneServer({
    port: 0,
    workspaceRoot: path.resolve(__dirname, '..'),
    store
  });
  const meta = await dispatch(server, 'GET', '/api/read-plane');
  assert.strictEqual(meta.status, 200);
  assert.strictEqual(meta.body.mutation, false);
  const sessions = await dispatch(server, 'GET', '/api/read-plane/sessions');
  assert.strictEqual(sessions.body.data.length, 1);
  const denied = await dispatch(server, 'POST', '/api/read-plane/call', { tool: 'write_file' });
  assert.strictEqual(denied.status, 403);
  const diff = await dispatch(server, 'GET', '/api/read-plane/diff');
  assert.strictEqual(diff.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(diff.body.data || {}, 'diff'));
  const worktree = await dispatch(server, 'GET', '/api/read-plane/worktree');
  assert.strictEqual(worktree.status, 200);
  assert.ok(worktree.body.data.branch);
  console.log('   HTTP read plane is mutation-false');

  const { handle } = require('../scripts/oas-studio-mcp');

  async function captureHandle(message) {
    const writes = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk) => { writes.push(String(chunk)); return true; };
    try {
      await handle(message);
    } finally {
      process.stdout.write = origWrite;
    }
    return writes.join('');
  }

  const listOut = await captureHandle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.ok(!listOut.includes('Content-Length:'), 'Cursor stdio handshake expects NDJSON');
  const catalog = JSON.parse(listOut.trim().split('\n').pop());
  assert.ok(catalog.result.tools.some(tool => tool.name === 'list_sessions'));
  console.log('   stdio helper lists read-only tools');

  const initOut = await captureHandle({
    jsonrpc: '2.0',
    id: 2,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'cursor-test', version: '1.0.0' }
    }
  });
  const initialized = JSON.parse(initOut.trim().split('\n').pop());
  assert.strictEqual(initialized.result.protocolVersion, '2025-11-25');
  assert.deepStrictEqual(initialized.result.capabilities.tools, { listChanged: false });
  console.log('   initialize echoes Cursor protocol version over NDJSON');

  const pingOut = await captureHandle({ jsonrpc: '2.0', id: 3, method: 'ping' });
  assert.deepStrictEqual(JSON.parse(pingOut.trim()).result, {});
  const noteOut = await captureHandle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.strictEqual(noteOut, '');
  console.log('   ping and initialized notification complete the Cursor handshake');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
