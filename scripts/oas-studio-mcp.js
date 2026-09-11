#!/usr/bin/env node
/**
 * OAS Studio read-only MCP stdio server.
 * Tools: list_sessions, get_diff, worktree_status. No writes. No OAS2 store merge.
 */

const { MemoryStore, OasSqliteStore } = require('../packages/db/src/index');
const { WorktreeRunner } = require('../packages/engine/src/worktree-runner');
const { READ_TOOLS, handleReadTool } = require('../packages/engine/src/mcp-read-plane');

function openStore() {
  const storagePath = process.env.OAS_STUDIO_DB;
  if (storagePath && storagePath.endsWith('.sqlite')) {
    return new OasSqliteStore({ storagePath });
  }
  return new MemoryStore({ storagePath: storagePath || undefined });
}

function context() {
  const workspaceRoot = process.env.OAS_STUDIO_ROOT || process.cwd();
  const store = openStore();
  return {
    store,
    workspaceRoot,
    worktrees: new WorktreeRunner({ repoRoot: workspaceRoot, store })
  };
}

const { feedMcpBuffer } = require('../packages/engine/src/mcp-framing');

const LATEST_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  LATEST_PROTOCOL_VERSION,
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
]);

function send(id, result, error) {
  const payload = error
    ? { jsonrpc: '2.0', id, error }
    : { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function resolveProtocolVersion(params) {
  const requested = params && typeof params.protocolVersion === 'string'
    ? params.protocolVersion
    : '';
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  const { id, method, params } = message;
  if (method === 'notifications/initialized') return;
  if (method === 'initialize') {
    return send(id, {
      protocolVersion: resolveProtocolVersion(params),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'oas-studio-read', version: '2.2.1' }
    });
  }
  if (method === 'ping') {
    return send(id, {});
  }
  if (method === 'tools/list') {
    return send(id, {
      tools: READ_TOOLS.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: { type: 'object', additionalProperties: false, properties: {} }
      }))
    });
  }
  if (method === 'tools/call') {
    try {
      const name = params && params.name;
      const result = handleReadTool(name, context());
      return send(id, {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }]
      });
    } catch (err) {
      return send(id, null, { code: -32000, message: err.message });
    }
  }
  if (id !== undefined) send(id, null, { code: -32601, message: `Method not found: ${method}` });
}

if (require.main === module) {
  let rest = Buffer.alloc(0);
  process.stdin.on('data', chunk => {
    const fed = feedMcpBuffer(Buffer.concat([rest, Buffer.from(chunk)]), message => {
      Promise.resolve(handle(message)).catch(err => {
        send(message && message.id !== undefined ? message.id : null, null, {
          code: -32603,
          message: err.message
        });
      });
    });
    rest = fed.rest;
  });
}

module.exports = { handle };
