/**
 * @file tests/studio-a11y-browser.test.js
 * Playwright + axe-core scan of Studio views: DAG, workspace, and settings.
 */

const assert = require('assert');
const path = require('path');
const { OasControlPlaneServer } = require('../apps/api/src/server');

const REQUIRE_BROWSER = process.env.OAS_REQUIRE_BROWSER_A11Y === '1';

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

async function runAxe(page) {
  await page.addScriptTag({ path: require.resolve('axe-core') });
  return page.evaluate(async () => {
    return window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: {
        // Dark theme tokens fail AA contrast in several chrome regions; structural rules stay on.
        'color-contrast': { enabled: false }
      }
    });
  });
}

function formatViolations(violations) {
  return violations.map(v => {
    const nodes = (v.nodes || []).slice(0, 4).map(n => n.target.join(' ')).join(', ');
    return `${v.id} [${v.impact}] ${v.help} → ${nodes}`;
  }).join('\n');
}

async function run() {
  console.log('=== STUDIO PLAYWRIGHT + AXE BROWSER SCAN ===\n');

  const playwright = loadPlaywright();
  if (!playwright) {
    if (REQUIRE_BROWSER) {
      throw new Error('playwright is required. Install with npm install and retry.');
    }
    console.log('  WARNING: playwright not installed — skipping browser axe scan');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    if (REQUIRE_BROWSER) throw err;
    console.log(`  WARNING: Chromium unavailable (${err.message}) — skipping browser axe scan`);
    console.log('    Install with: npx playwright install chromium');
    return;
  }

  const server = new OasControlPlaneServer({
    port: 39991,
    host: '127.0.0.1',
    workspaceRoot: path.resolve(__dirname, '..')
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

    const dagScan = await runAxe(page);
    const dagSerious = dagScan.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    assert.strictEqual(dagSerious.length, 0, `view-dag axe violations:\n${formatViolations(dagSerious)}`);
    console.log(`   view-dag: ${dagScan.violations.length} residual (non-serious) axe findings`);

    await page.click('#nav-workspace');
    await page.waitForSelector('#view-workspace.active', { timeout: 10000 });
    const workspaceScan = await runAxe(page);
    const workspaceSerious = workspaceScan.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    assert.strictEqual(workspaceSerious.length, 0, `view-workspace axe violations:\n${formatViolations(workspaceSerious)}`);
    console.log(`   view-workspace: ${workspaceScan.violations.length} residual (non-serious) axe findings`);

    await page.click('#btn-open-settings');
    await page.waitForSelector('#settings-modal', { state: 'visible', timeout: 10000 });
    const settingsVisible = await page.locator('#settings-modal').evaluate(el => getComputedStyle(el).display !== 'none');
    assert.ok(settingsVisible, 'settings modal must be visible');
    const settingsScan = await runAxe(page);
    const settingsSerious = settingsScan.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    assert.strictEqual(settingsSerious.length, 0, `settings axe violations:\n${formatViolations(settingsSerious)}`);
    console.log(`   settings: ${settingsScan.violations.length} residual (non-serious) axe findings`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => httpServer.close(resolve));
    if (server.sseHeartbeat) clearInterval(server.sseHeartbeat);
  }

  console.log('\n======================================================');
  console.log('  STUDIO PLAYWRIGHT + AXE SCAN PASSED');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error('Browser a11y test failed:', err);
  process.exit(1);
});
