/**
 * @file packages/engine/src/os-sandbox.js
 * OS-level isolation: seatbelt on macOS, bwrap on Linux, policy-only elsewhere.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function buildSeatbeltProfile() {
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    '(allow file-write-data (literal "/dev/null"))',
    '(allow file-write* (subpath (param "WORKSPACE")))',
    '(allow file-write* (regex #"^/private/tmp/"))',
    '(allow file-write* (regex #"^/tmp/"))',
    '(allow file-write* (regex #"^/private/var/folders/"))',
    '(allow file-write* (regex #"^/var/folders/"))'
  ].join('\n');
}

function detectSandboxExec(platform = process.platform, existsSync = fs.existsSync) {
  if (platform !== 'darwin') return null;
  if (existsSync('/usr/bin/sandbox-exec')) return '/usr/bin/sandbox-exec';
  return null;
}

function detectBwrap(platform = process.platform, existsSync = fs.existsSync) {
  if (platform !== 'linux') return null;
  if (existsSync('/usr/bin/bwrap')) return '/usr/bin/bwrap';
  return null;
}

function writeSeatbeltProfileFile(workspaceRoot) {
  const file = path.join(os.tmpdir(), `oas-seatbelt-${process.pid}-${Date.now()}.sb`);
  fs.writeFileSync(file, buildSeatbeltProfile(), 'utf8');
  return file;
}

function resolveSandboxedSpawn(cmd, cwd, options = {}) {
  const command = String(cmd || '').trim();
  const workspace = path.resolve(cwd || process.cwd());
  const platform = options.platform || process.platform;
  const existsSync = options.existsSync || fs.existsSync;
  const sandboxExec = options.sandboxExecPath !== undefined
    ? options.sandboxExecPath
    : detectSandboxExec(platform, existsSync);
  if (sandboxExec) {
    const profileFile = options.profileFile || writeSeatbeltProfileFile(workspace);
    return {
      file: sandboxExec,
      args: ['-f', profileFile, '-D', `WORKSPACE=${workspace}`, '/bin/sh', '-c', command],
      isolation: 'seatbelt',
      profileFile
    };
  }
  const bwrap = options.bwrapPath !== undefined
    ? options.bwrapPath
    : detectBwrap(platform, existsSync);
  if (bwrap) {
    return {
      file: bwrap,
      args: [
        '--die-with-parent',
        '--ro-bind', '/', '/',
        '--dev', '/dev',
        '--proc', '/proc',
        '--tmpfs', '/tmp',
        '--bind', workspace, workspace,
        '--chdir', workspace,
        '/bin/sh', '-c', command
      ],
      isolation: 'bwrap'
    };
  }
  if (platform === 'win32') {
    const comSpec = options.comSpec || process.env.ComSpec || 'cmd.exe';
    return {
      file: comSpec,
      args: ['/d', '/s', '/c', command],
      isolation: 'policy-only'
    };
  }
  return {
    file: '/bin/sh',
    args: ['-c', command],
    isolation: 'policy-only'
  };
}

function isOsIsolationUnavailable(isolation, exitCode, stderr) {
  if (isolation !== 'seatbelt' && isolation !== 'bwrap') return false;
  if (Number(exitCode) === 71) return true;
  const err = String(stderr || '');
  return /sandbox_apply:\s*Operation not permitted/i.test(err)
    || /bwrap:.*Operation not permitted/i.test(err);
}

module.exports = {
  buildSeatbeltProfile,
  detectSandboxExec,
  detectBwrap,
  resolveSandboxedSpawn,
  isOsIsolationUnavailable
};
