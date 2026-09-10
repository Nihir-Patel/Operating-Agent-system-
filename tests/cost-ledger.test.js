/**
 * @file tests/cost-ledger.test.js
 * Per-provider cost estimation, model routing, persistence, and budget stop.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { MemoryStore, OasSqliteStore } = require('../packages/db/src/index');
const { estimateCostUsd, summarizeCostLedger, recordInferenceCost } = require('../packages/engine/src/cost-ledger');
const { resolveRoute, assertWithinBudget } = require('../packages/engine/src/model-router');
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

async function runCostLedgerTests() {
  console.log('\n======================================================');
  console.log('  OAS COST LEDGER & MODEL ROUTER');
  console.log('======================================================\n');

  console.log('1. Local Ollama is free; cloud providers are metered');
  assert.strictEqual(estimateCostUsd({ provider: 'ollama', tokens: 100000 }), 0);
  const sonnet = estimateCostUsd({
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    promptTokens: 1000000,
    completionTokens: 0
  });
  assert.ok(sonnet > 2 && sonnet < 4, 'Sonnet input should be about $3/MTok, got ' + sonnet);
  const gpt = estimateCostUsd({
    provider: 'openai',
    model: 'gpt-4o',
    promptTokens: 0,
    completionTokens: 1000000
  });
  assert.ok(gpt > 8 && gpt < 12, 'gpt-4o output should be about $10/MTok, got ' + gpt);
  console.log('   provider rate table');

  console.log('2. Router falls back to local when budget is gone or keys are missing');
  const exhausted = resolveRoute(
    { provider: 'anthropic', anthropicApiKey: 'sk-test', ollamaModel: 'qwen2.5-coder:7b' },
    'claude-3-7-sonnet',
    { budgetUsd: 10, totals: { usd: 10.5 } }
  );
  assert.strictEqual(exhausted.provider, 'ollama');
  assert.strictEqual(exhausted.fallback, true);
  assert.strictEqual(exhausted.reason, 'budget-exhausted');

  const missingKey = resolveRoute(
    { provider: 'anthropic', anthropicApiKey: '', ollamaModel: 'qwen2.5-coder:7b' },
    'claude-3-7-sonnet',
    { budgetUsd: 10, totals: { usd: 0 } }
  );
  assert.strictEqual(missingKey.provider, 'ollama');
  assert.strictEqual(missingKey.reason, 'missing-api-key');

  const ok = resolveRoute(
    { provider: 'anthropic', anthropicApiKey: 'sk-test', ollamaModel: 'qwen2.5-coder:7b' },
    'claude-3-7-sonnet',
    { budgetUsd: 10, totals: { usd: 1 } }
  );
  assert.strictEqual(ok.provider, 'anthropic');
  assert.strictEqual(ok.fallback, false);
  console.log('   fallback + requested routes');

  console.log('3. Budget guard throws PAYMENT_REQUIRED');
  let thrown = null;
  try {
    assertWithinBudget({ budgetUsd: 5, totals: { usd: 5 } });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, 'exhausted budget must throw');
  assert.strictEqual(thrown.code, 'BUDGET_EXCEEDED');
  assert.strictEqual(thrown.statusCode, 402);
  assertWithinBudget({ budgetUsd: 5, totals: { usd: 1.2 } });
  console.log('   402 budget stop');

  console.log('4. Memory + SQLite persist cost events');
  const mem = new MemoryStore({ storagePath: path.join(tmpDir('oas-cost-mem-'), 'store.json') });
  const recorded = recordInferenceCost(mem, {
    sessionId: 'sess_cost',
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    promptTokens: 2000,
    completionTokens: 500
  });
  assert.ok(recorded.usd > 0);
  assert.strictEqual(mem.listCostEvents().length, 1);

  const dbPath = path.join(tmpDir('oas-cost-sql-'), 'db.sqlite');
  const sql = new OasSqliteStore({ storagePath: dbPath });
  sql.createSession({ id: 'sess_sql', title: 'Cost Session' });
  recordInferenceCost(sql, {
    sessionId: 'sess_sql',
    provider: 'openai',
    model: 'gpt-4o',
    promptTokens: 1000,
    completionTokens: 1000
  });
  const sqlEvents = sql.listCostEvents();
  assert.strictEqual(sqlEvents.length, 1);
  const session = sql.getSession('sess_sql');
  assert.ok(session.cost_usd > 0);
  assert.ok(session.total_tokens >= 2000);
  console.log('   durable cost events');

  console.log('5. GET /api/cost/ledger + HUD uses the ledger');
  const serverDir = tmpDir('oas-cost-api-');
  const server = new OasControlPlaneServer({
    port: 0,
    store: new MemoryStore({ storagePath: path.join(serverDir, 'store.json') })
  });
  server.store.saveSettings({ provider: 'anthropic', budgetLimit: 10 });
  recordInferenceCost(server.store, {
    sessionId: 'hud-sess',
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    promptTokens: 10000,
    completionTokens: 2000
  });

  const ledgerRes = await dispatch(server, 'GET', '/api/cost/ledger');
  assert.strictEqual(ledgerRes.status, 200);
  assert.ok(ledgerRes.body.totals.usd > 0, 'ledger totals must include usd');
  assert.ok(ledgerRes.body.events.length >= 1);
  assert.strictEqual(ledgerRes.body.budgetUsd, 10);

  const hudRes = await dispatch(server, 'GET', '/api/hud-status');
  assert.strictEqual(hudRes.status, 200);
  assert.strictEqual(hudRes.body.cost.source, 'ledger');
  assert.ok(hudRes.body.cost.sessionUsd > 0);
  console.log('   ledger API + HUD');

  console.log('6. Execute stops when the budget is exhausted');
  recordInferenceCost(server.store, {
    sessionId: 'hud-sess',
    provider: 'anthropic',
    model: 'claude-3-7-opus',
    promptTokens: 4000000,
    completionTokens: 1000000
  });
  const created = await dispatch(server, 'POST', '/api/sessions', { title: 'Over budget', lead_agent_id: 'planner' });
  const execRes = await dispatch(server, 'POST', `/api/sessions/${created.body.id}/execute`, { prompt: 'should not run' });
  assert.strictEqual(execRes.status, 402);
  assert.strictEqual(execRes.body.errorCode, 'BUDGET_EXCEEDED');
  console.log('   execute returns 402');

  const summary = summarizeCostLedger(server.store.listCostEvents(), { budgetUsd: 10 });
  assert.ok(summary.totals.byProvider.anthropic > 0);
  console.log('   provider rollup');

  console.log('\n======================================================');
  console.log('  PASS: COST LEDGER CONTRACTS PASSED');
  console.log('======================================================\n');
}

if (require.main === module) {
  runCostLedgerTests().catch(err => {
    console.error('FAIL: Cost ledger test failed:', err);
    process.exit(1);
  });
}

module.exports = { runCostLedgerTests };
