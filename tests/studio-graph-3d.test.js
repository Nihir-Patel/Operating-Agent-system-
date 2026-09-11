/**
 * @file tests/studio-graph-3d.test.js
 * Shared 3D graph math used by Execution DAG topology and Knowledge Graph visuals.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadGraph3d() {
  const file = path.join(__dirname, '../apps/web/js/studio-graph-3d.js');
  return import(pathToFileURL(file).href);
}

async function run() {
  console.log('\n======================================================');
  console.log('  STUDIO 3D GRAPH (DAG TOPOLOGY + KG PARITY)');
  console.log('======================================================\n');

  const graph = await loadGraph3d();

  console.log('1. Origin projects to canvas center');
  const origin = graph.projectPerspective3D(0, 0, 0, {
    rotX: 0.32,
    rotY: -0.38,
    fov: 720,
    zoom: 1,
    panX: 0,
    panY: 0,
    cx: 640,
    cy: 360
  });
  assert.ok(Math.abs(origin.x - 640) < 1e-6);
  assert.ok(Math.abs(origin.y - 360) < 1e-6);
  assert.ok(origin.scale > 0);
  console.log('   hub at (0,0,0) lands on the viewport midpoint');

  console.log('2. Topology nodes are recentered and scaled around the hub');
  const raw = [
    { id: 'hub', x: 40, y: -10, z: 20, type: 'hub' },
    { id: 'a', x: 260, y: 80, z: -40, type: 'agent' },
    { id: 'b', x: -180, y: 120, z: 90, type: 'skill' }
  ];
  const centered = graph.centerAndScaleNodes(raw, 280);
  const hub = centered.find(n => n.type === 'hub');
  assert.ok(Math.hypot(hub.x, hub.y, hub.z) < 1e-6, 'hub must stay at the origin');
  const maxR = Math.max(...centered.map(n => Math.hypot(n.x, n.y, n.z)));
  assert.ok(Math.abs(maxR - 280) < 1e-6, 'farthest node must sit on the target radius');
  console.log('   hub origin + fit radius');

  console.log('3. Prepared nodes carry KG glass-sphere palette and breath fields');
  const prepared = graph.prepareTopologyNodes(centered);
  const preparedHub = prepared.find(n => n.type === 'hub');
  const agent = prepared.find(n => n.type === 'agent');
  assert.ok(preparedHub.brightColor && preparedHub.color && preparedHub.darkColor);
  assert.ok(agent.brightColor !== preparedHub.brightColor);
  assert.ok(Number.isFinite(preparedHub.phase) && Number.isFinite(preparedHub.freq));
  assert.ok(preparedHub.baseRadius > agent.baseRadius);
  console.log('   palette + phase + hub larger than agents');

  console.log('4. Dust field seeds a stable constellation');
  const dust = graph.createSpaceDust(40);
  assert.strictEqual(dust.length, 40);
  assert.ok(dust.every(p => Number.isFinite(p.x) && Number.isFinite(p.size)));
  console.log('   40 space particles');

  console.log('5. HiDPI canvas matches CSS box * devicePixelRatio');
  const canvas = {
    width: 0,
    height: 0
  };
  const size = graph.resizeHiDpiCanvas(canvas, { width: 1200, height: 800, dpr: 2 });
  assert.strictEqual(canvas.width, 2400);
  assert.strictEqual(canvas.height, 1600);
  assert.deepStrictEqual(size, { width: 1200, height: 800, dpr: 2 });
  console.log('   backing store is 2x the layout box');

  const html = fs.readFileSync(path.join(__dirname, '../apps/web/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../apps/web/styles.css'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../apps/web/app.js'), 'utf8');

  console.log('6. DAG topology canvas fills the pane like Knowledge Graph');
  assert.doesNotMatch(html, /topology-3d-canvas"[^>]*height:\s*560px/);
  assert.match(css, /#topology-3d-canvas|topology-3d-canvas/);
  assert.match(css, /\.dag-canvas-area\.is-topology/);
  assert.ok(appJs.includes('./js/studio-graph-3d.js'));
  assert.ok(appJs.includes('prepareTopologyNodes'));
  console.log('   full-pane canvas + shared 3D module');

  console.log('\n  studio 3d graph tests passed\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
