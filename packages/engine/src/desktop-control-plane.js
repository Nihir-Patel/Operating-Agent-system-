/**
 * @file packages/engine/src/desktop-control-plane.js
 * Plan how the Tauri shell should attach to Studio's Node control plane.
 */

const path = require('path');

function planDesktopControlPlane(input = {}) {
  const port = Math.max(1, Math.floor(Number(input.port) || 3458));
  const host = input.host || '127.0.0.1';
  const url = `http://${host}:${port}`;
  if (input.healthOk) {
    return {
      action: 'reuse',
      url,
      ownsProcess: false,
      isolation: 'external'
    };
  }
  const repoRoot = path.resolve(input.repoRoot || process.cwd());
  return {
    action: 'spawn',
    file: input.nodePath || process.execPath,
    args: [path.join(repoRoot, 'scripts', 'oas-studio.js'), String(port)],
    cwd: repoRoot,
    url,
    ownsProcess: true,
    isolation: 'child-process'
  };
}

module.exports = { planDesktopControlPlane };
