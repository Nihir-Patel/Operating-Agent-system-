/**
 * @file tests/worktree-runner.test.js
 * Unit & Integration test for Git Worktree Multi-Agent Runner
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { WorktreeRunner } = require('../packages/engine/src/index');

async function testWorktrees() {
  console.log('=== TESTING WORKTREE MULTI-AGENT RUNNER ===');

  const runner = new WorktreeRunner({ repoRoot: path.resolve(__dirname, '..') });
  assert.strictEqual(runner.isGitRepo(), true, 'Must detect valid Git repository');

  // Spawn isolated worktree
  console.log('[Test 1] Spawning isolated worktree for subagent...');
  const wt = runner.spawnWorktree('test-run-101', 'tdd-guide');
  assert(wt.id.includes('tdd_guide') || wt.id.includes('tdd-guide'));
  assert(wt.branch.includes('oas/'));
  assert(fs.existsSync(wt.path), 'Worktree directory must exist on disk');
  console.log('  -> Worktree created at:', wt.path, 'on branch:', wt.branch);

  // Inspect diff in worktree
  console.log('[Test 2] Checking worktree diff & status...');
  const diff = runner.getWorktreeDiff(wt.id);
  assert(Array.isArray(diff.modifiedFiles));
  console.log('  -> Status verified cleanly.');

  // List worktrees
  console.log('[Test 3] Listing active worktrees...');
  const list = runner.listWorktrees();
  assert(list.length >= 1);
  assert(list.some(item => item.id === wt.id));

  // Clean up worktree
  console.log('[Test 4] Removing and cleaning up worktree...');
  const removed = runner.removeWorktree(wt.id);
  assert.strictEqual(removed, true);
  assert.strictEqual(fs.existsSync(wt.path), false, 'Worktree directory must be cleaned up');
  console.log('  -> Worktree removed and branch cleaned up.');

  console.log('\n======================================================');
  console.log('  WORKTREE MULTI-AGENT RUNNER TESTS PASSED (100%)');
  console.log('======================================================\n');
}

testWorktrees().catch(err => {
  console.error('Worktree Test Failed:', err);
  process.exit(1);
});
