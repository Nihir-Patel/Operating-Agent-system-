/**
 * @file tests/eval-arena.test.js
 * Arena scoring uses pass@k, golden tasks, and recorded traces.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { MemoryStore, OasSqliteStore } = require('../packages/db/src/index');
const {
  passAtK,
  gradeOutput,
  listGoldenTasks,
  resolveArenaTask,
  summarizeModelEval,
  pickArenaWinners,
  parseCustomGraders
} = require('../packages/engine/src/eval-harness');
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
    this.headersSent = true;
  }

  write(chunk) {
    this.body += chunk;
  }

  end(chunk) {
    if (chunk) this.body += chunk;
    this.writableEnded = true;
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

function stubGateway(replies) {
  let i = 0;
  return async () => {
    const text = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return { text, provider: 'ollama', model: 'stub' };
  };
}

async function run() {
  console.log('\n======================================================');
  console.log('  OAS ARENA EVAL HARNESS (pass@k / golden tasks / traces)');
  console.log('======================================================\n');

  console.log('1. pass@k estimator and code graders');
  assert.strictEqual(passAtK(3, 1, 1), 0.3333);
  assert.strictEqual(passAtK(3, 1, 2), 0.6667);
  assert.strictEqual(passAtK(3, 1, 3), 1);
  assert.strictEqual(passAtK(3, 0, 3), 0);
  const graded = gradeOutput('READY\n', [{ type: 'contains', value: 'READY' }]);
  assert.strictEqual(graded.passed, true);
  const failed = gradeOutput('nope', [{ type: 'contains', value: 'READY' }]);
  assert.strictEqual(failed.passed, false);
  const regex = gradeOutput('token bucket limiter', [{ type: 'regex', value: 'token\\s+bucket', flags: 'i' }]);
  assert.strictEqual(regex.passed, true);
  console.log('   estimator + graders');

  console.log('2. Golden tasks resolve; ungraded custom prompts stay honest');
  const tasks = listGoldenTasks();
  assert.ok(tasks.some(t => t.id === 'ready-token'));
  assert.ok(tasks.some(t => t.id === 'rate-limiter-tdd'));
  const golden = resolveArenaTask({ taskId: 'ready-token' });
  assert.strictEqual(golden.source, 'golden');
  assert.ok(golden.graders.length > 0);
  const ungraded = resolveArenaTask({ prompt: 'Write a poem about mutexes' });
  assert.strictEqual(ungraded.source, 'ungraded');
  assert.strictEqual(ungraded.graders.length, 0);
  const custom = resolveArenaTask({
    prompt: 'Say PING',
    graders: [{ type: 'contains', value: 'PING' }]
  });
  assert.strictEqual(custom.source, 'request');
  const fromFields = parseCustomGraders({ mustContain: 'PING', mustNotContain: 'PONG' });
  assert.strictEqual(fromFields.length, 2);
  assert.strictEqual(fromFields[0].type, 'contains');
  assert.strictEqual(fromFields[1].type, 'notContains');
  console.log('   task resolution');

  console.log('3. Model summary and winners use pass@k, not output length');
  const summary = summarizeModelEval({
    modelId: 'stub-a',
    name: 'stub-a',
    provider: 'OLLAMA',
    k: 3,
    graded: true,
    attempts: [
      { passed: false, latencyMs: 40, tokens: 4, cost: 0, output: 'nope' },
      { passed: true, latencyMs: 50, tokens: 6, cost: 0, output: 'READY' },
      { passed: true, latencyMs: 60, tokens: 6, cost: 0, output: 'READY' }
    ]
  });
  assert.strictEqual(summary.scoringMethod, 'pass_at_k');
  assert.strictEqual(summary.passAtK, 1);
  assert.strictEqual(summary.correct, 2);
  const longLoser = summarizeModelEval({
    modelId: 'verbose',
    name: 'verbose',
    provider: 'CLOUD',
    k: 1,
    graded: true,
    attempts: [{ passed: false, latencyMs: 10, tokens: 400, cost: 0.02, output: 'x'.repeat(400) }]
  });
  const winners = pickArenaWinners([summary, longLoser]);
  assert.strictEqual(winners.reasoningWinner, 'stub-a');
  assert.notStrictEqual(winners.reasoningWinner, 'verbose');
  console.log('   pass@k winners ignore verbose failures');

  console.log('4. POST /api/arena/compare grades stubbed traces at k=3');
  const store = new MemoryStore({ storagePath: path.join(tmpDir('oas-arena-mem-'), 'store.json') });
  const server = new OasControlPlaneServer({
    port: 0,
    workspaceRoot: tmpDir('oas-arena-ws-'),
    store
  });
  server.gateway.streamCompletion = stubGateway(['nope', 'READY', 'READY']);
  const compared = await dispatch(server, 'POST', '/api/arena/compare', {
    taskId: 'ready-token',
    models: ['qwen2.5-coder:7b'],
    k: 3
  });
  assert.strictEqual(compared.status, 200);
  assert.strictEqual(compared.body.capability, 'eval-harness');
  assert.strictEqual(compared.body.scoringMethod, 'pass_at_k');
  assert.strictEqual(compared.body.task.id, 'ready-token');
  const model = compared.body.models[0];
  assert.strictEqual(model.scoringMethod, 'pass_at_k');
  assert.strictEqual(model.passAtK, 1);
  assert.strictEqual(model.trials, 3);
  assert.ok(Array.isArray(compared.body.traces));
  assert.strictEqual(compared.body.traces.length, 3);
  assert.strictEqual(compared.body.traces.filter(t => t.passed).length, 2);
  const listed = await dispatch(server, 'GET', '/api/arena/traces');
  assert.strictEqual(listed.status, 200);
  assert.ok(listed.body.traces.length >= 3);
  const catalog = await dispatch(server, 'GET', '/api/arena/tasks');
  assert.strictEqual(catalog.status, 200);
  assert.ok(catalog.body.tasks.length >= 2);
  console.log('   compare + persisted traces');

  console.log('5. SQLite round-trips arena traces');
  const sql = new OasSqliteStore({ storagePath: path.join(tmpDir('oas-arena-sql-'), 'db.sqlite') });
  sql.saveArenaTrace({
    id: 'tr_test_1',
    benchmarkId: 'arena-1',
    taskId: 'ready-token',
    modelId: 'stub',
    attempt: 1,
    passed: true,
    output: 'READY'
  });
  assert.strictEqual(sql.listArenaTraces().length, 1);
  const reloaded = new OasSqliteStore({ storagePath: sql.storagePath });
  assert.strictEqual(reloaded.listArenaTraces()[0].output, 'READY');
  console.log('   sqlite traces');

  console.log('6. Ungraded custom prompts are traces, not fake reasoning scores');
  server.gateway.streamCompletion = stubGateway(['a very long ungraded essay about nothing in particular']);
  const poem = await dispatch(server, 'POST', '/api/arena/compare', {
    prompt: 'Write a poem about mutexes',
    models: ['qwen2.5-coder:7b'],
    k: 1
  });
  assert.strictEqual(poem.status, 200);
  assert.strictEqual(poem.body.capability, 'ungraded-trace');
  assert.strictEqual(poem.body.models[0].scoringMethod, 'ungraded_trace');
  assert.strictEqual(poem.body.winners.reasoningWinner, 'n/a (ungraded)');
  console.log('   ungraded honesty');

  server.gateway.streamCompletion = stubGateway(['PING']);
  const customGraded = await dispatch(server, 'POST', '/api/arena/compare', {
    taskId: 'custom',
    prompt: 'Say PING',
    models: ['qwen2.5-coder:7b'],
    mustContain: 'PING',
    mustNotContain: 'PONG',
    k: 1
  });
  assert.strictEqual(customGraded.status, 200);
  assert.strictEqual(customGraded.body.capability, 'eval-harness');
  assert.strictEqual(customGraded.body.models[0].passAtK, 1);
  console.log('   custom mustContain graders');

  const html = fs.readFileSync(path.join(__dirname, '../apps/web/index.html'), 'utf8');
  assert.ok(html.includes('data-capability="eval-harness"') || html.includes('Eval harness'));
  assert.ok(html.includes('id="arena-must-contain"'));
  assert.ok(html.includes('id="arena-trace-list"'));
  assert.ok(!html.includes('Heuristic scoring (length and latency), not an eval harness.'));
  console.log('   Studio Arena copy is eval-harness');

  console.log('\n======================================================');
  console.log('  PASS: ARENA EVAL HARNESS CONTRACTS PASSED');
  console.log('======================================================\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('FAIL: Arena eval harness test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
