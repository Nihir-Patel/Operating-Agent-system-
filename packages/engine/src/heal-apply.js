/**
 * @file packages/engine/src/heal-apply.js
 * Apply an auto-heal suggestion inside an isolated worktree, never the main tree.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveInsideWorkspace } = require('./path-guard');

function writeHealArtifact(worktreePath, healId, payload = {}) {
  const dir = resolveInsideWorkspace(worktreePath, path.join('.oas', 'heals', healId));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'suggestion.patch'), String(payload.suggestedPatch || payload.diff || ''), 'utf8');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    healId,
    targetFile: payload.targetFile || '',
    errorType: payload.errorType || '',
    createdAt: new Date().toISOString()
  }, null, 2), 'utf8');
  return dir;
}

function applyHealInWorktree(options = {}) {
  const worktreePath = options.worktreePath;
  const healId = options.healId || 'heal';
  const targetFile = String(options.targetFile || '').replace(/^\/+/, '');
  if (!worktreePath) {
    throw new Error('worktreePath is required');
  }

  const artifactDir = writeHealArtifact(worktreePath, healId, options);
  let written = null;
  if (targetFile && options.replaceContent != null) {
    const dest = resolveInsideWorkspace(worktreePath, targetFile);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, String(options.replaceContent), 'utf8');
    written = targetFile;
  }

  return {
    artifactDir: path.relative(worktreePath, artifactDir).replace(/\\/g, '/'),
    written
  };
}

function verifyHealWorktree(worktreePath, command, sandbox) {
  const cmd = String(command || '').trim();
  if (!cmd) {
    return { verified: false, output: 'No verifyCommand provided' };
  }
  if (sandbox && typeof sandbox.validateCommand === 'function') {
    const gate = sandbox.validateCommand(cmd);
    if (!gate.allowed) {
      return { verified: false, output: gate.reason || 'Verify command blocked by sandbox' };
    }
  }
  const proc = spawnSync('sh', ['-c', cmd], {
    cwd: worktreePath,
    encoding: 'utf8',
    timeout: 20000
  });
  const output = String(proc.stdout || '') + String(proc.stderr || '');
  return {
    verified: proc.status === 0,
    output: output.slice(0, 4000),
    exitCode: proc.status
  };
}

module.exports = {
  applyHealInWorktree,
  verifyHealWorktree,
  writeHealArtifact
};
