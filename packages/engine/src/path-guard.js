/**
 * @file packages/engine/src/path-guard.js
 * Workspace path containment — rejects prefix-sibling bypasses.
 */

const path = require('path');

function isInsideWorkspace(root, target) {
  if (!root || !target) return false;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveInsideWorkspace(root, relativeOrAbsolute) {
  const resolved = path.resolve(root, relativeOrAbsolute || '');
  if (!isInsideWorkspace(root, resolved)) {
    const err = new Error('Access denied: Path outside workspace sandbox');
    err.code = 'PATH_OUTSIDE_WORKSPACE';
    throw err;
  }
  return resolved;
}

module.exports = {
  isInsideWorkspace,
  resolveInsideWorkspace
};
