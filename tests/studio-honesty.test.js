/**
 * @file tests/studio-honesty.test.js
 * Local Studio 0.9 must not claim cloud/enterprise, AgentShield 102-rules,
 * or DAG Auto Run that only simulates steps.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { OasControlPlaneServer } = require('../apps/api/src/server');
const { MemoryStore } = require('../packages/db/src/index');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');

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
  setHeader(name, value) { this.headers[name] = value; }
  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    Object.assign(this.headers, headers);
    this.headersSent = true;
  }
  write(chunk) { this.body += chunk; }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oas-honesty-'));
  return new MemoryStore({
    storagePath: path.join(dir, 'store.json'),
    memoryRoot: path.join(dir, 'memory')
  });
}

async function run() {
  console.log('\n=== STUDIO HONESTY (LOCAL 0.9) ===\n');

  const indexHtml = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  const launcher = fs.readFileSync(path.join(ROOT, 'scripts/oas-studio.js'), 'utf8');
  const workingContext = fs.readFileSync(path.join(ROOT, 'WORKING-CONTEXT.md'), 'utf8');

  assert.ok(indexHtml.includes('Local Studio'), 'sidebar must say Local Studio');
  assert.ok(indexHtml.includes('0.9'), 'Studio chrome must show 0.9, not plugin 2.2.1 as the Studio version');
  assert.doesNotMatch(indexHtml, /<(div|span|h1|title|button)[^>]*>\s*Cloud Control Plane/i);
  assert.doesNotMatch(indexHtml, /brand-badge">Cloud Control Plane/i);
  assert.doesNotMatch(indexHtml, /Enterprise v2\.2\.1/);
  assert.doesNotMatch(indexHtml, /\$0\.84 \/ \$10\.00/);
  assert.match(indexHtml, /not OAS credits/i);
  assert.ok(indexHtml.includes('Simulate Step'), 'DAG simulate button must be labeled Simulate Step');
  assert.ok(indexHtml.includes('title="Marks the next DAG node complete without calling a model"')
    || indexHtml.includes('without calling a model'), 'Simulate Step must disclose it is not an LLM run');
  assert.ok(/Lightweight scan/i.test(indexHtml), 'security button must say Lightweight scan, not AgentShield as the product');
  assert.doesNotMatch(indexHtml, /AgentShield Supply Chain & Security Audit/);
  assert.match(indexHtml, /not the 102-rule AgentShield CLI/i);
  console.log('   index.html Local Studio 0.9 labels');

  assert.doesNotMatch(launcher, /ENTERPRISE STUDIO & CLOUD/i);
  assert.match(launcher, /Local Studio 0\.9/);
  console.log('   oas-studio.js launcher banner');

  assert.ok(appJs.includes('/pipeline/run'), 'Auto Run must POST /pipeline/run');
  assert.doesNotMatch(appJs, /setInterval\(advanceDagStep/);
  assert.ok(appJs.includes('scanEngine') || appJs.includes('scanner'), 'security UI must render API scanner identity');
  assert.doesNotMatch(appJs, /142 indicators tracked/);
  assert.doesNotMatch(appJs, /Zero-Day IOC Scan/);
  assert.match(appJs, /'MCPs':\s*36/);
  assert.doesNotMatch(appJs, /'MCPs':\s*35/);
  console.log('   app.js Auto Run + honest security render');

  assert.match(workingContext, /2\.2\.1/);
  assert.match(workingContext, /68 agents/);
  assert.match(workingContext, /286 skills/);
  assert.doesNotMatch(workingContext, /Public catalog truth is `47` agents/);
  assert.match(workingContext, /Studio 0\.9/);
  console.log('   WORKING-CONTEXT.md current truth');

  const server = new OasControlPlaneServer({ port: 0, store: tmpStore() });
  const health = await dispatch(server, 'GET', '/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.body.service, 'oas-studio');
  assert.strictEqual(health.body.studioVersion, '0.9.0');
  assert.ok(health.body.pluginVersion);
  console.log('   /health reports studioVersion 0.9.0');

  const scan = await dispatch(server, 'POST', '/api/security/scan', {});
  assert.strictEqual(scan.status, 200);
  assert.strictEqual(scan.body.claimsAgentShield, false);
  assert.strictEqual(scan.body.scanner, 'lightweight-workspace');
  assert.ok(scan.body.disclaimer);
  assert.match(String(scan.body.disclaimer), /not the 102-rule AgentShield/i);
  console.log('   security scan does not claim AgentShield');

  const missing = await dispatch(server, 'POST', '/api/settings/test', { provider: 'anthropic' });
  assert.strictEqual(missing.status, 200);
  assert.strictEqual(missing.body.success, false);
  assert.strictEqual(missing.body.live, false);
  assert.match(String(missing.body.message || missing.body.error), /missing|not configured/i);
  console.log('   settings/test refuses empty Anthropic key without claiming connected');

  const liveAttempt = await dispatch(server, 'POST', '/api/settings/test', {
    provider: 'openai',
    openaiApiKey: 'sk-test-not-a-real-key'
  });
  assert.strictEqual(liveAttempt.status, 200);
  assert.strictEqual(liveAttempt.body.live, true);
  assert.strictEqual(liveAttempt.body.success, false);
  assert.ok(liveAttempt.body.error || liveAttempt.body.message);
  console.log('   settings/test live-probes OpenAI instead of key-presence only');

  console.log('\nStudio honesty tests passed.\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
