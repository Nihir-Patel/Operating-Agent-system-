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
    this.store = options.store;
    this.hydrateFromStore();
  }

  persistWorktree(record) {
    if (!record || !this.store || typeof this.store.saveWorktree !== 'function') return;
    this.store.saveWorktree(JSON.parse(JSON.stringify(record)));
  }

  hydrateFromStore() {
    if (!this.store || typeof this.store.listWorktrees !== 'function') return;
    for (const record of this.store.listWorktrees() || []) {
      if (record && record.id) this.activeWorktrees.set(record.id, record);
    }
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
      } catch {
        // Directory may already exist
      }
    }

    if (this.isGitRepo()) {
      // Check if branch already exists
      spawnSync('git', ['branch', '-D', branchName], { cwd: this.repoRoot, stdio: 'ignore' });
      // Create worktree
      const res = spawnSync('git', ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], {
        cwd: this.repoRoot,
        encoding: 'utf8'
      });

      const success = res.status === 0 && fs.existsSync(worktreePath);
      if (!success) {
        try { fs.mkdirSync(worktreePath, { recursive: true }); } catch {
          // Fallback directory may already exist
        }
      }
      const record = {
        id: slug,
        taskId,
        agentId,
        branch: branchName,
        path: worktreePath,
        status: success ? 'ACTIVE' : 'FALLBACK_LOCAL',
        error: success ? null : (res.stderr || 'git worktree add failed'),
        createdAt: new Date().toISOString()
      };
      this.activeWorktrees.set(slug, record);
      this.persistWorktree(record);
      return record;
    }

    try {
      fs.mkdirSync(worktreePath, { recursive: true });
    } catch {
      // Isolated directory may already exist
    }

    const record = {
      id: slug,
      taskId,
      agentId,
      branch: branchName,
      path: worktreePath,
      status: 'FALLBACK_LOCAL',
      error: 'Not a git repository; isolated directory created without a worktree',
      createdAt: new Date().toISOString()
    };
    this.activeWorktrees.set(slug, record);
    this.persistWorktree(record);
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
  mergeWorktree(worktreeId, _targetBranch = 'HEAD') {
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
      success: false,
      mergedBranch: wt.branch,
      reason: 'Worktree is not an active git worktree; merge refused'
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
      } catch {
        // Best-effort cleanup of a local fallback directory
      }
    }

    this.activeWorktrees.delete(worktreeId);
    if (this.store && typeof this.store.deleteWorktree === 'function') {
      this.store.deleteWorktree(worktreeId);
    }
    return true;
  }

  /**
   * Switch the parent repository HEAD to an existing local branch.
   */
  isValidBranchName(name) {
    if (!name || typeof name !== 'string' || name.length > 255) return false;
    if (name.startsWith('-') || name.includes('..') || name.includes('\\') || /\s/.test(name)) {
      return false;
    }
    return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && !name.endsWith('/') && !name.includes('//');
  }

  switchBranch(branch) {
    if (!this.isValidBranchName(branch)) {
      return { success: false, error: 'Invalid branch name' };
    }
    if (!this.isGitRepo()) {
      return { success: false, error: 'Not a git repository' };
    }

    const checkout = spawnSync('git', ['checkout', branch], {
      cwd: this.repoRoot,
      encoding: 'utf8',
      timeout: 15000
    });
    if (checkout.status !== 0) {
      return {
        success: false,
        error: String(checkout.stderr || checkout.stdout || 'git checkout failed').trim()
      };
    }

    const current = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: this.repoRoot,
      encoding: 'utf8',
      timeout: 5000
    });
    const head = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: this.repoRoot,
      encoding: 'utf8',
      timeout: 5000
    });
    const activeBranch = String(current.stdout || branch).trim();
    return {
      success: true,
      activeBranch,
      head: String(head.stdout || '').trim(),
      message: `Switched active workspace to branch: ${activeBranch}`
    };
  }

  listWorktrees() {
    return Array.from(this.activeWorktrees.values());
  }
}

module.exports = {
  WorktreeRunner
};
