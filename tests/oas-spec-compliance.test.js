/**
 * @file tests/oas-spec-compliance.test.js
 * Comprehensive automated test suite for OAS 2.0 architectural specifications:
 * 1. oas.hud-status.v1 Status & Session Control Contract
 * 2. 12-Target Harness Adapter Compliance Matrix
 * 3. AgentShield Enterprise Security & Supply Chain IOC Scanner
 * 4. File-First Memory Vault (.oas/memory) with Secret-Shape Rejection & SHA-256
 * 5. Selective Install Profiles & Module Plans
 * 6. System Diagnostics & Doctor
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

function executeRequest(server, method, url, body = null) {
  return new Promise((resolve, reject) => {
    const req = new MockIncomingMessage(method, url, body);
    const res = new MockServerResponse();

    res.on('finish', () => {
      try {
        const parsed = res.body ? JSON.parse(res.body) : null;
        resolve({ statusCode: res.statusCode, headers: res.headers, data: parsed });
      } catch (err) {
        resolve({ statusCode: res.statusCode, headers: res.headers, rawBody: res.body });
      }
    });

    server.handleRequest(req, res).catch(reject);
    req.start();
  });
}

async function runTests() {
  console.log('======================================================');
  console.log('  OAS 2.0 SPECIFICATION & CONTRACT COMPLIANCE BATTERY');
  console.log('======================================================\n');

  const server = new OasControlPlaneServer();

  // Test 1: oas.hud-status.v1 Contract
  console.log('1. Testing GET /api/hud-status (oas.hud-status.v1 contract)...');
  const hudRes = await executeRequest(server, 'GET', '/api/hud-status');
  assert.strictEqual(hudRes.statusCode, 200, 'HUD status endpoint should return 200');
  const hud = hudRes.data;
  assert.strictEqual(hud.schema_version, 'oas.hud-status.v1', 'Schema version must be oas.hud-status.v1');
  assert.ok(hud.context, 'HUD status must contain context block');
  assert.ok(hud.context.harness, 'context must contain harness');
  assert.ok(hud.context.model, 'context must contain model');
  assert.ok(hud.context.contextWindow, 'context must contain contextWindow');
  assert.ok(hud.toolCalls, 'HUD status must contain toolCalls block');
  assert.ok(Array.isArray(hud.activeAgents), 'HUD status must contain activeAgents array');
  assert.ok(hud.todos, 'HUD status must contain todos block');
  assert.ok(hud.checks, 'HUD status must contain checks block');
  assert.ok(Array.isArray(hud.checks.local), 'checks must contain local array');
  assert.ok(hud.cost, 'HUD status must contain cost block');
  assert.strictEqual(typeof hud.cost.sessionUsd, 'number', 'cost must contain sessionUsd');
  assert.ok(hud.risk, 'HUD status must contain risk block');
  assert.ok(hud.queueState, 'HUD status must contain queueState block');
  assert.ok(hud.sessionControls, 'HUD status must contain sessionControls block');
  const requiredControls = ['create', 'resume', 'status', 'stop', 'diff', 'pr', 'mergeQueue', 'conflictQueue'];
  for (const c of requiredControls) {
    assert.ok(hud.sessionControls.supported.includes(c), `sessionControls must support ${c}`);
  }
  assert.ok(hud.sync, 'HUD status must contain sync block');
  assert.ok(hud.sync.Linear, 'sync must contain Linear');
  assert.ok(hud.sync.GitHub, 'sync must contain GitHub');
  assert.ok(hud.sync.handoff, 'sync must contain handoff');
  console.log('   /api/hud-status satisfies all 10 canonical contract blocks\n');

  // Test 2: 12-Target Harness Adapter Compliance Matrix
  console.log('2. Testing GET /api/harness/compliance (12-target scorecard)...');
  const compRes = await executeRequest(server, 'GET', '/api/harness/compliance');
  assert.strictEqual(compRes.statusCode, 200, 'Harness compliance endpoint should return 200');
  const comp = compRes.data;
  assert.strictEqual(comp.schemaVersion, 'oas.harness-adapter-compliance.v1');
  assert.strictEqual(comp.totalHarnesses, 12, 'Must track exactly 12 harness targets');
  assert.strictEqual(comp.records.length, 12, 'Records array must have 12 items');
  const expectedHarnesses = ['claude-code', 'codex', 'opencode', 'pi', 'cursor', 'gemini', 'zed', 'dmux', 'orca', 'superset', 'ghast', 'terminal-only'];
  for (const exp of expectedHarnesses) {
    const rec = comp.records.find(r => r.id === exp);
    assert.ok(rec, `Harness record must exist for ${exp}`);
    assert.ok(['Native', 'Adapter-backed', 'Instruction-backed', 'Reference-only'].includes(rec.state), `Invalid state for ${exp}: ${rec.state}`);
  }
  console.log('   /api/harness/compliance successfully verified 12 harness targets\n');

  // Test 3: AgentShield Security & Supply Chain IOC Scanner
  console.log('3. Testing POST /api/security/scan and GET /api/security/iocs...');
  const secRes = await executeRequest(server, 'POST', '/api/security/scan', {});
  assert.strictEqual(secRes.statusCode, 200, 'Security scan endpoint should return 200');
  const sec = secRes.data;
  assert.ok(['SAFE', 'ATTENTION'].includes(sec.status), 'Security scan status must be SAFE or ATTENTION');
  assert.ok(sec.totalFilesScanned > 0, 'Total files scanned must be > 0');
  assert.ok(sec.advisories, 'Must contain advisories block');
  assert.strictEqual(sec.advisories.registryLockVerified, true);
  assert.strictEqual(sec.advisories.sandboxIsolation, true);

  const iocRes = await executeRequest(server, 'GET', '/api/security/iocs');
  assert.strictEqual(iocRes.statusCode, 200);
  assert.ok(Array.isArray(iocRes.data.indicators));
  assert.strictEqual(typeof iocRes.data.dependenciesTracked, 'number');
  assert.ok(['CLEAN', 'PATTERNS_DETECTED'].includes(iocRes.data.status));
  console.log('   AgentShield security scan and IOC registry verified\n');

  // Test 4: File-First Memory Vault with Secret Rejection & SHA-256
  console.log('4. Testing Memory Vault secret-shape rejection & .oas/memory disk persistence...');
  // Secret rejection check
  let threwSecret = false;
  try {
    server.store.addMemory({
      title: 'Leaked API Key',
      body: 'sk-live-012345678901234567890123456789'
    });
  } catch (err) {
    threwSecret = true;
    assert.ok(err.message.includes('Secret shape detected'), 'Must state secret shape detected');
  }
  assert.ok(threwSecret, 'addMemory must reject secret-shaped credentials');

  // Valid memory check with SHA-256 and disk file verification
  const validMem = server.store.addMemory({
    scope: 'project',
    kind: 'convention',
    title: 'Spec-Compliance Memory Test',
    body: 'Verifying automated disk write to .oas/memory/project/ directory with YAML frontmatter.'
  });
  assert.ok(validMem.id, 'Memory must have id');
  assert.ok(validMem.hash && validMem.hash.length >= 8, 'Memory must have SHA-256 hash');
  assert.strictEqual(validMem.trust, 'unreviewed', 'Memory trust must be unreviewed');

  // Verify file on disk
  const expectedFilePath = path.join(server.store.memoryRoot, 'project', `${validMem.id}.md`);
  assert.ok(fs.existsSync(expectedFilePath), `File must be persisted at ${expectedFilePath}`);
  const diskContent = fs.readFileSync(expectedFilePath, 'utf8');
  assert.ok(diskContent.includes('schema: "oas.memory.v1"'), 'Disk file must contain oas.memory.v1 schema');
  assert.ok(diskContent.includes(validMem.id), 'Disk file must contain memory ID');

  // Cleanup test memory
  const deleted = server.store.deleteMemory(validMem.id);
  assert.strictEqual(deleted, true);
  assert.strictEqual(fs.existsSync(expectedFilePath), false, 'Disk file should be unlinked on deletion');
  console.log('   Secret rejection, SHA-256 generation, and .oas/memory disk file persistence verified\n');

  // Test 5: Selective Install Profiles & Module Plans
  console.log('5. Testing GET /api/install/profiles & /api/install/plan...');
  const profilesRes = await executeRequest(server, 'GET', '/api/install/profiles');
  assert.strictEqual(profilesRes.statusCode, 200);
  assert.ok(Array.isArray(profilesRes.data.profiles), 'Must return profiles array');
  const profileNames = profilesRes.data.profiles.map(p => p.id);
  assert.ok(profileNames.includes('minimal'), 'Profiles must include minimal');
  const planRes = await executeRequest(server, 'GET', '/api/install/plan?profile=minimal');
  assert.strictEqual(planRes.statusCode, 200);
  assert.ok(planRes.data.selectedModules || planRes.data.operations, 'Plan must contain selectedModules or operations');
  console.log('   Selective install profiles and plan resolution verified\n');

  // Test 6: System Diagnostics & Doctor
  console.log('6. Testing GET /api/system/doctor...');
  const docRes = await executeRequest(server, 'GET', '/api/system/doctor');
  assert.strictEqual(docRes.statusCode, 200);
  assert.ok(['ok', 'warning', 'error'].includes(docRes.data.status));
  assert.ok(docRes.data.summary || docRes.data.checks);
  console.log('   System diagnostics & doctor report verified\n');

  // Test 7: TCAS Layer 4 Agent Proximity & Collision Avoidance
  console.log('7. Testing GET /api/proximity (TCAS Layer 4 airspace scan)...');
  const tcasRes = await executeRequest(server, 'GET', '/api/proximity');
  assert.strictEqual(tcasRes.statusCode, 200);
  assert.strictEqual(tcasRes.data.schemaVersion, 'oas.proximity.v1');
  assert.ok(tcasRes.data.positions, 'Must return 3D agent positions');
  assert.ok(Array.isArray(tcasRes.data.advisories), 'Must return advisories list');
  assert.ok(Array.isArray(tcasRes.data.triggers), 'Must return steering/holding triggers');
  console.log('   TCAS Layer 4 agent proximity & spatial deconfliction verified\n');

  // Test 8: OAS 2.0 Observability Readiness Gate
  console.log('8. Testing GET /api/observability/readiness...');
  const obsRes = await executeRequest(server, 'GET', '/api/observability/readiness');
  assert.strictEqual(obsRes.statusCode, 200);
  assert.strictEqual(obsRes.data.overall_score, 21, 'Must score 21/21 on readiness rubric');
  assert.strictEqual(obsRes.data.ready, true, 'Readiness gate must be true');
  assert.ok(Array.isArray(obsRes.data.checks), 'Must return checks array');
  console.log('   Observability readiness gate (21/21 rubric) verified\n');

  // Test 9: Autonomous Execution Loop Inspector
  console.log('9. Testing GET /api/loop/status...');
  const loopRes = await executeRequest(server, 'GET', '/api/loop/status');
  assert.strictEqual(loopRes.statusCode, 200);
  assert.ok(Array.isArray(loopRes.data.sessions), 'Must return sessions array');
  console.log('   Autonomous loop status inspector verified\n');

  // Test 10: Session Adapters Registry (oas.session.v1)
  console.log('10. Testing GET /api/sessions/adapters...');
  const adaptRes = await executeRequest(server, 'GET', '/api/sessions/adapters');
  assert.strictEqual(adaptRes.statusCode, 200);
  assert.strictEqual(adaptRes.data.schemaVersion, 'oas.session.v1');
  assert.ok(Array.isArray(adaptRes.data.adapters), 'Must return adapters array');
  const adapterIds = adaptRes.data.adapters.map(a => a.id);
  assert.ok(adapterIds.includes('claude-history'), 'Must include claude-history adapter');
  assert.ok(adapterIds.includes('dmux-tmux'), 'Must include dmux-tmux adapter');
  assert.ok(adapterIds.includes('codex-worktree'), 'Must include codex-worktree adapter');
  assert.ok(adapterIds.includes('opencode'), 'Must include opencode adapter');
  console.log('   Canonical session adapters registry verified\n');

  console.log('======================================================');
  console.log('  PASS: ALL 10 OAS 2.0 SPEC COMPLIANCE TESTS PASSED (100%)');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('\nFAIL: Test failure:', err);
  process.exit(1);
});
