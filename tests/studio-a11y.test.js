/**
 * @file tests/studio-a11y.test.js
 * Accessibility and responsive contract checks for OAS Studio.
 * Static HTML/CSS audit plus served-document checks (no Playwright browser).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { OasControlPlaneServer } = require('../apps/api/src/server');

const htmlPath = path.join(__dirname, '../apps/web/index.html');
const cssPath = path.join(__dirname, '../apps/web/styles.css');

class MockIncomingMessage extends EventEmitter {
  constructor(method, url) {
    super();
    this.method = method;
    this.url = url;
    this.headers = { host: 'localhost' };
  }
  start() { process.nextTick(() => this.emit('end')); }
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
    for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v;
  }
  write(chunk) { this.body += chunk; }
  end(chunk) { if (chunk) this.body += chunk; this.emit('finish'); }
}

function simulate(server, method, url) {
  return new Promise((resolve, reject) => {
    const req = new MockIncomingMessage(method, url);
    const res = new MockServerResponse();
    res.on('finish', () => resolve({ status: res.statusCode, body: res.body, headers: res.headers }));
    server.handleRequest(req, res).catch(reject);
    req.start();
  });
}

async function run() {
  console.log('=== STUDIO ACCESSIBILITY & RESPONSIVE CONTRACT ===\n');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.ok(html.includes('lang="en"'), 'html must declare lang');
  assert.ok(html.includes('name="viewport"'), 'must have viewport meta for responsive layout');
  assert.ok(html.includes('<title>'), 'must have a document title');
  assert.ok(html.includes('name="description"'), 'must have a description meta');
  assert.ok(html.includes('class="skip-link"'), 'must include skip-to-content link');
  assert.ok(html.includes('id="main-content"'), 'main landmark must have id for skip link');
  assert.ok(html.includes('<nav') && html.includes('aria-label="Primary"'), 'primary nav must be labeled');
  assert.ok(html.includes('id="nav-dag"') && html.includes('<button type="button" class="nav-item'), 'primary nav items must be buttons');
  assert.ok(html.includes('aria-label="Execution DAG Orchestrator"'), 'DAG view must be labeled');
  assert.ok(html.includes('aria-label="Live Streaming Workspace"'), 'workspace view must be labeled');
  assert.ok(html.includes('for="settings-provider-select"'), 'settings controls must have labeled inputs');
  assert.ok(html.includes('aria-label="Close settings"'), 'settings close control must be named');
  assert.ok(html.includes('aria-live="polite"'), 'toasts must use a live region');
  assert.ok((html.match(/role="dialog"/g) || []).length >= 5, 'modals must use dialog role');
  assert.ok(css.includes(':focus-visible'), 'CSS must define :focus-visible');
  assert.ok(css.includes('prefers-reduced-motion'), 'CSS must honor reduced motion');
  console.log('  ✔ Static HTML/CSS landmarks, skip link, focus, and motion checks');

  const unnamedButtons = [];
  const buttonRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let match;
  while ((match = buttonRe.exec(html)) !== null) {
    const attrs = match[1];
    const inner = match[2].replace(/<[^>]+>/g, '').trim();
    const hasName = /aria-label=/.test(attrs) || /title=/.test(attrs) || inner.length > 0;
    if (!hasName) unnamedButtons.push(attrs.slice(0, 80));
  }
  assert.strictEqual(unnamedButtons.length, 0, 'buttons without accessible names: ' + unnamedButtons.join(' | '));
  console.log('  ✔ All buttons have an accessible name (text, title, or aria-label)');

  const server = new OasControlPlaneServer({ port: 0 });
  const served = await simulate(server, 'GET', '/');
  assert.strictEqual(served.status, 200);
  assert.ok(served.body.includes('skip-link'));
  assert.ok(served.body.includes('id="main-content"'));
  const cssServed = await simulate(server, 'GET', '/styles.css');
  assert.strictEqual(cssServed.status, 200);
  assert.ok(cssServed.body.includes('prefers-reduced-motion'));
  console.log('  ✔ Served index.html and styles.css include a11y affordances');

  console.log('\n======================================================');
  console.log('  STUDIO A11Y & RESPONSIVE CONTRACT PASSED');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error('A11y test failed:', err);
  process.exit(1);
});
