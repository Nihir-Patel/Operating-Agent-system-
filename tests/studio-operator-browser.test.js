/**
 * @file tests/studio-operator-browser.test.js
 * Playwright operator flows: DAG, workspace editor host, HITL modal.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MemoryStore } = require('../packages/db/src/index');
const { OasControlPlaneServer } = require('../apps/api/src/server');

const REQUIRE_BROWSER = process.env.OAS_REQUIRE_BROWSER_E2E === '1';

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

async function run() {
  console.log('=== STUDIO OPERATOR PLAYWRIGHT FLOWS ===\n');

  const playwright = loadPlaywright();
  if (!playwright) {
    if (REQUIRE_BROWSER) {
      throw new Error('playwright is required. Install with npm install and retry.');
    }
    console.log('  ⚠ playwright not installed — skipping operator browser flows');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    if (REQUIRE_BROWSER) throw err;
    console.log(`  ⚠ Chromium unavailable (${err.message}) — skipping operator browser flows`);
    console.log('    Install with: npx playwright install chromium');
    return;
  }

  const server = new OasControlPlaneServer({
    port: 39998,
    host: '127.0.0.1',
    workspaceRoot: path.resolve(__dirname, '..'),
    store: new MemoryStore({
      storagePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oas-op-inbox-')), 'store.json')
    })
  });

  const httpServer = await new Promise((resolve, reject) => {
    const started = server.start((srv) => resolve(srv));
    if (started) started.once('error', reject);
  });
  const port = server.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#view-dag', { timeout: 15000 });
    const dagActive = await page.locator('#view-dag').evaluate(el => el.classList.contains('active'));
    assert.ok(dagActive, 'DAG view must be the default operator surface');
    await page.waitForSelector('#nav-dag[aria-current="page"]', { timeout: 5000 });
    console.log('  ✔ DAG view boots as the default surface');

    await page.click('#nav-workspace');
    await page.waitForSelector('#view-workspace.active', { timeout: 10000 });
    await page.waitForSelector('#monaco-editor-host', { state: 'attached', timeout: 5000 });
    const fileBadge = await page.locator('#code-viewer-file-badge').textContent();
    assert.ok(fileBadge && fileBadge.trim().length > 0, 'workspace must show an open file badge');
    console.log('  ✔ workspace view exposes Monaco host and file badge');

    const studioViews = [
      ['#nav-knowledge-graph', '#view-knowledge-graph'],
      ['#nav-plan-canvas', '#view-plan-canvas'],
      ['#nav-catalog', '#view-catalog'],
      ['#nav-vault', '#view-vault'],
      ['#nav-builder', '#view-builder']
    ];
    for (const [nav, view] of studioViews) {
      await page.click(nav);
      await page.waitForSelector(`${view}.active`, { timeout: 8000 });
    }
    await page.click('#btn-toggle-sessions');
    await page.waitForFunction(() => {
      const el = document.getElementById('session-drawer-overlay');
      return el && getComputedStyle(el).display !== 'none';
    }, null, { timeout: 5000 });
    await page.click('#btn-close-sessions');
    await page.click('#btn-open-settings');
    await page.waitForSelector('#settings-modal', { state: 'visible', timeout: 5000 });
    await page.click('#settings-modal-close');
    console.log('  ✔ remaining Studio views, sessions drawer, and settings open');

    await page.click('#nav-vault');
    await page.waitForSelector('#view-vault.active', { timeout: 8000 });
    const vaultCopy = await page.locator('#view-vault').textContent();
    assert.ok(/local hash-vector/i.test(vaultCopy || ''), 'Memory vault must disclose local hash-vectors');
    assert.ok(/not pgvector/i.test(vaultCopy || ''), 'Memory vault must disclose it is not pgvector');

    await page.evaluate(() => {
      window.triggerHitlModal({
        agentId: 'security-reviewer',
        tool: 'write_file',
        command: 'write_file path=app.js'
      });
    });
    await page.waitForSelector('#hitl-modal', { state: 'visible', timeout: 5000 });
    const title = await page.locator('#hitl-modal-title').textContent();
    assert.ok(/Human-in-the-Loop/i.test(title || ''), 'HITL dialog title must be visible');
    await page.click('#btn-hitl-approve');
    await page.waitForFunction(() => {
      const el = document.getElementById('hitl-modal');
      return el && getComputedStyle(el).display === 'none';
    }, null, { timeout: 5000 });
    console.log('  ✔ HITL modal opens and approve dismisses it');

    await page.click('#btn-open-github-pr');
    await page.waitForSelector('#github-pr-modal', { state: 'visible', timeout: 5000 });
    const inboxTitle = await page.locator('#github-pr-modal-title').textContent();
    assert.ok(/Work inbox/i.test(inboxTitle || ''), 'Inbox modal title must be Work inbox');
    const emptyCopy = await page.locator('#inbox-list').textContent();
    assert.ok(/No imported items/i.test(emptyCopy || ''), 'empty inbox must be honest');
    const [importRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/inbox/import') && res.request().method() === 'POST', { timeout: 8000 }),
      page.click('#btn-inbox-import-github')
    ]);
    assert.ok(importRes.status() === 503 || importRes.status() === 200, 'GitHub import must be unconfigured or a real adapter/token response');
    await page.evaluate(async () => {
      await fetch('/api/inbox/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'items',
          items: [{ source: 'github-issue', sourceId: '77', title: 'Browser inbox item' }]
        })
      });
    });
    await page.click('#btn-inbox-refresh');
    await page.waitForFunction(() => {
      const el = document.getElementById('inbox-list');
      return el && /Browser inbox item/.test(el.textContent || '');
    }, null, { timeout: 5000 });
    await page.click('#btn-close-github-pr');
    await page.waitForFunction(() => {
      const el = document.getElementById('github-pr-modal');
      return el && getComputedStyle(el).display === 'none';
    }, null, { timeout: 5000 });
    console.log('  ✔ Inbox modal imports items and stays honest without a GitHub adapter');

    await page.click('#btn-open-arena');
    await page.waitForSelector('#arena-benchmark-modal', { state: 'visible', timeout: 5000 });
    const arenaCopy = await page.locator('#arena-benchmark-modal').textContent();
    assert.ok(/Eval harness/i.test(arenaCopy || ''), 'Arena must advertise eval harness scoring');
    assert.ok(/CUSTOM MUST CONTAIN/i.test(arenaCopy || ''), 'Arena must expose custom graders');
    assert.ok(/No recorded traces yet/i.test(arenaCopy || '') || /PASS|FAIL/.test(arenaCopy || ''), 'Arena must expose traces');
    assert.ok(!/Heuristic scoring \(length and latency\)/i.test(arenaCopy || ''), 'Arena must not claim length/latency heuristics');
    await page.click('#btn-close-arena');
    await page.waitForFunction(() => {
      const el = document.getElementById('arena-benchmark-modal');
      return el && getComputedStyle(el).display === 'none';
    }, null, { timeout: 5000 });
    console.log('  ✔ Arena modal labels pass@k eval harness scoring');
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => httpServer.close(resolve));
    if (server.sseHeartbeat) clearInterval(server.sseHeartbeat);
  }

  console.log('\n======================================================');
  console.log('  STUDIO OPERATOR PLAYWRIGHT FLOWS PASSED');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error('Operator browser test failed:', err);
  process.exit(1);
});
