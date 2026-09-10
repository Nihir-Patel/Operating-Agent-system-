/**
 * @file tests/full-platform-api.test.js
 * Test suite for the full platform API extensions:
 * - Knowledge Graph generation & entity relations
 * - Workspace Filesystem tree & secure file read
 * - Multi-session lifecycle CRUD & export
 * - Platform settings persistence
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const path = require('path');
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

function dispatch(serverInstance, method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const req = new MockIncomingMessage(method, urlPath, body);
    const res = new MockServerResponse();

    res.on('finish', () => {
      try {
        const json = res.body ? JSON.parse(res.body) : {};
        resolve({ status: res.statusCode, body: json });
      } catch {
        resolve({ status: res.statusCode, raw: res.body });
      }
    });

    serverInstance.handleRequest(req, res).catch(reject);
    req.start();
  });
}

async function runTests() {
  console.log('[Test] Starting Full Platform API In-Memory Test Battery...');
  const serverInstance = new OasControlPlaneServer({
    port: 0,
    workspaceRoot: path.resolve(__dirname, '..')
  });

  // 1. Knowledge Graph Verification
  console.log('[Test] 1. Verifying /api/graph relational ontology...');
  const graphRes = await dispatch(serverInstance, 'GET', '/api/graph');
  assert.strictEqual(graphRes.status, 200);
  assert(Array.isArray(graphRes.body.nodes), 'Graph must return nodes array');
  assert(Array.isArray(graphRes.body.edges), 'Graph must return edges array');
  assert(graphRes.body.totalNodes > 300, `Expected 300+ total nodes, got ${graphRes.body.totalNodes}`);
  assert(graphRes.body.totalEdges > 50, `Expected 50+ edges, got ${graphRes.body.totalEdges}`);
  assert(graphRes.body.counts.agents >= 68, `Graph must include at least 68 agents, got ${graphRes.body.counts.agents}`);
  assert.strictEqual(graphRes.body.counts.skills, 286, 'Graph must include 286 skills');
  assert.strictEqual(graphRes.body.counts.commands, 94, 'Graph must include 94 commands');

  // Verify node structure
  const sampleAgent = graphRes.body.nodes.find(n => n.type === 'agent');
  assert(sampleAgent, 'Agent node should exist');
  assert(sampleAgent.id.startsWith('agent:'), 'Agent ID must be prefixed');
  assert(sampleAgent.category === 'Agents');

  // Verify edge structure
  const sampleEdge = graphRes.body.edges[0];
  assert(sampleEdge.source && sampleEdge.target && sampleEdge.type);
  console.log(`  PASS: Knowledge Graph verified: ${graphRes.body.totalNodes} nodes, ${graphRes.body.totalEdges} edges`);

  // 2. Filesystem Tree Verification
  console.log('[Test] 2. Verifying /api/fs/tree directory explorer...');
  const treeRes = await dispatch(serverInstance, 'GET', '/api/fs/tree');
  assert.strictEqual(treeRes.status, 200);
  assert(Array.isArray(treeRes.body.tree), 'Filesystem tree must be an array');
  const topDirs = treeRes.body.tree.map(t => t.name);
  assert(topDirs.includes('agents'), 'Must include agents directory');
  assert(topDirs.includes('skills'), 'Must include skills directory');
  assert(topDirs.includes('packages'), 'Must include packages directory');
  assert(!topDirs.includes('node_modules'), 'node_modules must be excluded from tree');
  console.log('  PASS: Filesystem tree verified: top directories include', topDirs.slice(0, 5).join(', '));

  // 3. Filesystem File Read & Security Sandbox Check
  console.log('[Test] 3. Verifying /api/fs/read and sandbox containment...');
  const readRes = await dispatch(serverInstance, 'GET', '/api/fs/read?path=package.json');
  assert.strictEqual(readRes.status, 200);
  assert(readRes.body.content.includes('"name": "oas-universal"'));
  assert(readRes.body.lines > 10);
  assert.strictEqual(readRes.body.extension, '.json');

  // Path traversal attempt check
  const traversalRes = await dispatch(serverInstance, 'GET', '/api/fs/read?path=../../../../etc/passwd');
  assert.strictEqual(traversalRes.status, 400, 'Must reject path traversal outside sandbox');
  console.log('  PASS: File read & sandbox isolation verified');

  // 4. Platform Settings Persistence
  console.log('[Test] 4. Verifying /api/settings GET and POST...');
  const settingsGet = await dispatch(serverInstance, 'GET', '/api/settings');
  assert.strictEqual(settingsGet.status, 200);
  assert(typeof settingsGet.body.sandboxEnabled === 'boolean');

  const updateRes = await dispatch(serverInstance, 'POST', '/api/settings', {
    provider: 'ollama',
    ollamaHost: 'http://localhost:11434',
    defaultModel: 'llama3.3:latest'
  });
  assert.strictEqual(updateRes.status, 200);
  assert.strictEqual(updateRes.body.provider, 'ollama');
  assert.strictEqual(updateRes.body.defaultModel, 'llama3.3:latest');
  console.log('  PASS: Settings persistence verified');

  // 5. Session Lifecycle CRUD & Export
  console.log('[Test] 5. Verifying Multi-Session Lifecycle CRUD...');
  // Create
  const createRes = await dispatch(serverInstance, 'POST', '/api/sessions', {
    id: 'sess_test_full_platform',
    title: 'Platform Upgrade Session',
    lead_agent_id: 'planner'
  });
  assert.strictEqual(createRes.status, 201);
  assert.strictEqual(createRes.body.id, 'sess_test_full_platform');

  // List & annotate
  const listRes = await dispatch(serverInstance, 'GET', '/api/sessions');
  assert.strictEqual(listRes.status, 200);
  const found = listRes.body.find(s => s.id === 'sess_test_full_platform');
  assert(found, 'Created session should appear in list');
  assert(typeof found.stepCount === 'number');

  // Single session details
  const detailRes = await dispatch(serverInstance, 'GET', '/api/sessions/sess_test_full_platform');
  assert.strictEqual(detailRes.status, 200);
  assert.strictEqual(detailRes.body.session.title, 'Platform Upgrade Session');

  // Rename
  const renameRes = await dispatch(serverInstance, 'POST', '/api/sessions/sess_test_full_platform/rename', {
    title: 'Renamed Platform Session'
  });
  assert.strictEqual(renameRes.status, 200);
  assert.strictEqual(renameRes.body.session.title, 'Renamed Platform Session');

  // Export
  const exportRes = await dispatch(serverInstance, 'GET', '/api/sessions/sess_test_full_platform/export');
  assert.strictEqual(exportRes.status, 200);
  assert(exportRes.body.markdown.includes('# Session Transcript: Renamed Platform Session'));

  // Delete
  const deleteRes = await dispatch(serverInstance, 'DELETE', '/api/sessions/sess_test_full_platform');
  assert.strictEqual(deleteRes.status, 200);
  assert.strictEqual(deleteRes.body.success, true);

  const postDeleteDetail = await dispatch(serverInstance, 'GET', '/api/sessions/sess_test_full_platform');
  assert.strictEqual(postDeleteDetail.status, 404);
  console.log('  PASS: Session lifecycle CRUD & transcript export verified');

  // 6. Memory Vault Verification
  console.log('[Test] 6. Verifying /api/memory query, creation, and deletion...');
  const memListRes = await dispatch(serverInstance, 'GET', '/api/memory');
  assert.strictEqual(memListRes.status, 200);
  assert(Array.isArray(memListRes.body), 'Memory vault must return array');
  assert(memListRes.body.length > 0, 'Memory vault should contain seeded memories');

  // Query filter
  const queryRes = await dispatch(serverInstance, 'GET', '/api/memory?query=immutability');
  assert.strictEqual(queryRes.status, 200);
  assert(queryRes.body.length > 0, 'Query search should match immutability memory');

  // Create new memory
  const createMemRes = await dispatch(serverInstance, 'POST', '/api/memory', {
    title: 'Test Integration Policy',
    scope: 'team',
    kind: 'policy',
    body: 'Automated test suite assertions must pass 100% before commit.'
  });
  assert.strictEqual(createMemRes.status, 201);
  assert(createMemRes.body.id.startsWith('mem_'));
  const newMemId = createMemRes.body.id;

  // Delete memory
  const deleteMemRes = await dispatch(serverInstance, 'DELETE', `/api/memory/${newMemId}`);
  assert.strictEqual(deleteMemRes.status, 200);
  assert.strictEqual(deleteMemRes.body.success, true);
  console.log('  PASS: Memory Vault query, creation, and deletion verified');

  // 7. Plan Artifacts Verification
  console.log('[Test] 7. Verifying /api/artifacts plan management & updates...');
  const artListRes = await dispatch(serverInstance, 'GET', '/api/artifacts');
  assert.strictEqual(artListRes.status, 200);
  assert(Array.isArray(artListRes.body), 'Artifacts must return array');
  const planArt = artListRes.body.find(a => a.artifact_type === 'plan');
  assert(planArt, 'Seeded plan artifact must exist');

  // Update plan phases
  const updatedPhases = [
    ...(planArt.phases || []),
    { id: 'p_test', title: 'Phase Test', description: 'Test Phase', completed: true }
  ];
  const updateArtRes = await dispatch(serverInstance, 'PUT', `/api/artifacts/${planArt.id}`, {
    phases: updatedPhases
  });
  assert.strictEqual(updateArtRes.status, 200);
  assert.strictEqual(updateArtRes.body.phases.length, updatedPhases.length);
  console.log('  PASS: Plan Artifacts management and updates verified');

  // 8. Telemetry Verification
  console.log('[Test] 8. Verifying /api/telemetry real-time statistics...');
  const telemRes = await dispatch(serverInstance, 'GET', '/api/telemetry');
  assert.strictEqual(telemRes.status, 200);
  assert.strictEqual(telemRes.body.status, 'HEALTHY');
  assert(typeof telemRes.body.uptime === 'number');
  assert(typeof telemRes.body.memoryUtilizationMb === 'number');
  assert(telemRes.body.totalAgents >= 68, `Expected at least 68 agents, got ${telemRes.body.totalAgents}`);
  assert.strictEqual(telemRes.body.totalSkills, 286);
  assert.strictEqual(telemRes.body.totalCommands, 94);
  console.log(`  PASS: Telemetry verified: ${telemRes.body.memoryUtilizationMb} MB Heap, ${telemRes.body.totalAgents} Agents, status ${telemRes.body.status}`);

  console.log('\nPASS: ALL FULL-PLATFORM API TESTS PASSED WITH 100% SUCCESS!\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
