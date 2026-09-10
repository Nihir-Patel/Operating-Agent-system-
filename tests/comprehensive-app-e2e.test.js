/**
 * @file tests/comprehensive-app-e2e.test.js
 * Comprehensive End-to-End Functional Test Suite for OAS Studio & Cloud Control Plane.
 * Validates all 18 functional subsystems and verified user flows.
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
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      } catch {
        resolve({ status: res.statusCode, raw: res.body, headers: res.headers });
      }
    });

    serverInstance.handleRequest(req, res).catch(reject);
    req.start();
  });
}

async function runComprehensiveE2EBattery() {
  console.log('\n======================================================');
  console.log('  OAS STUDIO IN-DEPTH END-TO-END FUNCTIONAL BATTERY   ');
  console.log('======================================================\n');

  const server = new OasControlPlaneServer({
    port: 0,
    workspaceRoot: path.resolve(__dirname, '..')
  });

  let totalTests = 0;
  let passedTests = 0;

  function test(name, fn) {
    totalTests++;
    try {
      fn();
      passedTests++;
      console.log(`  ✔ [PASS] ${name}`);
    } catch (err) {
      console.error(`  ✖ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    totalTests++;
    try {
      await fn();
      passedTests++;
      console.log(`  ✔ [PASS] ${name}`);
    } catch (err) {
      console.error(`  ✖ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // ----------------------------------------------------
  // 1. CATALOG & ENTITY REGISTRY
  // ----------------------------------------------------
  console.log('--- 1. Catalog & Entity Registry ---');
  await testAsync('GET /api/catalog returns all indexed assets', async () => {
    const res = await dispatch(server, 'GET', '/api/catalog');
    assert.strictEqual(res.status, 200);
    assert(res.body.agents.length >= 68, `Expected >= 68 agents, got ${res.body.agents.length}`);
    assert(res.body.skills.length >= 280, `Expected >= 280 skills, got ${res.body.skills.length}`);
    assert(res.body.commands.length >= 90, `Expected >= 90 commands, got ${res.body.commands.length}`);
  });

  await testAsync('GET /api/agents returns structured agent definitions', async () => {
    const res = await dispatch(server, 'GET', '/api/agents');
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body));
    const planner = res.body.find(a => a.id === 'planner');
    assert(planner, 'Planner agent must exist');
    assert(planner.description, 'Planner must have description');
  });

  // ----------------------------------------------------
  // 2. KNOWLEDGE GRAPH
  // ----------------------------------------------------
  console.log('\n--- 2. Knowledge Graph Relational Ontology ---');
  await testAsync('GET /api/graph returns full ontology with nodes, edges & delegations', async () => {
    const res = await dispatch(server, 'GET', '/api/graph');
    assert.strictEqual(res.status, 200);
    assert(res.body.nodes.length > 400, 'Nodes count must exceed 400');
    assert(res.body.edges.length > 100, 'Edges count must exceed 100');
    assert(res.body.counts.agents >= 68);
    assert(res.body.counts.skills >= 280);
    assert(res.body.counts.commands >= 90);

    const hasDelegation = res.body.edges.some(e => e.type === 'delegates_to');
    assert(hasDelegation, 'Must have agent-to-agent delegation edges');
  });

  // ----------------------------------------------------
  // 3. WORKSPACE FILESYSTEM & SANDBOX
  // ----------------------------------------------------
  console.log('\n--- 3. Workspace Filesystem & Sandbox Isolation ---');
  await testAsync('GET /api/fs/tree returns valid folder structure without node_modules', async () => {
    const res = await dispatch(server, 'GET', '/api/fs/tree');
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.tree));
    const hasAgents = res.body.tree.some(f => f.name === 'agents' && f.type === 'directory');
    assert(hasAgents, 'Must include agents directory');
    const hasNodeModules = res.body.tree.some(f => f.name === 'node_modules');
    assert(!hasNodeModules, 'Must exclude node_modules');
  });

  await testAsync('GET /api/fs/read successfully reads legitimate project files', async () => {
    const res = await dispatch(server, 'GET', '/api/fs/read?path=package.json');
    assert.strictEqual(res.status, 200);
    assert(res.body.content.includes('"name": "oas-universal"'));
    assert(res.body.extension === '.json');
  });

  await testAsync('GET /api/fs/read rejects path traversal outside sandbox', async () => {
    const res = await dispatch(server, 'GET', '/api/fs/read?path=../../../../etc/hosts');
    assert.strictEqual(res.status, 400);
    assert(res.body.error);
  });

  // ----------------------------------------------------
  // 4. MULTI-SESSION LIFECYCLE CRUD
  // ----------------------------------------------------
  console.log('\n--- 4. Multi-Session Lifecycle CRUD ---');
  let testSessionId = null;

  await testAsync('POST /api/sessions creates a new session with lead agent', async () => {
    const res = await dispatch(server, 'POST', '/api/sessions', {
      title: 'Functional Test Pipeline Session',
      lead_agent_id: 'planner',
      pipelineType: 'feature_lifecycle'
    });
    assert.strictEqual(res.status, 201);
    assert(res.body.id);
    assert.strictEqual(res.body.title, 'Functional Test Pipeline Session');
    testSessionId = res.body.id;
  });

  await testAsync('GET /api/sessions lists created session', async () => {
    const res = await dispatch(server, 'GET', '/api/sessions');
    assert.strictEqual(res.status, 200);
    const found = res.body.find(s => s.id === testSessionId);
    assert(found, 'Created session must be returned in list');
  });

  await testAsync('PATCH /api/sessions/:id updates session title', async () => {
    const res = await dispatch(server, 'PATCH', `/api/sessions/${testSessionId}`, {
      title: 'Renamed Functional Pipeline'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.title, 'Renamed Functional Pipeline');
  });

  await testAsync('GET /api/sessions/:id/steps returns steps array', async () => {
    const res = await dispatch(server, 'GET', `/api/sessions/${testSessionId}/steps`);
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.steps));
  });

  await testAsync('GET /api/sessions/:id/export exports session transcript', async () => {
    const res = await dispatch(server, 'GET', `/api/sessions/${testSessionId}/export`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.session_id, testSessionId);
    assert(res.body.transcript);
  });

  // ----------------------------------------------------
  // 5. HUMAN-IN-THE-LOOP (HITL) INTERVENTION ENGINE
  // ----------------------------------------------------
  console.log('\n--- 5. Human-In-The-Loop (HITL) Intervention Engine ---');
  await testAsync('POST /api/sessions/:id/intervene handles pause, feedback, and resume', async () => {
    // Pause
    const pauseRes = await dispatch(server, 'POST', `/api/sessions/${testSessionId}/intervene`, {
      action: 'pause'
    });
    assert.strictEqual(pauseRes.status, 200);
    assert.strictEqual(pauseRes.body.status, 'paused');

    // Feedback
    const fbRes = await dispatch(server, 'POST', `/api/sessions/${testSessionId}/intervene`, {
      action: 'feedback',
      feedback: 'Ensure security scans pass before deployment'
    });
    assert.strictEqual(fbRes.status, 200);

    // Resume
    const resumeRes = await dispatch(server, 'POST', `/api/sessions/${testSessionId}/intervene`, {
      action: 'resume'
    });
    assert.strictEqual(resumeRes.status, 200);
    assert.strictEqual(resumeRes.body.status, 'running');
  });

  // ----------------------------------------------------
  // 6. CRYPTOGRAPHIC OAS MEMORY VAULT
  // ----------------------------------------------------
  console.log('\n--- 6. Cryptographic OAS Memory Vault ---');
  let memoryKey = `test:item:${Date.now()}`;
  let memoryId = null;

  await testAsync('POST /api/memory creates memory item with SHA-256 integrity', async () => {
    const res = await dispatch(server, 'POST', '/api/memory', {
      key: memoryKey,
      content: 'Contract-verified architectural guideline for OAS 2.0',
      category: 'architecture',
      scope: 'project',
      tags: ['e2e', 'spec']
    });
    assert.strictEqual(res.status, 201);
    assert(res.body.id);
    assert(res.body.sha256);
    assert.strictEqual(res.body.key, memoryKey);
    memoryId = res.body.id;
  });

  await testAsync('POST /api/memory rejects secret-shaped inputs (API Keys)', async () => {
    const res = await dispatch(server, 'POST', '/api/memory', {
      key: 'leak:test',
      content: 'sk-ant-api03-abcdef1234567890abcdef1234567890abcdef',
      category: 'credentials'
    });
    assert.strictEqual(res.status, 400);
    assert(res.body.error.includes('Secret-shaped token detected'));
  });

  await testAsync('GET /api/memory queries stored item by tag or query', async () => {
    const res = await dispatch(server, 'GET', `/api/memory?query=architectural`);
    assert.strictEqual(res.status, 200);
    const memories = Array.isArray(res.body) ? res.body : (res.body.memories || []);
    assert(Array.isArray(memories));
    const found = memories.find(m => m.id === memoryId);
    assert(found, 'Stored memory must be discoverable via query');
  });

  await testAsync('DELETE /api/memory/:id removes memory item', async () => {
    const res = await dispatch(server, 'DELETE', `/api/memory/${memoryId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(Boolean(res.body.success || res.body.deleted), true);
  });

  // ----------------------------------------------------
  // 7. PLAN CANVAS & SRS SPEC ARTIFACTS
  // ----------------------------------------------------
  console.log('\n--- 7. Plan Canvas & SRS Document Editor ---');
  let artifactId = null;

  await testAsync('POST /api/artifacts creates SRS plan artifact', async () => {
    const res = await dispatch(server, 'POST', '/api/artifacts', {
      title: 'E2E Capability Roadmap',
      status: 'in_progress',
      phases: [
        { id: 'p1', title: 'Phase 1: Invariant Discovery', status: 'completed' },
        { id: 'p2', title: 'Phase 2: Contract Execution', status: 'in_progress' }
      ]
    });
    assert.strictEqual(res.status, 201);
    assert(res.body.id);
    artifactId = res.body.id;
  });

  await testAsync('PUT /api/artifacts/:id updates plan phases and annotations', async () => {
    const res = await dispatch(server, 'PUT', `/api/artifacts/${artifactId}`, {
      title: 'E2E Capability Roadmap (Updated)',
      phases: [
        { id: 'p1', title: 'Phase 1: Invariant Discovery', status: 'completed' },
        { id: 'p2', title: 'Phase 2: Contract Execution', status: 'completed' },
        { id: 'p3', title: 'Phase 3: Formal Verification', status: 'in_progress' }
      ]
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.phases.length, 3);
  });

  // ----------------------------------------------------
  // 8. SLASH COMMAND EXECUTION ENGINE
  // ----------------------------------------------------
  console.log('\n--- 8. Slash Command Execution Engine ---');
  await testAsync('POST /api/commands/execute executes slash commands', async () => {
    const res = await dispatch(server, 'POST', '/api/commands/execute', {
      command: '/test',
      args: ['--coverage']
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.output || res.body.status === 'success');
  });

  // ----------------------------------------------------
  // 9. WORKTREE LIFECYCLE & BRANCH MANAGEMENT
  // ----------------------------------------------------
  console.log('\n--- 9. Worktree Lifecycle & Branch Switching ---');
  await testAsync('GET /api/worktree/branches returns active branches', async () => {
    const res = await dispatch(server, 'GET', '/api/worktree/branches');
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.branches));
    assert(res.body.activeBranch);
  });

  // ----------------------------------------------------
  // 10. HUD STATUS CONTRACT (oas.hud-status.v1)
  // ----------------------------------------------------
  console.log('\n--- 10. HUD Status Spec Contract ---');
  await testAsync('GET /api/hud-status satisfies all 10 canonical contract blocks', async () => {
    const res = await dispatch(server, 'GET', '/api/hud-status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.schema_version, 'oas.hud-status.v1');
    assert(res.body.context);
    assert(res.body.toolCalls);
    assert(res.body.activeAgents);
    assert(res.body.todos);
    assert(res.body.checks);
    assert(res.body.cost);
    assert(res.body.risk);
    assert(res.body.sync);
  });

  // ----------------------------------------------------
  // 11. HARNESS ADAPTER COMPLIANCE SCORECARD
  // ----------------------------------------------------
  console.log('\n--- 11. Harness Adapter Compliance Scorecard ---');
  await testAsync('GET /api/harness/compliance validates 12 runtime targets', async () => {
    const res = await dispatch(server, 'GET', '/api/harness/compliance');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalHarnesses, 12);
    assert(Array.isArray(res.body.records));
    assert.strictEqual(res.body.records.length, 12);
  });

  // ----------------------------------------------------
  // 12. AGENTSHIELD SECURITY & ZERO-DAY SCAN
  // ----------------------------------------------------
  console.log('\n--- 12. AgentShield Security & IOC Scan ---');
  await testAsync('POST /api/security/scan audits manifests and returns posture', async () => {
    const res = await dispatch(server, 'POST', '/api/security/scan', {});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'SAFE');
    assert(res.body.totalFilesScanned > 0);
  });

  await testAsync('GET /api/security/iocs returns active threat registry', async () => {
    const res = await dispatch(server, 'GET', '/api/security/iocs');
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.indicators));
  });

  // ----------------------------------------------------
  // 13. TCAS LAYER 4: AIRSPACE DECONFLICTION
  // ----------------------------------------------------
  console.log('\n--- 13. TCAS Layer 4 Spatial Deconfliction ---');
  await testAsync('GET /api/proximity computes 3D code coordinates & deconfliction', async () => {
    const res = await dispatch(server, 'GET', '/api/proximity');
    assert.strictEqual(res.status, 200);
    assert(res.body.positions);
    assert(Array.isArray(res.body.advisories));
    assert(typeof res.body.counts.agents === 'number');
  });

  // ----------------------------------------------------
  // 14. OBSERVABILITY READINESS GATE (21-POINT RUBRIC)
  // ----------------------------------------------------
  console.log('\n--- 14. Observability Readiness Gate ---');
  await testAsync('GET /api/observability/readiness evaluates deterministic rubric', async () => {
    const res = await dispatch(server, 'GET', '/api/observability/readiness');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.overall_score, 21);
    assert.strictEqual(res.body.max_score, 21);
    assert(res.body.categories);
    assert(Array.isArray(res.body.checks));
    assert(res.body.checks.length >= 10);
  });

  // ----------------------------------------------------
  // 15. SYSTEM DIAGNOSTICS & DOCTOR
  // ----------------------------------------------------
  console.log('\n--- 15. System Diagnostics & Doctor ---');
  await testAsync('GET /api/system/doctor returns environment diagnostic checks', async () => {
    const res = await dispatch(server, 'GET', '/api/system/doctor');
    assert.strictEqual(res.status, 200);
    assert(res.body.status);
    assert(Array.isArray(res.body.checks || res.body.results));
  });

  // ----------------------------------------------------
  // 16. SELECTIVE INSTALL PLANNER & PROFILES
  // ----------------------------------------------------
  console.log('\n--- 16. Selective Install Planner & Profiles ---');
  await testAsync('GET /api/install/profiles returns Daily vs Library profiles', async () => {
    const res = await dispatch(server, 'GET', '/api/install/profiles');
    assert.strictEqual(res.status, 200);
    assert(res.body.profiles);
  });

  await testAsync('GET /api/install/plan resolves installation plan for repo', async () => {
    const res = await dispatch(server, 'GET', '/api/install/plan');
    assert.strictEqual(res.status, 200);
    assert(res.body.selectedModules || res.body.operations || res.body.plan || res.body.profileId);
  });

  // ----------------------------------------------------
  // 17. AUTONOMOUS LOOP INSPECTOR & SESSION ADAPTERS
  // ----------------------------------------------------
  console.log('\n--- 17. Autonomous Loop & Session Adapters ---');
  await testAsync('GET /api/loop/status returns loop telemetry and safety limits', async () => {
    const res = await dispatch(server, 'GET', '/api/loop/status');
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.sessions) || res.body.loopStatus);
  });

  await testAsync('GET /api/sessions/adapters returns universal adapter registry', async () => {
    const res = await dispatch(server, 'GET', '/api/sessions/adapters');
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.adapters));
    assert(res.body.adapters.length >= 4);
  });

  // ----------------------------------------------------
  // 18. PLATFORM SETTINGS PERSISTENCE
  // ----------------------------------------------------
  console.log('\n--- 18. Platform Settings Persistence ---');
  await testAsync('POST /api/settings saves provider configurations', async () => {
    const res = await dispatch(server, 'POST', '/api/settings', {
      provider: 'anthropic',
      defaultModel: 'claude-3-7-sonnet',
      sandboxEnabled: true,
      telemetrySharing: false
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.provider, 'anthropic');
    assert.strictEqual(res.body.defaultModel, 'claude-3-7-sonnet');
    assert.strictEqual(res.body.sandboxEnabled, true);
  });

  // ----------------------------------------------------
  // 19. DIRECTION A: IN-BROWSER FILE WRITE & UNIFIED DIFF
  // ----------------------------------------------------
  console.log('\n--- 19. Direction A: In-Browser File Write & Unified Diff ---');
  await testAsync('POST /api/fs/write writes safely within workspace boundaries', async () => {
    const testPath = 'tests/scratch/editor-verify.txt';
    const content = '// Direction A verified\nfunction hello() { return "oas"; }\n';
    const res = await dispatch(server, 'POST', '/api/fs/write', { path: testPath, content });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.path, testPath);

    // Verify it can be read back
    const readRes = await dispatch(server, 'GET', `/api/fs/read?path=${encodeURIComponent(testPath)}`);
    assert.strictEqual(readRes.status, 200);
    assert.strictEqual(readRes.body.content, content);
  });

  await testAsync('POST /api/fs/write rejects path traversal and forbidden targets', async () => {
    const res = await dispatch(server, 'POST', '/api/fs/write', { path: '../../../etc/passwd', content: 'hacked' });
    assert.strictEqual(res.status, 400);
    assert(res.body.error);
  });

  await testAsync('POST /api/fs/write rejects live SQLite database files', async () => {
    const res = await dispatch(server, 'POST', '/api/fs/write', { path: '.oas-database.sqlite', content: 'pwned' });
    assert.strictEqual(res.status, 400);
    assert(String(res.body.error || '').includes('Protected'));
  });

  await testAsync('POST /api/fs/diff computes unified diff between original and modified', async () => {
    const original = 'line 1\nline 2\nline 3\n';
    const modified = 'line 1\nline 2 (edited)\nline 3\nline 4\n';
    const res = await dispatch(server, 'POST', '/api/fs/diff', {
      path: 'sample.txt',
      original,
      modified
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.diff.includes('---'));
    assert(res.body.diff.includes('+++'));
    assert(res.body.additions >= 2);
    assert(res.body.deletions >= 1);
  });

  // ----------------------------------------------------
  // 20. DIRECTION B: TIME-TRAVEL HISTORICAL FORKING
  // ----------------------------------------------------
  console.log('\n--- 20. Direction B: Time-Travel Historical Forking ---');
  await testAsync('POST /api/sessions/:id/fork creates a new session branched at step K', async () => {
    // Add two test steps to testSessionId first
    server.store.addStep(testSessionId, { step_index: 1, step_type: 'thought', content: 'Initial planning step' });
    server.store.addStep(testSessionId, { step_index: 2, step_type: 'thought', content: 'TDD implementation step' });

    const forkRes = await dispatch(server, 'POST', `/api/sessions/${testSessionId}/fork`, {
      fromStep: 1,
      title: 'Branch at Step 1'
    });
    assert.strictEqual(forkRes.status, 201);
    assert.strictEqual(forkRes.body.success, true);
    assert.strictEqual(forkRes.body.forkedFromStep, 1);
    assert(forkRes.body.session.id);
    assert.strictEqual(forkRes.body.steps.length, 1);
    assert.strictEqual(forkRes.body.steps[0].content, 'Initial planning step');

    // Clean up forked session
    await dispatch(server, 'DELETE', `/api/sessions/${forkRes.body.session.id}`);
  });

  // ----------------------------------------------------
  // 21. DIRECTION C: SEMANTIC SEARCH, CYCLONEDX SBOM & AIPOM
  // ----------------------------------------------------
  console.log('\n--- 21. Direction C: Semantic Search, CycloneDX SBOM & AIPOM ---');
  await testAsync('GET /api/memory expands semantic aliases (test -> tdd/coverage)', async () => {
    const res = await dispatch(server, 'GET', '/api/memory?query=test');
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body));
    assert(res.body.length > 0);
    assert(res.body.some(m => m.semanticScore !== undefined));
  });

  await testAsync('GET /api/security/sbom returns standard CycloneDX v1.5 SBOM', async () => {
    const res = await dispatch(server, 'GET', '/api/security/sbom');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.bomFormat, 'CycloneDX');
    assert.strictEqual(res.body.specVersion, '1.5');
    assert(Array.isArray(res.body.components));
    assert(res.body.components.some(c => c.name === 'js-yaml'));
    assert.ok(!res.body.components.some(c => c.name === '@oas/engine'));
  });

  await testAsync('GET /api/security/aipom returns OAS AI Bill of Materials', async () => {
    const res = await dispatch(server, 'GET', '/api/security/aipom');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.schemaVersion, 'oas.aipom.v1');
    assert(Array.isArray(res.body.models));
    assert(res.body.models.length >= 4);
    assert(res.body.agents.count >= 60);
    assert(res.body.skills.count >= 200);
    assert.strictEqual(typeof res.body.guardrailPolicies.sandboxEnabled, 'boolean');
    assert.ok(!res.body.system.leadArchitect);
  });

  // ----------------------------------------------------
  // 22. DIRECTION D: ARENA MULTI-MODEL BENCHMARKING
  // ----------------------------------------------------
  console.log('\n--- 22. Direction D: Arena Multi-Model Benchmarking ---');
  await testAsync('POST /api/arena/compare evaluates models head-to-head with winners', async () => {
    const res = await dispatch(server, 'POST', '/api/arena/compare', {
      taskId: 'ready-token',
      prompt: 'Reply with the word READY',
      models: ['qwen2.5-coder:7b'],
      k: 1
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.benchmarkId);
    assert(Array.isArray(res.body.models));
    assert.strictEqual(res.body.models.length, 1);
    assert(res.body.winners.speedWinner);
    assert(res.body.winners.reasoningWinner);
    assert(res.body.winners.costEfficiencyWinner);

    const local = res.body.models.find(m => m.modelId === 'qwen2.5-coder:7b');
    assert(local);
    assert(local.latencyMs >= 0);
    assert.strictEqual(typeof local.passAtK, 'number');
    assert.strictEqual(local.scoringMethod, 'pass_at_k');
    assert.strictEqual(res.body.capability, 'eval-harness');
    assert(typeof local.codeSnippet === 'string');
  });

  // ----------------------------------------------------
  // 23. STEP 1: LIVE TERMINAL EXECUTION & AUTO-HEALING
  // ----------------------------------------------------
  console.log('\n--- 23. Step 1: Live Terminal & Autonomous Auto-Healing ---');
  await testAsync('POST /api/terminal/execute runs sandboxed commands safely', async () => {
    const res = await dispatch(server, 'POST', '/api/terminal/execute', {
      command: 'echo "OAS PTY ACTIVE"'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.exitCode, 0);
    assert(res.body.stdout.includes('OAS PTY ACTIVE'));
    assert(['seatbelt', 'policy-only'].includes(res.body.isolation));
    assert(res.body.durationMs >= 0);
  });

  await testAsync('POST /api/terminal/execute rejects dangerous commands outside sandbox', async () => {
    const res = await dispatch(server, 'POST', '/api/terminal/execute', {
      command: 'rm -rf /'
    });
    assert.strictEqual(res.status, 403);
    assert(res.body.dangerLevel === 'CRITICAL');
  });

  await testAsync('POST /api/loop/heal diagnoses error and generates surgical diff patch', async () => {
    const res = await dispatch(server, 'POST', '/api/loop/heal', {
      errorTrace: 'TypeError: Cannot read property "map" of undefined at apps/api/src/server.js:42:10',
      targetFile: 'apps/api/src/server.js',
      failedCommand: 'npm test',
      apply: false
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.resolved, true);
    assert.strictEqual(res.body.errorType, 'TypeError');
    assert(res.body.diff.includes('+++'));
    assert(res.body.patchSummary.includes('TypeError'));
    assert.strictEqual(res.body.verified, false);
  });

  // ----------------------------------------------------
  // 24. STEP 2: COUNCIL OF AGENTS CONSENSUS DEBATE
  // ----------------------------------------------------
  console.log('\n--- 24. Step 2: Multi-Agent Consensus Debate (Council of Agents) ---');
  await testAsync('POST /api/agents/council/deliberate orchestrates 4-agent deliberation', async () => {
    const res = await dispatch(server, 'POST', '/api/agents/council/deliberate', {
      topic: 'Transition to event-driven immutable architecture',
      mode: 'architecture'
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.councilId);
    assert.strictEqual(typeof res.body.consensusScore, 'number');
    assert.ok(res.body.consensusScore >= 0 && res.body.consensusScore <= 100);
    assert.strictEqual(res.body.rounds.length, 4);
    assert(res.body.participants.includes('architect'));
    assert(res.body.participants.includes('security-reviewer'));
    assert(res.body.participants.includes('tdd-guide'));
    assert(res.body.participants.includes('planner'));
    assert(res.body.ratifiedPlan.executionPhases.length >= 3);
  });

  // ----------------------------------------------------
  // 25. STEP 3: GIT CLOUD BRIDGE & GITHUB PR GENERATOR
  // ----------------------------------------------------
  console.log('\n--- 25. Step 3: Git Cloud Bridge & GitHub PR Generator ---');
  await testAsync('POST /api/git/pr/generate packages session diff into Conventional Commit PR', async () => {
    const res = await dispatch(server, 'POST', '/api/git/pr/generate', {
      branch: 'feat/frontier-enhancements',
      baseBranch: 'main',
      conventionalType: 'feat',
      title: 'Advance OAS Studio with Self-Healing, Council Debate, and 3D Topology'
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.prTitle.startsWith('feat(studio):'));
    assert(res.body.prBody.includes('CycloneDX SBOM'));
    assert(res.body.commitCommand.includes('git commit'));
    assert.strictEqual(typeof res.body.diffStats.filesChanged, 'number');
    assert.ok(res.body.diffStats.filesChanged >= 0);
  });

  await testAsync('POST /api/webhooks/github receives event and creates worker session', async () => {
    const res = await dispatch(server, 'POST', '/api/webhooks/github', {
      event: 'issues',
      action: 'labeled',
      label: 'agent-fix',
      issue: { number: 42, title: 'Fix intermittent timeout in test suite' }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.action, 'spawned_session');
    assert(res.body.sessionId);
    assert.strictEqual(res.body.assignedAgent, 'build-error-resolver');
    const session = server.store.getSession(res.body.sessionId);
    assert.ok(session);
    assert.strictEqual(session.lead_agent_id, 'build-error-resolver');
  });

  // ----------------------------------------------------
  // 26. STEP 4: INTERACTIVE 3D ARCHITECTURE TOPOLOGY
  // ----------------------------------------------------
  console.log('\n--- 26. Step 4: Interactive 3D Architecture Topology ---');
  await testAsync('GET /api/topology/3d computes spherical 3D coordinates and TCAS metrics', async () => {
    const res = await dispatch(server, 'GET', '/api/topology/3d');
    assert.strictEqual(res.status, 200);
    assert(res.body.nodeCount > 10);
    assert(res.body.edgeCount > 5);
    assert.strictEqual(res.body.projection, '3d-spherical-fibonacci');

    const hub = res.body.nodes.find(n => n.id === 'hub-oas-core');
    assert(hub);
    assert.strictEqual(hub.x, 0);
    assert.strictEqual(hub.y, 0);
    assert.strictEqual(hub.z, 0);

    const firstAgent = res.body.nodes.find(n => n.type === 'agent');
    assert(firstAgent);
    assert(typeof firstAgent.x === 'number');
    assert(typeof firstAgent.y === 'number');
    assert(typeof firstAgent.z === 'number');
    assert(firstAgent.tcasStatus);
  });

  // ----------------------------------------------------
  // 27. STEP 5: CRYPTOGRAPHIC COMPLIANCE AUDIT VAULT & DOSSIER
  // ----------------------------------------------------
  console.log('\n--- 27. Step 5: Cryptographic Compliance Vault & Dossier ---');
  await testAsync('GET /api/compliance/audit-trail verifies SHA-256 hash-chain integrity', async () => {
    const res = await dispatch(server, 'GET', '/api/compliance/audit-trail');
    assert.strictEqual(res.status, 200);
    assert(res.body.chainValid);
    assert(res.body.totalBlocks >= 3);
    assert(res.body.merkleRoot);

    // Verify hash chain linkage
    for (let i = 1; i < res.body.blocks.length; i++) {
      assert.strictEqual(res.body.blocks[i].previousHash, res.body.blocks[i - 1].blockHash);
    }
  });

  await testAsync('POST /api/compliance/dossier generates executive compliance report', async () => {
    const res = await dispatch(server, 'POST', '/api/compliance/dossier', {
      format: 'html'
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.dossierId);
    assert.strictEqual(res.body.complianceStatus, 'SAMPLE');
    assert.strictEqual(res.body.attestation, 'sample');
    assert(res.body.dossierHtml.includes('Executive Compliance Verification Dossier'));
    assert(res.body.dossierHtml.includes('SOC 2'));
    assert(res.body.dossierHtml.includes('ISO/IEC 27001'));
  });

  // ----------------------------------------------------
  // 28. STEP 6: KNOWLEDGE GRAPH NEURAL VISUALIZER & TOPOLOGY SUITE
  // ----------------------------------------------------
  console.log('\n--- 28. Step 6: Knowledge Graph Neural Visualizer & Topology Suite ---');
  await testAsync('GET /api/graph/telemetry returns live active agents and mission metrics', async () => {
    const res = await dispatch(server, 'GET', '/api/graph/telemetry');
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.activeAgents));
    assert(res.body.agentMetrics);
    assert(typeof res.body.activeSessionCount === 'number');
  });

  await testAsync('GET /api/graph/layout calculates multi-topology coordinate systems', async () => {
    const modes = ['galaxy', 'force', 'hierarchy', 'tcas'];
    for (const mode of modes) {
      const res = await dispatch(server, 'GET', `/api/graph/layout?mode=${mode}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.mode, mode);
      assert(res.body.coordinates);
      assert(Object.keys(res.body.coordinates).length > 0);
      const sampleKey = Object.keys(res.body.coordinates)[0];
      const coord = res.body.coordinates[sampleKey];
      assert(typeof coord.x === 'number');
      assert(typeof coord.y === 'number');
      assert(typeof coord.z === 'number');
      if (mode === 'tcas') {
        assert(coord.tcasZone);
      }
    }
  });

  await testAsync('GET /api/graph/impact computes subsystem blast radius and dependency risk', async () => {
    const res = await dispatch(server, 'GET', '/api/graph/impact?nodeId=agent:tdd-guide&depth=2');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.rootNodeId, 'agent:tdd-guide');
    assert.strictEqual(res.body.depth, 2);
    assert(Array.isArray(res.body.upstreamNodes));
    assert(Array.isArray(res.body.downstreamNodes));
    assert(Array.isArray(res.body.pathEdgeIds));
    assert(['LOW', 'MEDIUM', 'HIGH'].includes(res.body.riskScore));
    assert(typeof res.body.totalImpacted === 'number');
    assert(Array.isArray(res.body.affectedFiles));
  });

  await testAsync('PUT /api/graph/nodes/:id persists specification updates into knowledge graph', async () => {
    const res = await dispatch(server, 'PUT', `/api/graph/nodes/${encodeURIComponent('agent:planner')}`, {
      description: 'Quantum orchestration engine for multi-agent autonomous synthesis.'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.updatedNode.description, 'Quantum orchestration engine for multi-agent autonomous synthesis.');

    // Verify change is reflected in main knowledge graph
    const gRes = await dispatch(server, 'GET', '/api/graph');
    assert.strictEqual(gRes.status, 200);
    const plannerNode = gRes.body.nodes.find(n => n.id === 'agent:planner');
    assert(plannerNode);
    assert.strictEqual(plannerNode.description, 'Quantum orchestration engine for multi-agent autonomous synthesis.');
  });

  await testAsync('POST /api/graph/edges establishes new synapses between entities', async () => {
    const res = await dispatch(server, 'POST', '/api/graph/edges', {
      source: 'agent:planner',
      target: 'skill:api-design',
      label: 'orchestrates design'
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.edge.source, 'agent:planner');
    assert.strictEqual(res.body.edge.target, 'skill:api-design');

    // Verify synapse is returned in graph edges
    const gRes = await dispatch(server, 'GET', '/api/graph');
    const edge = gRes.body.edges.find(e => e.source === 'agent:planner' && e.target === 'skill:api-design');
    assert(edge);
  });

  await testAsync('POST /api/graph/search performs semantic natural language search', async () => {
    const res = await dispatch(server, 'POST', '/api/graph/search', {
      query: 'test driven development red green'
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.matches.length > 0);
    const topMatch = res.body.matches[0];
    assert(topMatch.id);
    assert(typeof topMatch.score === 'number');
    assert(topMatch.score > 0);
  });

  await testAsync('GET /api/graph/export exports Graphviz DOT and Cytoscape models', async () => {
    const dotRes = await dispatch(server, 'GET', '/api/graph/export?format=dot');
    assert.strictEqual(dotRes.status, 200);
    const dotContent = dotRes.raw || dotRes.body;
    assert(typeof dotContent === 'string');
    assert(dotContent.includes('digraph OAS_Knowledge_Graph {'));
    assert(dotContent.includes('->'));

    const cyRes = await dispatch(server, 'GET', '/api/graph/export?format=cytoscape');
    assert.strictEqual(cyRes.status, 200);
    assert(Array.isArray(cyRes.body.elements.nodes));
    assert(Array.isArray(cyRes.body.elements.edges));
    assert(cyRes.body.elements.nodes.length > 0);
  });

  // Clean up session
  await dispatch(server, 'DELETE', `/api/sessions/${testSessionId}`);

  console.log('\n======================================================');
  console.log(`  ✅ ALL ${passedTests}/${totalTests} COMPREHENSIVE E2E FUNCTIONAL TESTS PASSED!`);
  console.log('======================================================\n');
}

runComprehensiveE2EBattery().catch(err => {
  console.error('\n✖ TEST SUITE ABORTED DUE TO FAILURE:', err);
  process.exit(1);
});
