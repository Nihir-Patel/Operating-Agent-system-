/**
 * @file tests/studio-workspace-visual.test.js
 * Live Workspace cockpit chrome, primed empty state, and idle-status honesty.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');

function read(rel) {
  return fs.readFileSync(path.join(WEB, rel), 'utf8');
}

function run() {
  console.log('\n======================================================');
  console.log('  LIVE WORKSPACE VISUAL COCKPIT');
  console.log('======================================================\n');

  const html = read('index.html');
  const css = read('styles.css');
  const appJs = read('app.js');
  const editorJs = read('js/workspace-editor.js');

  console.log('1. Workspace is a three-pane cockpit, not three flat cards');
  assert.ok(html.includes('workspace-cockpit'), 'workspace grid must use cockpit class');
  assert.match(css, /\.workspace-cockpit/);
  assert.match(css, /\.ws-pane::before/);
  assert.match(css, /\.stream-empty-orb/);
  assert.match(css, /\.ws-sse-pill/);
  console.log('   cockpit chrome + primed orb + SSE pill');

  console.log('2. Empty thought stream uses a holographic primed state');
  assert.ok(appJs.includes('stream-empty-state'));
  assert.ok(appJs.includes('stream-empty-orb'));
  assert.ok(appJs.includes('stream-empty-title'));
  assert.doesNotMatch(appJs, /class="stream-empty-state" style="[^"]*dashed/);
  console.log('   dashed placeholder box is gone');

  console.log('3. Sample GitHub sessions are labeled instead of looking live');
  assert.ok(appJs.includes('formatStudioWorkLabel') || appJs.includes('studio-labels'));
  assert.ok(appJs.includes('Sample') && (appJs.includes('formatStudioWorkLabel') || editorJs.includes('formatStudioWorkLabel')));
  console.log('   primed stream uses honest sample labels');

  console.log('4. Zero-step sessions stay STANDBY instead of fake-active');
  assert.ok(appJs.includes("'STANDBY'"));
  assert.ok(html.includes('STANDBY') || html.includes('is-standby'));
  assert.ok(editorJs.includes('dataset.kind') || editorJs.includes("data-kind"));
  console.log('   idle badge + file-tree kind tokens');

  console.log('\n  workspace visual tests passed\n');
}

run();
