/**
 * @file tests/studio-modules.test.js
 * Studio ES-module split, static /js serving, and workspace editor contract.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { EventEmitter } = require('events');
const { OasControlPlaneServer } = require('../apps/api/src/server');
const { AuthMiddleware } = require('../apps/api/src/middleware/auth');

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

function simulateRequest(server, method, url, body = null) {
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

function readStudioSources() {
  const webRoot = path.join(__dirname, '../apps/web');
  const files = [path.join(webRoot, 'app.js')];
  const jsDir = path.join(webRoot, 'js');
  if (fs.existsSync(jsDir)) {
    for (const name of fs.readdirSync(jsDir).filter(n => n.endsWith('.js')).sort()) {
      files.push(path.join(jsDir, name));
    }
  }
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

async function runStudioModuleTests() {
  console.log('\n======================================================');
  console.log('  OAS STUDIO MODULE SPLIT & WORKSPACE EDITOR');
  console.log('======================================================\n');

  const webRoot = path.join(__dirname, '../apps/web');
  const indexHtml = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
  const server = new OasControlPlaneServer({ port: 0 });

  console.log('1. index.html boots as an ES module with a Monaco host');
  assert.ok(/type=["']module["']/.test(indexHtml), 'index.html must load app.js as type=module');
  assert.ok(indexHtml.includes('id="monaco-editor-host"'), 'index.html must include monaco-editor-host');
  assert.ok(indexHtml.includes('id="workspace-file-editor"'), 'textarea fallback must remain');
  console.log('   module boot + Monaco host + textarea fallback');

  console.log('2. app.js imports extracted Studio modules');
  assert.ok(appJs.includes("from './js/api-client.js'"), 'app.js must import api-client');
  assert.ok(appJs.includes("from './js/workspace-editor.js'"), 'app.js must import workspace-editor');
  assert.ok(appJs.includes("from './js/studio-state.js'"), 'app.js must import studio-state');
  assert.ok(appJs.includes("from './js/ui.js'"), 'app.js must import ui helpers');
  assert.ok(appJs.includes("from './js/kg-camera.js'"), 'app.js must import kg-camera');
  assert.ok(appJs.includes("from './js/studio-labels.js'"), 'app.js must import studio-labels');
  assert.ok(appJs.includes('./js/studio-graph-3d.js'), 'app.js must import studio-graph-3d');
  console.log('   app.js is a module graph root');

  console.log('3. GET /js modules are served as JavaScript');
  const requiredModules = [
    '/js/api-client.js',
    '/js/ui.js',
    '/js/studio-state.js',
    '/js/workspace-editor.js',
    '/js/kg-camera.js',
    '/js/studio-graph-3d.js',
    '/js/studio-labels.js'
  ];
  for (const pathname of requiredModules) {
    const res = await simulateRequest(server, 'GET', pathname);
    assert.strictEqual(res.statusCode, 200, pathname + ' must return 200');
    assert.ok((res.headers['content-type'] || '').includes('javascript'), pathname + ' must be JavaScript');
    assert.ok(res.body.length > 40, pathname + ' must not be empty');
  }
  console.log('   /js/*.js static serving');

  console.log('4. /js path traversal is rejected');
  const traversal = await simulateRequest(server, 'GET', '/js/../package.json');
  assert.ok(traversal.statusCode === 403 || traversal.statusCode === 404, 'parent traversal must not serve package.json');
  assert.ok(!String(traversal.body).includes('"name"'), 'traversal must not leak package.json');
  console.log('   path-guarded static modules');

  console.log('5. Concatenated Studio JS keeps control-plane contracts');
  const studioJs = readStudioSources();
  assert.ok(studioJs.includes('initGlobalCommandPalette'), 'command palette init must remain');
  assert.ok(studioJs.includes('initHitlSecurityController'), 'HITL controller must remain');
  assert.ok(studioJs.includes('openEntityModal'), 'entity modal must remain');
  assert.ok(studioJs.includes('edge-animated'), 'animated DAG edges must remain');
  assert.ok(studioJs.includes('agent:intervention:paused'), 'HITL pause events must remain');
  assert.ok(studioJs.includes('getApiToken'), 'API token reader must remain');
  assert.ok(studioJs.includes("headers.set('Authorization'"), 'Authorization header attach must remain');
  assert.ok(studioJs.includes('getSseStreamUrl'), 'SSE credential URL must remain');
  assert.ok(studioJs.includes('monaco-editor'), 'Monaco loader must be referenced');
  assert.ok(studioJs.includes('languageFromPath'), 'editor language mapping must exist');
  console.log('   control-plane strings survive the split');

  console.log('6. workspace-editor language mapping');
  const editorPath = path.join(webRoot, 'js/workspace-editor.js');
  const editorMod = await import(pathToFileURL(editorPath).href);
  assert.strictEqual(editorMod.languageFromPath('src/app.js'), 'javascript');
  assert.strictEqual(editorMod.languageFromPath('pkg/index.ts'), 'typescript');
  assert.strictEqual(editorMod.languageFromPath('README.md'), 'markdown');
  assert.strictEqual(editorMod.languageFromPath('styles.css'), 'css');
  assert.strictEqual(editorMod.languageFromPath('main.py'), 'python');
  assert.ok(typeof editorMod.initWorkspaceFilesystem === 'function');
  console.log('   languageFromPath + exported filesystem init');

  console.log('7. Token mode still serves /js as a public GET');
  const tokenAuth = new AuthMiddleware({ token: 'secret', bindHost: '0.0.0.0' });
  const publicJs = tokenAuth.authenticate(
    { headers: {}, socket: { remoteAddress: '203.0.113.10' } },
    '/js/api-client.js',
    'GET'
  );
  assert.strictEqual(publicJs.authorized, true, '/js modules must be public GETs');
  const blockedApi = tokenAuth.authenticate(
    { headers: {}, socket: { remoteAddress: '203.0.113.10' } },
    '/api/sessions',
    'GET'
  );
  assert.strictEqual(blockedApi.authorized, false, 'API routes stay token-gated');
  console.log('   public module assets, gated API');

  console.log('\n======================================================');
  console.log('  PASS: STUDIO MODULE & EDITOR CONTRACTS PASSED');
  console.log('======================================================\n');
}

if (require.main === module) {
  runStudioModuleTests().catch(err => {
    console.error('FAIL: Studio module test failed:', err);
    process.exit(1);
  });
}

module.exports = { runStudioModuleTests };
