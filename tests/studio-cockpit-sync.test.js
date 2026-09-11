/**
 * @file tests/studio-cockpit-sync.test.js
 * App-wide cockpit chrome plus catalog/telemetry/session labels bound to APIs.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { OasControlPlaneServer } = require('../apps/api/src/server');

const WEB = path.join(__dirname, '../apps/web');

class MockIncomingMessage extends EventEmitter {
  constructor(method = 'GET', url = '/') {
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
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    Object.assign(this.headers, headers);
  }
  write(chunk) { this.body += chunk; }
  end(chunk) {
    if (chunk) this.body += chunk;
    this.emit('finish');
  }
}

function dispatch(server, method, url) {
  return new Promise((resolve, reject) => {
    const req = new MockIncomingMessage(method, url);
    const res = new MockServerResponse();
    res.on('finish', () => {
      let body = res.body;
      try { body = JSON.parse(res.body || '{}'); } catch { /* raw */ }
      resolve({ status: res.statusCode, body });
    });
    server.handleRequest(req, res).catch(reject);
    req.start();
  });
}

async function run() {
  console.log('\n======================================================');
  console.log('  STUDIO COCKPIT + API SYNC');
  console.log('======================================================\n');

  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(WEB, 'styles.css'), 'utf8');
  const appJs = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  const graphJs = fs.readFileSync(path.join(__dirname, '../apps/api/src/routes/graph.js'), 'utf8');

  console.log('1. Shared cockpit chrome covers the shell and remaining views');
  assert.ok(html.includes('cockpit-shell'), 'app root must use cockpit-shell');
  assert.match(css, /\.cockpit-shell/);
  assert.match(css, /\.studio-pane::before/);
  assert.match(css, /\.stat-card::before/);
  assert.match(css, /#view-catalog\.active|#view-vault\.active/);
  console.log('   shell + pane sheen + catalog/vault containment');

  console.log('2. Catalog, vault, and DAG labels sync from APIs instead of invented defaults');
  assert.ok(appJs.includes('syncStudioCatalogChrome'));
  assert.ok(appJs.includes('syncDagSessionChrome'));
  assert.ok(appJs.includes('pingControlPlaneHealth'));
  assert.doesNotMatch(appJs, /elPipelines\.textContent = data\.activePipelines !== undefined \? data\.activePipelines : 1/);
  assert.doesNotMatch(html, /MCPs \(35\)/);
  assert.doesNotMatch(html, /id="stat-active-pipelines"[^>]*>1</);
  assert.ok(appJs.includes('Delete this memory from the local vault'));
  assert.doesNotMatch(appJs, /btn-delete-mem[\s\S]{0,180}&times;/);
  console.log('   chrome sync helpers + no fake pipeline=1 / MCP 35');

  console.log('3. Graph telemetry does not invent latency or default every session to planner');
  assert.doesNotMatch(graphJs, /1200 \+ \(idLen \* 50\)/);
  assert.doesNotMatch(graphJs, /lead_agent_id \|\| 'planner'/);
  const server = new OasControlPlaneServer({ port: 0 });
  const tel = await dispatch(server, 'GET', '/api/graph/telemetry');
  assert.strictEqual(tel.status, 200);
  assert.ok(Array.isArray(tel.body.activeAgents));
  const health = await dispatch(server, 'GET', '/health');
  assert.strictEqual(health.status, 200);
  assert.ok(health.body.studioVersion);
  const catalog = await dispatch(server, 'GET', '/api/catalog');
  assert.strictEqual(catalog.status, 200);
  assert.ok(Array.isArray(catalog.body.agents));
  const telemetry = await dispatch(server, 'GET', '/api/telemetry');
  assert.strictEqual(telemetry.status, 200);
  assert.ok(Number.isFinite(telemetry.body.totalAgents));
  console.log('   graph telemetry + /health + /api/catalog + /api/telemetry');

  console.log('\n  cockpit sync tests passed\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
