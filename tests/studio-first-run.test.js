'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const {
  ALLOWED_CURSOR_MCP_SERVERS,
  assertProviderReady,
  evaluateFirstRun,
  memoryCliCommand,
  readCursorMcpConfig,
} = require('../packages/engine/src/studio-first-run');
const { OasControlPlaneServer } = require('../apps/api/src/server');
const { MemoryStore } = require('../packages/db/src/index');

class MockIncomingMessage extends EventEmitter {
  constructor(method, urlPath, body = null) {
    super();
    this.method = method;
    this.url = urlPath;
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
        resolve({ status: res.statusCode, body: JSON.parse(res.body || '{}'), raw: res.body });
      } catch {
        resolve({ status: res.statusCode, raw: res.body });
      }
    });
    server.handleRequest(req, res).catch(reject);
    req.start();
  });
}

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oas-first-run-'));
  return new MemoryStore({
    storagePath: path.join(dir, 'store.json'),
    memoryRoot: path.join(dir, 'memory'),
  });
}

function itemById(report, id) {
  return report.items.find(item => item.id === id);
}

async function run() {
  console.log('\n=== Studio first-run checklist ===\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${error.message}`);
      failed += 1;
    }
  }

  await test('ollama default is ready; cloud provider without a key is blocking', () => {
    const ready = evaluateFirstRun({
      settings: { provider: 'ollama' },
      env: {},
      vaultCount: 2,
      mcpConfig: { mcpServers: { 'chrome-devtools': { command: 'npx' } } },
      cliOnPath: false,
      dismissed: false,
    });
    assert.strictEqual(ready.schemaVersion, 'oas.studio.first-run.v1');
    assert.strictEqual(ready.ready, true);
    assert.strictEqual(itemById(ready, 'provider').status, 'ready');
    assert.strictEqual(itemById(ready, 'memory-cli').command, 'node scripts/oas.js memory');
    assert.strictEqual(ready.memory.unified, true);
    assert.strictEqual(ready.memory.vaultCount, 2);

    const blocked = evaluateFirstRun({
      settings: { provider: 'anthropic', anthropicApiKey: '' },
      env: {},
      vaultCount: 0,
      mcpConfig: { mcpServers: {} },
      cliOnPath: true,
      dismissed: false,
    });
    assert.strictEqual(blocked.ready, false);
    assert.strictEqual(blocked.blocking[0].id, 'provider');
    assert.strictEqual(itemById(blocked, 'memory-cli').command, 'oas memory');
  });

  await test('inbox and optional alpha surfaces are visible but not blocking', () => {
    const report = evaluateFirstRun({
      settings: { provider: 'ollama', githubToken: 'ghs_test', linearApiKey: '' },
      env: { LINEAR_API_KEY: 'lin_test' },
      vaultCount: 0,
      mcpConfig: { mcpServers: { 'chrome-devtools': {}, 'oas-memory-vault': {}, 'oas-studio-read': {} } },
      cliOnPath: false,
      dismissed: false,
    });
    assert.strictEqual(report.inbox.githubConfigured, true);
    assert.strictEqual(report.inbox.linearConfigured, true);
    assert.strictEqual(itemById(report, 'inbox-github').status, 'ready');
    assert.strictEqual(itemById(report, 'oas2').status, 'skip');
    assert.strictEqual(itemById(report, 'ito').status, 'skip');
    assert.strictEqual(itemById(report, 'ccg-workflow').status, 'skip');
    assert.strictEqual(itemById(report, 'desktop').command, 'npm run desktop');
    assert.ok(report.mcp.servers.includes('chrome-devtools'));
  });

  await test('assertProviderReady throws before a cloud run and accepts ollama', () => {
    assertProviderReady({ provider: 'ollama' }, {});
    assert.throws(
      () => assertProviderReady({ provider: 'openai', openaiApiKey: '' }, {}),
      error => error.code === 'NO_PROVIDER_CONFIGURED' && error.statusCode === 409
    );
    assertProviderReady({ provider: 'openai' }, { OPENAI_API_KEY: 'sk-test' });
  });

  await test('memory CLI prefers the repo entrypoint when oas is not on PATH', () => {
    assert.strictEqual(memoryCliCommand(false), 'node scripts/oas.js memory');
    assert.strictEqual(memoryCliCommand(true), 'oas memory');
  });

  await test('GET /api/first-run and dismiss persist without echoing secrets', async () => {
    const store = tmpStore();
    store.saveSettings({
      provider: 'anthropic',
      anthropicApiKey: 'sk-ant-secret-value',
      githubToken: 'ghs_secret',
    });
    const server = new OasControlPlaneServer({ store, workspaceRoot: path.resolve(__dirname, '..') });
    const first = await dispatch(server, 'GET', '/api/first-run');
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.schemaVersion, 'oas.studio.first-run.v1');
    assert.strictEqual(first.body.ready, true);
    assert.strictEqual(first.body.inbox.githubConfigured, true);
    assert.ok(!JSON.stringify(first.body).includes('sk-ant-secret-value'));
    assert.ok(!JSON.stringify(first.body).includes('ghs_secret'));

    const dismissed = await dispatch(server, 'POST', '/api/first-run/dismiss', { dismissed: true });
    assert.strictEqual(dismissed.status, 200);
    assert.strictEqual(dismissed.body.dismissed, true);
    assert.strictEqual(store.getSettings().firstRunDismissed, true);
  });

  await test('agent execution is blocked when the selected cloud provider has no key', async () => {
    const store = tmpStore();
    store.saveSettings({ provider: 'gemini', geminiApiKey: '' });
    const server = new OasControlPlaneServer({ store, workspaceRoot: path.resolve(__dirname, '..') });
    const result = await dispatch(server, 'POST', '/api/sessions/sess_first_run/execute', {
      intent: 'plan a feature',
    });
    assert.strictEqual(result.status, 409);
    assert.strictEqual(result.body.errorCode, 'NO_PROVIDER_CONFIGURED');
    assert.match(result.body.error || result.body.message || '', /first-run|Settings|provider/i);
  });

  await test('project Cursor MCP is allowlisted and secret-free', () => {
    const config = readCursorMcpConfig(path.resolve(__dirname, '..'));
    const names = Object.keys(config.mcpServers);
    assert.ok(names.includes('chrome-devtools'));
    assert.ok(names.includes('oas-memory-vault'));
    assert.ok(names.includes('oas-studio-read'));
    for (const name of names) {
      assert.ok(ALLOWED_CURSOR_MCP_SERVERS.has(name), name);
    }
    const raw = fs.readFileSync(path.join(path.resolve(__dirname, '..'), '.cursor', 'mcp.json'), 'utf8');
    assert.doesNotMatch(raw, /YOUR_|API_KEY|TOKEN|SECRET|PASSWORD|sk-|ghp_/);
    assert.strictEqual(config.mcpServers['oas-memory-vault'].env.OAS_MEMORY_HARNESS, 'cursor');
  });

  await test('Studio HTML exposes a labeled first-run checklist', () => {
    const html = fs.readFileSync(path.join(__dirname, '../apps/web/index.html'), 'utf8');
    assert.ok(html.includes('id="first-run-checklist"'));
    assert.ok(html.includes('aria-labelledby="first-run-title"'));
    assert.ok(html.includes('id="btn-first-run-open-settings"'));
    assert.ok(html.includes('id="settings-github-token"'));
    assert.ok(html.includes('id="settings-linear-key"'));
    assert.ok(html.includes('for="settings-github-token"'));
    assert.ok(html.includes('for="settings-linear-key"'));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
