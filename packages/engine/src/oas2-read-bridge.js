/**
 * @file packages/engine/src/oas2-read-bridge.js
 * Read-only listing of OAS2 SQLite sessions. Does not write or merge stores.
 */

const fs = require('fs');
const path = require('path');

function resolveOas2DbPath(options = {}) {
  if (options.dbPath) return options.dbPath;
  if (process.env.OAS2_DB) return process.env.OAS2_DB;
  const home = options.homeDir || process.env.HOME || process.env.USERPROFILE;
  if (!home) return null;
  const fromToml = path.join(home, '.claude', 'oas2.sqlite');
  if (fs.existsSync(fromToml)) return fromToml;
  return null;
}

function listOas2Sessions(options = {}) {
  const dbPath = resolveOas2DbPath(options);
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  try {
    const { DatabaseSync } = options.DatabaseSync || require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db.prepare(
        'SELECT id, task, state, agent_type FROM sessions LIMIT 50'
      ).all();
      return (rows || []).map(row => ({
        id: row.id,
        title: row.task || '',
        status: row.state || 'unknown',
        leadAgentId: row.agent_type || null,
        source: 'oas2'
      }));
    } finally {
      if (typeof db.close === 'function') db.close();
    }
  } catch {
    return [];
  }
}

module.exports = {
  resolveOas2DbPath,
  listOas2Sessions
};
