/**
 * @file apps/api/src/routes/first-run.js
 * First-run checklist for Local Studio. Never echoes secrets.
 */

const {
  commandExists,
  evaluateFirstRun,
  readCursorMcpConfig,
} = require('../../../../packages/engine/src/studio-first-run');

function loadMcpConfig(workspaceRoot) {
  try {
    return readCursorMcpConfig(workspaceRoot);
  } catch {
    return { mcpServers: {} };
  }
}

function buildReport(server) {
  const settings = (server.store && server.store.getSettings && server.store.getSettings()) || {};
  const vault = server.store && typeof server.store.getMemoryVault === 'function'
    ? server.store.getMemoryVault()
    : [];
  return evaluateFirstRun({
    settings,
    env: process.env,
    vaultCount: Array.isArray(vault) ? vault.length : 0,
    mcpConfig: loadMcpConfig(server.workspaceRoot),
    cliOnPath: commandExists('oas'),
    dismissed: Boolean(settings.firstRunDismissed),
  });
}

module.exports = async function firstRunRoutes(req, res, pathname) {
  if (pathname === '/api/first-run' && req.method === 'GET') {
    return this.sendJson(res, 200, buildReport(this));
  }

  if (pathname === '/api/first-run/dismiss' && req.method === 'POST') {
    const body = await this.parseBody(req);
    const dismissed = body.dismissed !== false;
    if (this.store && typeof this.store.saveSettings === 'function') {
      this.store.saveSettings({ firstRunDismissed: dismissed });
    }
    return this.sendJson(res, 200, { ...buildReport(this), dismissed });
  }
};
