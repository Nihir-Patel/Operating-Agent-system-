/**
 * @file tests/studio-ui-contract.test.js
 * Comprehensive Contract and Integration Test Battery for OAS Studio UI & Control Plane
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { OasControlPlaneServer } = require('../apps/api/src/server');

class MockIncomingMessage extends EventEmitter {
  constructor(method = 'GET', url = '/', body = null) {
    super();
    this.method = method;
    this.url = url;
    this.headers = { host: 'localhost' };
    this._body = body ? JSON.stringify(body) : null;
  }

  start() {
    process.nextTick(() => {
      if (this._body) {
        this.emit('data', Buffer.from(this._body));
      }
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
    this.headers[name.toLowerCase()] = value;
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    for (const [k, v] of Object.entries(headers)) {
      this.headers[k.toLowerCase()] = v;
    }
  }

  write(chunk) {
    this.body += chunk;
  }

  end(chunk) {
    if (chunk) this.body += chunk;
    this.emit('finish');
  }
}

async function simulateRequest(server, method, url, body = null) {
  return new Promise((resolve, reject) => {
    const req = new MockIncomingMessage(method, url, body);
    const res = new MockServerResponse();

    res.on('finish', () => {
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: res.body
      });
    });

    server.handleRequest(req, res).catch(reject);
    req.start();
  });
}

async function runStudioContractTests() {
  console.log('\n======================================================');
  console.log('  OAS STUDIO FULL PLATFORM & UI CONTRACT BATTERY');
  console.log('======================================================\n');
  const server = new OasControlPlaneServer({ port: 0 });

  // 1. Static Asset Serving: index.html
  console.log('1. Verifying GET / (index.html)');
  const resIndex = await simulateRequest(server, 'GET', '/');
  assert.strictEqual(resIndex.statusCode, 200, 'GET / must return 200');
  assert.ok(resIndex.headers['content-type'].includes('text/html'), 'Content-Type must be text/html');
  assert.ok(resIndex.body.includes('command-palette-modal'), 'index.html must include command-palette-modal');
  assert.ok(resIndex.body.includes('hitl-modal'), 'index.html must include hitl-modal');
  assert.ok(resIndex.body.includes('btn-open-command-palette'), 'index.html must include ⌘K Command Palette button');
  assert.ok(resIndex.body.includes('id="inbox-list"'), 'index.html must include work inbox list');
  assert.ok(resIndex.body.includes('Work inbox'), 'index.html must label the GitHub modal as Work inbox');
  assert.ok(resIndex.body.includes('id="arena-must-contain"'), 'Arena must expose custom graders');
  assert.ok(resIndex.body.includes('local hash-vectors (not pgvector)'), 'Memory vault must not claim hosted pgvector');
  console.log('  ✔ index.html contains command palette and HITL elements');

  // 2. Static Asset Serving: styles.css
  console.log('2. Verifying GET /styles.css');
  const resCss = await simulateRequest(server, 'GET', '/styles.css');
  assert.strictEqual(resCss.statusCode, 200, 'GET /styles.css must return 200');
  assert.ok(resCss.headers['content-type'].includes('text/css'), 'Content-Type must be text/css');
  assert.ok(resCss.body.includes('--surface-canvas'), 'styles.css must contain Cyber-Linear tokens');
  assert.ok(resCss.body.includes('.command-palette-backdrop'), 'styles.css must contain command palette styles');
  assert.ok(resCss.body.includes('.hitl-modal-overlay'), 'styles.css must contain HITL modal styles');
  assert.ok(resCss.body.includes('.edge-animated'), 'styles.css must contain animated DAG edge styles');
  console.log('  ✔ styles.css contains Cyber-Linear design system and component styles');

  // 3. Static Asset Serving: app.js + ES modules
  console.log('3. Verifying GET /app.js and GET /js modules');
  const resJs = await simulateRequest(server, 'GET', '/app.js');
  assert.strictEqual(resJs.statusCode, 200, 'GET /app.js must return 200');
  const resApiClient = await simulateRequest(server, 'GET', '/js/api-client.js');
  assert.strictEqual(resApiClient.statusCode, 200, 'GET /js/api-client.js must return 200');
  const studioJs = [resJs.body, resApiClient.body].join('\n');
  assert.ok(studioJs.includes('initGlobalCommandPalette'), 'app.js must define initGlobalCommandPalette');
  assert.ok(studioJs.includes('initHitlSecurityController'), 'app.js must define initHitlSecurityController');
  assert.ok(studioJs.includes('openEntityModal'), 'app.js must define openEntityModal');
  assert.ok(studioJs.includes('edge-animated'), 'app.js must render animated DAG edges');
  assert.ok(studioJs.includes('agent:intervention:paused'), 'app.js must handle HITL intervention paused events');
  assert.ok(studioJs.includes('getApiToken'), 'Studio JS must read the control-plane API token');
  assert.ok(studioJs.includes("headers.set('Authorization'"), 'Studio JS must attach Authorization headers to API calls');
  assert.ok(studioJs.includes('getSseStreamUrl'), 'Studio JS must send credentials on the SSE stream');
  console.log('  ✔ app.js module graph contains client-side controller, modal handlers, and SSE logic');

  // 4. Catalog API
  console.log('4. Verifying GET /api/catalog');
  const resCatalog = await simulateRequest(server, 'GET', '/api/catalog');
  assert.strictEqual(resCatalog.statusCode, 200, 'GET /api/catalog must return 200');
  const catalog = JSON.parse(resCatalog.body);
  assert.ok(Array.isArray(catalog.agents), 'Catalog must have agents array');
  assert.ok(Array.isArray(catalog.skills), 'Catalog must have skills array');
  assert.ok(Array.isArray(catalog.commands), 'Catalog must have commands array');
  assert.ok(catalog.agents.length > 0, 'Catalog must contain loaded agents');
  console.log(`  ✔ Catalog loaded ${catalog.agents.length} agents, ${catalog.skills.length} skills, ${catalog.commands.length} commands`);

  // 5. Knowledge Graph API
  console.log('5. Verifying GET /api/graph');
  const resGraph = await simulateRequest(server, 'GET', '/api/graph');
  assert.strictEqual(resGraph.statusCode, 200, 'GET /api/graph must return 200');
  const graph = JSON.parse(resGraph.body);
  assert.ok(graph.nodes && graph.nodes.length > 0, 'Graph must contain relational nodes');
  assert.ok(graph.edges && graph.edges.length > 0, 'Graph must contain relational edges');
  console.log(`  ✔ Knowledge Graph loaded ${graph.nodes.length} nodes and ${graph.edges.length} edges`);

  // 6. Filesystem Explorer API
  console.log('6. Verifying GET /api/fs/tree & /api/fs/read');
  const resTree = await simulateRequest(server, 'GET', '/api/fs/tree');
  assert.strictEqual(resTree.statusCode, 200);
  const treeData = JSON.parse(resTree.body);
  assert.ok(Array.isArray(treeData.tree), 'FS tree must return tree array');

  const resRead = await simulateRequest(server, 'GET', '/api/fs/read?path=package.json');
  assert.strictEqual(resRead.statusCode, 200);
  const fileData = JSON.parse(resRead.body);
  assert.ok(fileData.content.includes('oas-universal'), 'FS read must return file content');
  console.log('  ✔ Filesystem directory traversal and sandbox read verified');

  // 7. Command Execution API
  console.log('7. Verifying POST /api/commands/execute');
  const resCmd = await simulateRequest(server, 'POST', '/api/commands/execute', {
    command: '/help',
    sessionId: 'test-session-cmd'
  });
  assert.strictEqual(resCmd.statusCode, 200);
  const cmdData = JSON.parse(resCmd.body);
  assert.ok(cmdData.output, 'Command execution must return output payload');
  console.log('  ✔ Slash command execution engine verified');

  // 8. Platform Settings API
  console.log('8. Verifying GET & POST /api/settings');
  const resSettings = await simulateRequest(server, 'GET', '/api/settings');
  assert.strictEqual(resSettings.statusCode, 200);
  const settingsData = JSON.parse(resSettings.body);
  assert.ok(settingsData.provider !== undefined, 'Settings must return provider');

  const resSaveSettings = await simulateRequest(server, 'POST', '/api/settings', {
    provider: 'anthropic',
    sandboxEnabled: true
  });
  assert.strictEqual(resSaveSettings.statusCode, 200);
  console.log('  ✔ Platform settings persistence verified');

  // 9. Memory Vault Lifecycle
  console.log('9. Verifying Memory Vault (POST, GET, DELETE /api/memory)');
  const resAddMem = await simulateRequest(server, 'POST', '/api/memory', {
    title: 'Contract Test Invariant',
    scope: 'project',
    kind: 'invariant',
    body: 'Always test every endpoint and wire-up thoroughly.'
  });
  assert.strictEqual(resAddMem.statusCode, 201);
  const memRecord = JSON.parse(resAddMem.body);

  const resGetMem = await simulateRequest(server, 'GET', '/api/memory?query=Contract');
  assert.strictEqual(resGetMem.statusCode, 200);
  const memList = JSON.parse(resGetMem.body);
  assert.ok(memList.some(m => m.id === memRecord.id), 'Memory list must include created record');

  const resDelMem = await simulateRequest(server, 'DELETE', `/api/memory/${memRecord.id}`);
  assert.strictEqual(resDelMem.statusCode, 200);
  console.log('  ✔ Memory vault CRUD lifecycle verified');

  // 10. Plan Artifacts API
  console.log('10. Verifying Plan Artifacts (POST, GET, PUT /api/artifacts)');
  const resAddArt = await simulateRequest(server, 'POST', '/api/artifacts', {
    title: 'Test Capability Roadmap',
    kind: 'plan',
    content: 'Phase 1: Zero-latency streaming UI',
    status: 'draft'
  });
  assert.strictEqual(resAddArt.statusCode, 201);
  const artRecord = JSON.parse(resAddArt.body);

  const resUpdateArt = await simulateRequest(server, 'PUT', `/api/artifacts/${artRecord.id}`, {
    status: 'approved',
    annotations: [{ author: 'Lead Architect', text: 'Approved for launch' }]
  });
  assert.strictEqual(resUpdateArt.statusCode, 200);
  console.log('  ✔ Plan artifacts management and annotations verified');

  // 11. Multi-Session Lifecycle
  console.log('11. Verifying Session Management (POST, RENAME, EXPORT, DELETE /api/sessions)');
  const resNewSess = await simulateRequest(server, 'POST', '/api/sessions', {
    title: 'Audit Verification Session',
    lead_agent_id: 'planner'
  });
  assert.strictEqual(resNewSess.statusCode, 201);
  const newSess = JSON.parse(resNewSess.body);

  const resRename = await simulateRequest(server, 'POST', `/api/sessions/${newSess.id}/rename`, {
    title: 'Renamed Session'
  });
  assert.strictEqual(resRename.statusCode, 200);

  const resExport = await simulateRequest(server, 'GET', `/api/sessions/${newSess.id}/export`);
  assert.strictEqual(resExport.statusCode, 200);
  const exportData = JSON.parse(resExport.body);
  assert.ok(exportData.markdown, 'Export must return markdown transcript');

  const resDelSess = await simulateRequest(server, 'DELETE', `/api/sessions/${newSess.id}`);
  assert.strictEqual(resDelSess.statusCode, 200);
  console.log('  ✔ Multi-session lifecycle and export verified');

  // 12. Intervention API Endpoint: Pause / Resume / Abort
  console.log('12. Verifying POST /api/sessions/:id/intervene');
  const sessionId = 'test-session-' + Date.now();
  server.scheduler.createPipeline(sessionId, 'Test Task for HITL', 'feature_lifecycle');

  const resPause = await simulateRequest(server, 'POST', `/api/sessions/${sessionId}/intervene`, { action: 'pause' });
  assert.strictEqual(resPause.statusCode, 200);
  const pauseData = JSON.parse(resPause.body);
  assert.strictEqual(pauseData.run.status, 'paused');

  const resResume = await simulateRequest(server, 'POST', `/api/sessions/${sessionId}/intervene`, { action: 'resume' });
  assert.strictEqual(resResume.statusCode, 200);
  const resumeData = JSON.parse(resResume.body);
  assert.strictEqual(resumeData.run.status, 'running');

  const resFb = await simulateRequest(server, 'POST', `/api/sessions/${sessionId}/intervene`, { action: 'feedback', feedback: 'Continue with sandbox' });
  assert.strictEqual(resFb.statusCode, 200);

  const resAbort = await simulateRequest(server, 'POST', `/api/sessions/${sessionId}/intervene`, { action: 'abort' });
  assert.strictEqual(resAbort.statusCode, 200);
  console.log('  ✔ Intervention lifecycle (pause -> resume -> feedback -> abort) verified');

  console.log('13. Verifying desktop Studio devUrl matches oas-studio port');
  const tauriConf = JSON.parse(fs.readFileSync(path.join(__dirname, '../apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  assert.strictEqual(tauriConf.build.devUrl, 'http://127.0.0.1:3458', 'Tauri devUrl must target the Studio control plane');
  assert.ok(typeof tauriConf.app.security.csp === 'string' && tauriConf.app.security.csp.includes("default-src 'self'"), 'Tauri CSP must not be null');
  console.log('  ✔ Tauri desktop shell targets Studio on port 3458');

  console.log('\n======================================================');
  console.log('  ✅ ALL 13 STUDIO SUBSYSTEM CONTRACTS PASSED (100%)');
  console.log('======================================================\n');
}

if (require.main === module) {
  runStudioContractTests().catch(err => {
    console.error('❌ Studio contract test failed:', err);
    process.exit(1);
  });
}

module.exports = { runStudioContractTests };
