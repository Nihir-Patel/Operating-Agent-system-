/**
 * @file packages/engine/src/mcp-read-plane.js
 * Read-only Studio plane: sessions, git diff, worktree status. No mutations.
 */

const { execFileSync } = require('child_process');

const READ_TOOLS = Object.freeze([
  { name: 'list_sessions', description: 'List Studio sessions (id, title, status). Read-only.' },
  { name: 'get_diff', description: 'Show git diff against HEAD. Read-only.' },
  { name: 'worktree_status', description: 'List isolated worktrees and current branch. Read-only.' }
]);

function listSessions(store) {
  const sessions = store && typeof store.getSessions === 'function' ? store.getSessions() : [];
  return sessions.map(session => ({
    id: session.id,
    title: session.title || '',
    status: session.status || 'unknown',
    leadAgentId: session.lead_agent_id || session.leadAgentId || null,
    source: session.source || 'studio'
  }));
}

function getDiff(workspaceRoot, options = {}) {
  const execFile = options.execFileSync || execFileSync;
  try {
    const diff = execFile('git', ['diff', 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 8000,
      maxBuffer: 200 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return {
      empty: !String(diff || '').trim(),
      diff: String(diff || '').slice(0, 20000)
    };
  } catch {
    return { empty: true, diff: '', error: 'git diff unavailable' };
  }
}

function worktreeStatus(workspaceRoot, worktrees, options = {}) {
  const execFile = options.execFileSync || execFileSync;
  let branch = 'unknown';
  try {
    branch = execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    branch = 'unknown';
  }
  const list = worktrees && typeof worktrees.listWorktrees === 'function'
    ? worktrees.listWorktrees()
    : [];
  return {
    branch,
    worktrees: list.map(item => ({
      id: item.id,
      branch: item.branch || null,
      path: item.path || null
    }))
  };
}

function handleReadTool(name, context = {}) {
  if (name === 'list_sessions') {
    const { listOas2Sessions } = require('./oas2-read-bridge');
    const studio = listSessions(context.store);
    const oas2 = listOas2Sessions({ dbPath: context.oas2DbPath });
    return { ok: true, data: [...studio, ...oas2] };
  }
  if (name === 'get_diff') return { ok: true, data: getDiff(context.workspaceRoot, context) };
  if (name === 'worktree_status') {
    return { ok: true, data: worktreeStatus(context.workspaceRoot, context.worktrees, context) };
  }
  const err = new Error('Unknown or mutating tool is not exposed on the read plane');
  err.code = 'READ_PLANE_DENIED';
  throw err;
}

module.exports = {
  READ_TOOLS,
  listSessions,
  getDiff,
  worktreeStatus,
  handleReadTool
};
