/**
 * @file tests/remaining-control-plane.test.js
 * Linux/Windows sandbox, model judge, skill promotion, desktop spawn,
 * OAS2 read bridge, MCP framing, secret redact, OTEL consent.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { DatabaseSync } = require('node:sqlite');
const { resolveSandboxedSpawn } = require('../packages/engine/src/os-sandbox');
const { gradeWithModelJudge } = require('../packages/engine/src/eval-harness');
const { evaluateSkillPromotion, writeSkillPromotion } = require('../packages/engine/src/skill-promotion');
const { planDesktopControlPlane } = require('../packages/engine/src/desktop-control-plane');
const { listOas2Sessions } = require('../packages/engine/src/oas2-read-bridge');
const { handleReadTool } = require('../packages/engine/src/mcp-read-plane');
const { encodeMcpMessage, feedMcpBuffer } = require('../packages/engine/src/mcp-framing');
const { redactSecrets, wrapUntrustedContent } = require('../packages/engine/src/prompt-guard');
const { buildConsentGatedOtlp } = require('../packages/engine/src/otlp-consent');
const { MemoryStore } = require('../packages/db/src/index');
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
function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  console.log('\n=== REMAINING CONTROL PLANE ===\n');

  const bwrap = resolveSandboxedSpawn('echo ok', '/tmp/ws', {
    platform: 'linux',
    sandboxExecPath: null,
    bwrapPath: '/usr/bin/bwrap'
  });
  assert.strictEqual(bwrap.isolation, 'bwrap');
  assert.strictEqual(bwrap.file, '/usr/bin/bwrap');
  assert.ok(bwrap.args.includes('--ro-bind'));
  assert.ok(bwrap.args.includes('/tmp/ws'));
  console.log('  ✔ linux bwrap wraps command with read-only root');

  const win = resolveSandboxedSpawn('echo ok', 'C:\\\\ws', {
    platform: 'win32',
    sandboxExecPath: null,
    bwrapPath: null
  });
  assert.strictEqual(win.isolation, 'policy-only');
  assert.ok(/cmd\.exe/i.test(win.file) || win.file === 'cmd.exe');
  assert.ok(win.args.includes('/c'));
  console.log('  ✔ windows stays policy-only with cmd.exe');

  const passJudge = await gradeWithModelJudge({
    output: 'READY',
    rubric: 'PASS if READY',
    complete: async () => ({ text: 'PASS\nContains READY' })
  });
  assert.strictEqual(passJudge.passed, true);
  assert.strictEqual(passJudge.type, 'modelJudge');
  const failJudge = await gradeWithModelJudge({
    output: 'nope',
    rubric: 'PASS if READY',
    complete: async () => ({ text: 'FAIL\nMissing token' })
  });
  assert.strictEqual(failJudge.passed, false);
  console.log('  ✔ model-as-judge parses PASS/FAIL from gateway');

  const weak = evaluateSkillPromotion({
    id: 'x',
    description: 'short',
    instructions: 'do stuff'
  });
  assert.strictEqual(weak.passed, false);
  assert.ok(weak.failures.includes('weak-description'));
  assert.ok(weak.failures.includes('missing-when-to-use'));
  const strongInput = {
    id: 'rate-limiter-tdd',
    description: 'Immutable token-bucket rate limiter workflow with TDD coverage.',
    instructions: '## When to Use\nNeed a limiter.\n## How It Works\nWrite tests first.'
  };
  const strong = evaluateSkillPromotion(strongInput);
  assert.strictEqual(strong.passed, true);
  const secreted = evaluateSkillPromotion({
    id: 'leaky',
    description: 'A reasonably long description that would otherwise pass the gate.',
    instructions: '## When to Use\nX\n## How It Works\nsk-ant-abcdefghijklmnopqrstuvwxyz123456'
  });
  assert.strictEqual(secreted.passed, false);
  assert.ok(secreted.failures.includes('secret-shaped'));
  const root = tmpDir('oas-promo-');
  const drafted = writeSkillPromotion({
    workspaceRoot: root,
    ...strongInput,
    confirmPromote: false
  });
  assert.strictEqual(drafted.stage, 'draft');
  assert.ok(drafted.file.includes('.oas/promotions/drafts/'));
  assert.ok(fs.existsSync(path.join(root, drafted.file)));
  assert.ok(!fs.existsSync(path.join(root, 'skills/rate-limiter-tdd/SKILL.md')));
  const promoted = writeSkillPromotion({
    workspaceRoot: root,
    ...strongInput,
    confirmPromote: true
  });
  assert.strictEqual(promoted.stage, 'catalog');
  assert.ok(fs.existsSync(path.join(root, 'skills/rate-limiter-tdd/SKILL.md')));
  console.log('  ✔ skill promotion drafts until HITL confirmPromote');

  const reuse = planDesktopControlPlane({ healthOk: true, repoRoot: '/repo', port: 3458 });
  assert.strictEqual(reuse.action, 'reuse');
  assert.strictEqual(reuse.ownsProcess, false);
  const spawnPlan = planDesktopControlPlane({
    healthOk: false,
    repoRoot: '/repo',
    port: 3458,
    nodePath: '/usr/bin/node'
  });
  assert.strictEqual(spawnPlan.action, 'spawn');
  assert.strictEqual(spawnPlan.ownsProcess, true);
  assert.ok(spawnPlan.args.some(arg => String(arg).includes('oas-studio.js')));
  const rust = fs.readFileSync(path.join(__dirname, '../apps/desktop/src-tauri/src/main.rs'), 'utf8');
  assert.ok(rust.includes('spawn_control_plane') || rust.includes('oas-studio.js'));
  console.log('  ✔ Tauri spawn plan owns the API when health is down');

  const oas2Db = path.join(tmpDir('oas2-'), 'oas2.sqlite');
  const db = new DatabaseSync(oas2Db);
  db.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY, task TEXT NOT NULL, state TEXT NOT NULL,
    agent_type TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
  db.prepare('INSERT INTO sessions (id, task, state, agent_type, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('s-oas2', 'Rust TUI session', 'running', 'planner', '2026-09-09T00:00:00Z');
  db.close();
  const oas2 = listOas2Sessions({ dbPath: oas2Db });
  assert.strictEqual(oas2.length, 1);
  assert.strictEqual(oas2[0].source, 'oas2');
  assert.strictEqual(oas2[0].title, 'Rust TUI session');
  const studioStore = new MemoryStore({ storagePath: path.join(tmpDir('oas-st-'), 's.json') });
  studioStore.createSession({ title: 'Studio session', lead_agent_id: 'architect' });
  const listed = handleReadTool('list_sessions', { store: studioStore, oas2DbPath: oas2Db });
  assert.ok(listed.data.some(row => row.source === 'studio' || !row.source));
  assert.ok(listed.data.some(row => row.source === 'oas2'));
  console.log('  ✔ OAS2 sessions are read-only alongside Studio (no merge writes)');

  const framed = encodeMcpMessage({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  assert.ok(framed.startsWith('Content-Length: '));
  const fed = feedMcpBuffer(Buffer.from(framed), msg => {
    assert.strictEqual(msg.id, 1);
    assert.strictEqual(msg.result.ok, true);
  });
  assert.strictEqual(fed.rest.length, 0);
  console.log('  ✔ MCP Content-Length framing round-trips');

  const redacted = redactSecrets('key sk-ant-abcdefghijklmnopqrstuvwxyz123456 token');
  assert.ok(!redacted.includes('sk-ant-abcdefghijklmnopqrstuvwxyz123456'));
  assert.ok(redacted.includes('[REDACTED]'));
  assert.ok(wrapUntrustedContent('x').includes('BEGIN UNTRUSTED CONTENT'));
  console.log('  ✔ secret redaction');

  assert.strictEqual(buildConsentGatedOtlp({ consent: false, name: 'arena.compare' }), null);
  const otlp = buildConsentGatedOtlp({ consent: true, name: 'arena.compare', traceId: 'aa'.repeat(16), spanId: 'bb'.repeat(8) });
  assert.ok(otlp.resourceSpans);
  assert.strictEqual(otlp.consent, true);
  console.log('  ✔ OTLP exporter is consent-gated');

  const workspace = tmpDir('oas-api-promo-');
  fs.mkdirSync(path.join(workspace, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'skills'), { recursive: true });
  const server = new OasControlPlaneServer({
    port: 0,
    workspaceRoot: workspace,
    store: new MemoryStore({ storagePath: path.join(workspace, 'store.json') })
  });
  const draftRes = await dispatch(server, 'POST', '/api/skills/create', {
    id: 'promo-draft',
    description: 'Immutable token-bucket rate limiter workflow with TDD coverage.',
    instructions: '## When to Use\nNeed a limiter.\n## How It Works\nWrite tests first.'
  });
  assert.strictEqual(draftRes.status, 202);
  assert.strictEqual(draftRes.body.stage, 'draft');
  const blocked = await dispatch(server, 'POST', '/api/skills/create', {
    id: 'promo-draft',
    description: 'too short',
    instructions: 'nope',
    confirmPromote: true
  });
  assert.strictEqual(blocked.status, 409);
  const promotedRes = await dispatch(server, 'POST', '/api/skills/create', {
    id: 'promo-live',
    description: 'Immutable token-bucket rate limiter workflow with TDD coverage.',
    instructions: '## When to Use\nNeed a limiter.\n## How It Works\nWrite tests first.',
    confirmPromote: true
  });
  assert.strictEqual(promotedRes.status, 201);
  assert.strictEqual(promotedRes.body.stage, 'catalog');

  server.gateway.streamCompletion = async () => ({ text: 'PASS\nLooks correct' });
  const judged = await dispatch(server, 'POST', '/api/arena/compare', {
    taskId: 'custom',
    prompt: 'Say READY',
    models: ['qwen2.5-coder:7b'],
    mustContain: 'READY',
    judge: true,
    k: 1
  });
  assert.strictEqual(judged.status, 200);
  assert.ok(judged.body.models[0].judge || judged.body.traces[0].judge);

  const tel = await dispatch(server, 'GET', '/api/telemetry');
  assert.strictEqual(tel.status, 200);
  assert.strictEqual(tel.body.otel.consent, false);
  assert.strictEqual(tel.body.otel.exporter, 'none');
  console.log('  ✔ HTTP promotion, arena judge, and telemetry consent');

  const html = fs.readFileSync(path.join(__dirname, '../apps/web/index.html'), 'utf8');
  assert.ok(html.includes('id="builder-skill-confirm-promote"'));
  assert.ok(html.includes('id="arena-model-judge"'));
  console.log('  ✔ Studio surfaces promotion HITL and model judge');

  const emptyAirspace = await dispatch(server, 'GET', '/api/proximity');
  assert.strictEqual(emptyAirspace.status, 200);
  assert.strictEqual(emptyAirspace.body.source, 'none');
  assert.notStrictEqual(emptyAirspace.body.source, 'sample');
  assert.ok(Array.isArray(emptyAirspace.body.advisories));
  console.log('  ✔ proximity stays empty instead of a fake sample roster');

  let councilCalls = 0;
  server.gateway.streamCompletion = async () => {
    councilCalls += 1;
    const err = new Error('connect ECONNREFUSED 127.0.0.1:11434');
    err.code = 'ECONNREFUSED';
    throw err;
  };
  const councilStarted = Date.now();
  const council = await dispatch(server, 'POST', '/api/agents/council/deliberate', {
    topic: 'Fail closed without hanging',
    mode: 'architecture'
  });
  assert.strictEqual(council.status, 200);
  assert.strictEqual(council.body.live, false);
  assert.strictEqual(council.body.rounds.length, 4);
  assert.ok(councilCalls <= 1, `council must fail-fast, got ${councilCalls} live calls`);
  assert.ok(Date.now() - councilStarted < 3000, 'council must not wait on a dead Ollama');
  console.log('  ✔ council fail-fast when the model is unreachable');

  const heal = await dispatch(server, 'POST', '/api/loop/heal', {
    errorTrace: 'TypeError: x at file.js:1:1',
    apply: false
  });
  assert.strictEqual(heal.status, 200);
  assert.strictEqual(heal.body.generatedBy, 'heuristic-template');
  assert.doesNotMatch(String(heal.body.suggestedPatch || ''), /Auto-Healed by OAS/);
  console.log('  ✔ heal patch is labeled as a heuristic template');
}

if (require.main === module) {
  run().catch(err => {
    console.error('❌ remaining control plane test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
