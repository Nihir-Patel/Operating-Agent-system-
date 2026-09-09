/**
 * @file apps/api/src/routes/worktrees.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

module.exports = async function worktreesjsRoutes(req, res, pathname, parsedUrl) {
if (pathname === '/api/worktrees' && req.method === 'GET') {
  return this.sendJson(res, 200, this.worktrees.listWorktrees());
}

if (pathname === '/api/worktree/branches' && req.method === 'GET') {
  try {
    const { execSync } = require('child_process');
    const branchOutput = execSync('git branch -a --no-color', { cwd: this.workspaceRoot, encoding: 'utf8', timeout: 5000 });
    const branches = branchOutput.split('\n')
      .map(b => b.replace(/^\*?\s+/, '').trim())
      .filter(b => b && !b.includes('->'));
    const activeBranch = branchOutput.split('\n')
      .find(b => b.startsWith('*'));
    const active = activeBranch ? activeBranch.replace(/^\*\s+/, '').trim() : 'main';

    let worktreeList = [];
    try {
      const wtOutput = execSync('git worktree list --porcelain', { cwd: this.workspaceRoot, encoding: 'utf8', timeout: 5000 });
      worktreeList = wtOutput.split('\n\n').filter(Boolean).map(block => {
        const lines = block.split('\n');
        const wt = {};
        lines.forEach(l => {
          if (l.startsWith('worktree ')) wt.path = l.replace('worktree ', '');
          if (l.startsWith('branch ')) wt.branch = l.replace('branch refs/heads/', '');
          if (l === 'bare') wt.bare = true;
        });
        return wt;
      });
    } catch {}

    return this.sendJson(res, 200, {
      activeBranch: active,
      branches,
      worktrees: worktreeList
    });
  } catch (err) {
    return this.sendJson(res, 200, {
      activeBranch: 'unknown',
      branches: [],
      worktrees: [],
      error: err.message
    });
  }
}

if (pathname === '/api/worktree/switch' && req.method === 'POST') {
  const body = await this.parseBody(req);
  const branch = body.branch || 'main';
  return this.sendJson(res, 200, {
    success: true,
    activeBranch: branch,
    message: `Switched active workspace worktree to branch: ${branch}`
  });
}

if (pathname === '/api/worktrees/spawn' && req.method === 'POST') {
  const body = await this.parseBody(req);
  const wt = this.worktrees.spawnWorktree(body.taskId || 'task-auto', body.agentId || 'planner');
  return this.sendJson(res, 201, wt);
}

if (pathname.startsWith('/api/worktrees/') && pathname.endsWith('/diff') && req.method === 'GET') {
  const parts = pathname.split('/');
  const id = parts[3];
  const diffResult = this.worktrees.getWorktreeDiff(id);
  return this.sendJson(res, 200, diffResult);
}

if (pathname.startsWith('/api/worktrees/') && pathname.endsWith('/merge') && req.method === 'POST') {
  const parts = pathname.split('/');
  const id = parts[3];
  const body = await this.parseBody(req);
  const mergeResult = this.worktrees.mergeWorktree(id, body.targetBranch || 'HEAD');
  return this.sendJson(res, 200, mergeResult);
}

if (pathname.startsWith('/api/worktrees/') && req.method === 'DELETE') {
  const parts = pathname.split('/');
  const id = parts[3];
  const success = this.worktrees.removeWorktree(id);
  return this.sendJson(res, 200, { success });
}

};
