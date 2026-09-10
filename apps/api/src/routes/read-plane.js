/**
 * @file apps/api/src/routes/read-plane.js
 * Read-only MCP-equivalent HTTP surface. No writes, no OAS2 store merge.
 */

const { READ_TOOLS, handleReadTool } = require('../../../../packages/engine/src/mcp-read-plane');

module.exports = async function readPlaneRoutes(req, res, pathname) {
  if (pathname === '/api/read-plane' && req.method === 'GET') {
    return this.sendJson(res, 200, {
      schemaVersion: 'oas.read-plane.v1',
      capability: 'mcp-read-only',
      mutation: false,
      tools: READ_TOOLS
    });
  }

  if (pathname === '/api/read-plane/sessions' && req.method === 'GET') {
    return this.sendJson(res, 200, handleReadTool('list_sessions', {
      store: this.store,
      oas2DbPath: process.env.OAS2_DB
    }));
  }

  if (pathname === '/api/read-plane/diff' && req.method === 'GET') {
    return this.sendJson(res, 200, handleReadTool('get_diff', { workspaceRoot: this.workspaceRoot }));
  }

  if (pathname === '/api/read-plane/worktree' && req.method === 'GET') {
    return this.sendJson(res, 200, handleReadTool('worktree_status', {
      workspaceRoot: this.workspaceRoot,
      worktrees: this.worktrees
    }));
  }

  if (pathname === '/api/read-plane/call' && req.method === 'POST') {
    try {
      const body = await this.parseBody(req);
      const name = String(body.tool || body.name || '').trim();
      const result = handleReadTool(name, {
        store: this.store,
        workspaceRoot: this.workspaceRoot,
        worktrees: this.worktrees,
        oas2DbPath: process.env.OAS2_DB
      });
      return this.sendJson(res, 200, result);
    } catch (err) {
      return this.sendJson(res, err.code === 'READ_PLANE_DENIED' ? 403 : 400, {
        error: err.message,
        errorCode: err.code || 'READ_PLANE_FAILED'
      });
    }
  }
};
