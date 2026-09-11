/**
 * @file tests/studio-visual-system.test.js
 * Every Studio view uses the Workspace/KG cockpit language, not flat cards.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '../apps/web');

function run() {
  console.log('\n======================================================');
  console.log('  STUDIO VISUAL SYSTEM (ALL VIEWS)');
  console.log('======================================================\n');

  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(WEB, 'styles.css'), 'utf8');
  const appJs = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  const stateJs = fs.readFileSync(path.join(WEB, 'js/studio-state.js'), 'utf8');

  console.log('1. Shared cockpit toolbar + scanlines exist');
  assert.match(css, /\.cockpit-toolbar/);
  assert.match(css, /\.cockpit-scanlines/);
  assert.match(css, /\.cockpit-body/);
  assert.match(css, /\.view-title-kicker/);
  console.log('   toolbar / scanlines / body / title kicker');

  console.log('2. View identity is a single top-bar kicker, not repeated on panes');
  assert.ok(html.includes('view-title-kicker'), 'top bar must show the active-view kicker');
  ['GRAPH', 'PLAN', 'CATALOG', 'VAULT', 'BUILDER'].forEach(kicker => {
    assert.ok(
      !html.includes(`ws-pane-kicker">${kicker}<`) && !html.includes(`ws-pane-kicker">${kicker}</span>`),
      `${kicker} must not repeat on a pane toolbar`
    );
  });
  ['INSPECT', 'FS', 'STREAM', 'CODE', 'NODE', 'REVIEW', 'HUD'].forEach(kicker => {
    assert.ok(
      html.includes(`ws-pane-kicker">${kicker}<`) || html.includes(`ws-pane-kicker">${kicker}</span>`),
      `missing local ${kicker} pane kicker`
    );
  });
  console.log('   top-bar kicker only + local pane kickers');

  console.log('3. Cards and HUD cells share holographic treatment');
  assert.match(css, /\.stat-card\.cockpit-cell|\.cockpit-cell/);
  assert.match(css, /\.catalog-card::after|\.catalog-card .catalog-type-kicker/);
  assert.match(css, /\.phase-card/);
  assert.match(css, /\.memory-card::after|\.memory-card/);
  assert.match(css, /\.memory-items-grid[\s\S]{0,280}grid-auto-rows:\s*min-content/);
  assert.match(css, /\.memory-card-body/);
  assert.match(css, /\.btn-delete-mem/);
  console.log('   stat / catalog / phase / memory cards');

  console.log('4. switchView updates the top-bar kicker from viewKickers');
  assert.match(stateJs, /viewKickers/);
  assert.match(appJs, /viewKickers/);
  assert.match(appJs, /view-title-kicker/);
  console.log('   kicker map wired into switchView');

  console.log('5. Screenshot typography stays readable (no HUD tracking on body copy)');
  assert.match(css, /body\s*\{[^}]*letter-spacing:\s*-0\.015em/);
  assert.doesNotMatch(css, /\.ws-pane-kicker\s*\{[^}]*letter-spacing:\s*0\.(1[0-9]|[2-9]\d)em/);
  assert.doesNotMatch(css, /\.catalog-empty-kicker\s*\{[^}]*letter-spacing:\s*0\.(1[0-9]|[2-9]\d)em/);
  assert.doesNotMatch(css, /\.ws-composer-label\s*\{[^}]*letter-spacing:\s*0\.(1[0-9]|[2-9]\d)em/);
  assert.doesNotMatch(css, /\.ws-quick-label\s*\{[^}]*letter-spacing:\s*0\.(1[0-9]|[2-9]\d)em/);
  console.log('   kicker tracking capped for screenshots');

  console.log('6. Views fill the viewport without gutter gaps');
  assert.ok(html.includes('cockpit-fill'), 'viewport must opt into flush fill');
  assert.match(css, /\.cockpit-fill \.view-panel/);
  assert.match(css, /\.cockpit-fill \.dag-container/);
  assert.match(css, /\.dag-canvas-area\.is-topology/);
  assert.doesNotMatch(html, /topology-3d-canvas"[^>]*height:\s*560px/);
  assert.match(css, /\.cockpit-fill \.catalog-container/);
  assert.match(css, /\.cockpit-toolbar-cluster/);
  assert.match(css, /flex-shrink:\s*0\s*!important/);
  assert.match(css, /\.inspector-footer/);
  assert.match(css, /topbar-btn > span:not\(\.kbd-pill\)/);
  assert.ok(html.includes('inspector-footer'), 'inspector actions must pin to a footer');
  console.log('   flush shell + composed interior + pinned inspector footer');

  console.log('\n  visual system tests passed\n');
}

run();
