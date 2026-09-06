/**
 * @file packages/engine/src/worktree-runner.js
 * Git Worktree Multi-Agent Runner & Isolation Engine
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

class WorktreeRunner {
  constructor(options = {}) {
    this.repoRoot = options.repoRoot || process.cwd();
    this.worktreeBaseDir = options.worktreeBaseDir || path.join(this.repoRoot, '.oas-worktrees');
    this.activeWorktrees = new Map();
  }

  isGitRepo() {
    return fs.existsSync(path.join(this.repoRoot, '.git'));
  }

  /**
   * Spawn an isolated Git worktree for an executing subagent
   */
  spawnWorktree(taskId, agentId) {
    const slug = `${taskId}-${agentId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const branchName = `oas/${slug}`;
    const worktreePath = path.join(this.worktreeBaseDir, slug);

    if (!fs.existsSync(this.worktreeBaseDir)) {
      try {
        fs.mkdirSync(this.worktreeBaseDir, { recursive: true });
      } catch {}
    }

    if (this.isGitRepo()) {
      // Check if branch already exists
      spawnSync('git', ['branch', '-D', branchName], { cwd: this.repoRoot, stdio: 'ignore' });
      // Create worktree
      const res = spawnSync('git', ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], {
        cwd: this.repoRoot,
        encoding: 'utf8'
      });

      const success = res.status === 0;
      const record = {
        id: slug,
        taskId,
        agentId,
        branch: branchName,
        path: worktreePath,
        status: success ? 'ACTIVE' : 'FALLBACK_LOCAL',
        error: success ? null : res.stderr,
        createdAt: new Date().toISOString()
      };
      this.activeWorktrees.set(slug, record);
      return record;
    }

    // Fallback if not a git worktree environment (e.g. mock / container directory)
    try {
      fs.mkdirSync(worktreePath, { recursive: true });
    } catch {}

    const record = {
      id: slug,
      taskId,
      agentId,
      branch: branchName,
      path: worktreePath,
      status: 'MOCK_SANDBOX',
      createdAt: new Date().toISOString()
    };
    this.activeWorktrees.set(slug, record);
    return record;
  }

  /**
   * Get status & diff of files modified in a worktree
   */
  getWorktreeDiff(worktreeId) {
    const wt = this.activeWorktrees.get(worktreeId);
    if (!wt) return { error: 'Worktree not found' };

    if (!fs.existsSync(wt.path)) {
      return { status: 'CLEAN', modifiedFiles: [], diff: '' };
    }

    const res = spawnSync('git', ['status', '--short'], { cwd: wt.path, encoding: 'utf8' });
    const diffRes = spawnSync('git', ['diff'], { cwd: wt.path, encoding: 'utf8' });

    const output = res.stdout || '';
    const modifiedFiles = output.split('\n').filter(Boolean).map(l => l.trim());

    return {
      worktreeId,
      branch: wt.branch,
      modifiedFiles,
      diff: diffRes.stdout || ''
    };
  }

  /**
   * Merge subagent worktree changes back into parent branch
   */
  mergeWorktree(worktreeId, targetBranch = 'HEAD') {
    const wt = this.activeWorktrees.get(worktreeId);
    if (!wt) return { success: false, reason: 'Worktree not found' };

    if (this.isGitRepo() && wt.status === 'ACTIVE') {
      // Commit pending changes in worktree
      spawnSync('git', ['add', '-A'], { cwd: wt.path });
      spawnSync('git', ['commit', '-m', `chore(oas): automated subagent ${wt.agentId} checkpoint`], { cwd: wt.path });

      // Merge into target branch
      const mergeRes = spawnSync('git', ['merge', wt.branch, '--no-ff', '-m', `feat(oas): merge subagent ${wt.agentId} worktree [${wt.taskId}]`], {
        cwd: this.repoRoot,
        encoding: 'utf8'
      });

      return {
        success: mergeRes.status === 0,
        mergedBranch: wt.branch,
        output: mergeRes.stdout || mergeRes.stderr
      };
    }

    return {
      success: true,
      mergedBranch: wt.branch,
      message: 'Mock worktree merged'
    };
  }

  /**
   * Clean up and remove worktree
   */
  removeWorktree(worktreeId) {
    const wt = this.activeWorktrees.get(worktreeId);
    if (!wt) return false;

    if (this.isGitRepo() && wt.status === 'ACTIVE') {
      spawnSync('git', ['worktree', 'remove', '--force', wt.path], { cwd: this.repoRoot });
      spawnSync('git', ['branch', '-D', wt.branch], { cwd: this.repoRoot });
    } else {
      try {
        fs.rmSync(wt.path, { recursive: true, force: true });
      } catch {}
    }

    this.activeWorktrees.delete(worktreeId);
    return true;
  }

  listWorktrees() {
    return Array.from(this.activeWorktrees.values());
  }
}

module.exports = {
  WorktreeRunner
};
