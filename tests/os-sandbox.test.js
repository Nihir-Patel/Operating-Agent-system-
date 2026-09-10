/**
 * @file tests/os-sandbox.test.js
 */

const assert = require('assert');
const { spawnSync } = require('child_process');
const {
  buildSeatbeltProfile,
  resolveSandboxedSpawn,
  isOsIsolationUnavailable
} = require('../packages/engine/src/os-sandbox');

function run() {
  console.log('\n=== OS SANDBOX ===\n');
  const profile = buildSeatbeltProfile();
  assert.ok(profile.includes('(deny file-write*)'));
  assert.ok(profile.includes('(param "WORKSPACE")'));
  console.log('  ✔ seatbelt profile denies writes outside WORKSPACE');

  const seated = resolveSandboxedSpawn('echo ok', '/tmp/ws', {
    platform: 'darwin',
    sandboxExecPath: '/usr/bin/sandbox-exec',
    profileFile: '/tmp/fake.sb'
  });
  assert.strictEqual(seated.isolation, 'seatbelt');
  assert.strictEqual(seated.file, '/usr/bin/sandbox-exec');
  assert.ok(seated.args.includes('/bin/sh'));
  console.log('  ✔ darwin launch uses sandbox-exec');

  const policy = resolveSandboxedSpawn('echo OAS_SANDBOX_OK', process.cwd(), {
    platform: 'linux',
    sandboxExecPath: null,
    bwrapPath: null
  });
  assert.strictEqual(policy.isolation, 'policy-only');
  assert.deepStrictEqual(policy.args, ['-c', 'echo OAS_SANDBOX_OK']);
  const echoed = spawnSync(policy.file, policy.args, { encoding: 'utf8', timeout: 5000 });
  assert.ok(String(echoed.stdout || '').includes('OAS_SANDBOX_OK'));
  console.log('  ✔ non-darwin stays policy-only');

  assert.strictEqual(isOsIsolationUnavailable('seatbelt', 71, ''), true);
  assert.strictEqual(
    isOsIsolationUnavailable('seatbelt', 1, 'sandbox-exec: sandbox_apply: Operation not permitted'),
    true
  );
  assert.strictEqual(isOsIsolationUnavailable('seatbelt', 0, ''), false);
  assert.strictEqual(isOsIsolationUnavailable('policy-only', 71, ''), false);
  console.log('  ✔ seatbelt denial (exit 71) is a policy-only fallback');
}

run();
