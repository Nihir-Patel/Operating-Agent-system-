/**
 * @file tests/kg-camera.test.js
 * Knowledge Graph camera math, live-agent matching, and launch-burst photons.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadCamera() {
  const file = path.join(__dirname, '../apps/web/js/kg-camera.js');
  return import(pathToFileURL(file).href);
}

async function run() {
  console.log('\n======================================================');
  console.log('  KNOWLEDGE GRAPH CAMERA & LIVE VISUALS');
  console.log('======================================================\n');

  const cam = await loadCamera();

  console.log('1. Cursor-anchored zoom keeps the world point under the pointer');
  const centered = cam.computeZoomPan({
    cursorX: 400,
    cursorY: 300,
    centerX: 400,
    centerY: 300,
    panX: 0,
    panY: 0,
    zoom: 1,
    nextZoom: 2
  });
  assert.strictEqual(centered.zoom, 2);
  assert.strictEqual(centered.panX, 0);
  assert.strictEqual(centered.panY, 0);

  const offset = cam.computeZoomPan({
    cursorX: 500,
    cursorY: 300,
    centerX: 400,
    centerY: 300,
    panX: 0,
    panY: 0,
    zoom: 1,
    nextZoom: 2
  });
  assert.strictEqual(offset.panX, -100);
  assert.strictEqual(offset.panY, 0);

  const screenAfter = 400 + 100 * offset.zoom + offset.panX;
  assert.strictEqual(screenAfter, 500);

  const zoomOut = cam.computeZoomPan({
    cursorX: 500,
    cursorY: 300,
    centerX: 400,
    centerY: 300,
    panX: -100,
    panY: 0,
    zoom: 2,
    nextZoom: 1
  });
  assert.ok(Math.abs(zoomOut.panX) < 1e-9);
  assert.ok(Math.abs(zoomOut.zoom - 1) < 1e-9);
  console.log('   screen = center + world * zoom + pan stays cursor-stable');

  console.log('2. Zoom clamps and wheel factors are professional, not stepped jumps');
  assert.strictEqual(cam.clampKgZoom(0.01), cam.KG_ZOOM_MIN);
  assert.strictEqual(cam.clampKgZoom(99), cam.KG_ZOOM_MAX);
  assert.ok(cam.wheelZoomFactor(-120, 0) > 1);
  assert.ok(cam.wheelZoomFactor(120, 0) < 1);
  const pinch = cam.wheelZoomFactor(-80, 0, { pinch: true });
  const mouse = cam.wheelZoomFactor(-80, 0, { pinch: false });
  assert.ok(pinch > 1 && pinch < mouse, 'trackpad pinch should be finer than mouse wheel');
  assert.ok(cam.wheelZoomFactor(-400, 0) < 1.28, 'a single wheel tick must not jump past ~25%');
  assert.ok(cam.wheelZoomFactor(400, 0) > 0.78, 'a single wheel tick must not collapse the view');
  assert.strictEqual(cam.formatKgZoomPercent(1), '100%');
  assert.strictEqual(cam.formatKgZoomPercent(1.15), '115%');
  assert.strictEqual(cam.formatKgZoomPercent(0.5), '50%');
  console.log('   clamp + exponential wheel + percent HUD');

  console.log('3. Live matching is honest — idle nodes stay idle');
  const tdd = { id: 'agent:tdd-guide', name: 'tdd-guide' };
  assert.strictEqual(cam.matchLiveAgent(tdd, []), false);
  assert.strictEqual(cam.matchLiveAgent(tdd, ['planner']), false);
  assert.strictEqual(cam.matchLiveAgent(tdd, ['code-reviewer', 'architect']), false);
  assert.strictEqual(cam.matchLiveAgent(tdd, ['tdd-guide']), true);
  assert.strictEqual(cam.matchLiveAgent(tdd, ['agent:tdd-guide']), true);
  assert.strictEqual(cam.matchLiveAgent({ id: 'agent:planner', name: 'planner' }, ['planner']), true);
  assert.strictEqual(cam.isKgNodeEnergized(tdd, ['planner'], new Map(), 1), null);
  const local = new Map([['agent:tdd-guide', { until: 8, kind: 'launch' }]]);
  assert.strictEqual(cam.isKgNodeEnergized(tdd, [], local, 2), 'launch');
  assert.strictEqual(cam.isKgNodeEnergized(tdd, [], local, 9), null);
  console.log('   tdd-guide lights only when that agent is actually running');

  console.log('4. Missing metrics stay blank instead of invented latency');
  assert.strictEqual(cam.formatKgRunCount(null), '—');
  assert.strictEqual(cam.formatKgRunCount({ runs: 4 }), '4');
  assert.strictEqual(cam.formatKgLatency(null), '—');
  assert.strictEqual(cam.formatKgLatency({ avgLatencyMs: 180 }), '180ms');
  assert.strictEqual(cam.formatKgLatency({ avgLatencyMs: 'nope' }), '—');
  console.log('   inspector idle metrics use an em dash');

  console.log('5. Launch bursts travel once along connected synapses');
  const edges = [
    { source: 'agent:tdd-guide', target: 'agent:planner' },
    { source: 'skill:tdd-workflow', target: 'agent:architect' },
    { source: 'agent:tdd-guide', target: 'agent:code-reviewer' }
  ];
  const burst = cam.createEdgeBurstPhotons(edges, 'agent:tdd-guide', { max: 8 });
  assert.strictEqual(burst.length, 2);
  assert.ok(burst.every(p => p.burst === true && p.progress === 0));
  const dying = [{ burst: true, progress: 1.2 }, { burst: false, progress: 0.4 }, burst[0]];
  const pruned = cam.pruneKgPhotons(dying, { max: 10 });
  assert.strictEqual(pruned.length, 2);
  assert.ok(!pruned.some(p => p.burst && p.progress >= 1));
  console.log('   burst photons prune after one trip');

  console.log('6. Studio graph no longer fakes tdd-guide live status');
  const appJs = fs.readFileSync(path.join(__dirname, '../apps/web/app.js'), 'utf8');
  assert.doesNotMatch(
    appJs,
    /node\.id === 'agent:tdd-guide' && \(kgActiveTelemetry\.activeAgents/
  );
  assert.doesNotMatch(appJs, /'620ms'/);
  assert.ok(appJs.includes("from './js/kg-camera.js'"), 'app.js must import kg-camera');
  console.log('   honesty guards in app.js');

  console.log('\n  kg-camera tests passed\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
