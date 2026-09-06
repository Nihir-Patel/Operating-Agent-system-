/**
 * @file tests/command-runner.test.js
 * Unit & Integration test for Interactive Slash Command Engine
 */

const assert = require('assert');
const path = require('path');
const { CommandRunner, AgentDagScheduler, StrategicCompactor } = require('../packages/engine/src/index');
const { MemoryStore } = require('../packages/db/src/index');

async function testCommands() {
  console.log('=== TESTING INTERACTIVE SLASH COMMAND ENGINE ===');

  const store = new MemoryStore({ storagePath: path.join(__dirname, '.cmd-test-store.json') });
  const scheduler = new AgentDagScheduler({ store });
  const compactor = new StrategicCompactor(200000);
  const runner = new CommandRunner({ scheduler, compactor, store });

  // 1. /plan command
  console.log('[Test 1] Testing /plan command execution...');
  const planRes = await runner.executeCommand('/plan Build distributed vector search');
  assert.strictEqual(planRes.status, 'success');
  assert.strictEqual(planRes.command, 'plan');
  assert(planRes.pipeline);
  assert.strictEqual(planRes.pipeline.nodes.length, 6);
  console.log('  -> /plan initialized feature lifecycle DAG.');

  // 2. /tdd command
  console.log('[Test 2] Testing /tdd command execution...');
  const tddRes = await runner.executeCommand('/tdd Fix session token expiration');
  assert.strictEqual(tddRes.status, 'success');
  assert.strictEqual(tddRes.command, 'tdd');
  assert(tddRes.pipeline);
  assert.strictEqual(tddRes.pipeline.nodes[2].status, 'running');
  console.log('  -> /tdd initiated red-green TDD subagent cycle.');

  // 3. /compact command
  console.log('[Test 3] Testing /compact command execution...');
  const compactRes = await runner.executeCommand('/compact');
  assert.strictEqual(compactRes.status, 'success');
  assert.strictEqual(compactRes.command, 'compact');
  assert(compactRes.tokensFreed > 0);
  console.log('  -> /compact reclaimed tokens and reported headroom.');

  // 4. /checkpoint command
  console.log('[Test 4] Testing /checkpoint command execution...');
  const checkRes = await runner.executeCommand('/checkpoint pre_refactor_snapshot');
  assert.strictEqual(checkRes.status, 'success');
  assert.strictEqual(checkRes.command, 'checkpoint');
  assert(checkRes.output.includes('Memory Vault'));
  console.log('  -> /checkpoint captured state in Memory Vault.');

  // 5. /build-fix command
  console.log('[Test 5] Testing /build-fix command execution...');
  const fixRes = await runner.executeCommand('/build-fix');
  assert.strictEqual(fixRes.status, 'success');
  assert.strictEqual(fixRes.command, 'build-fix');
  assert(fixRes.pipeline);
  console.log('  -> /build-fix initialized compiler resolver.');

  // 6. /aside command
  console.log('[Test 6] Testing /aside non-blocking question...');
  const asideRes = await runner.executeCommand('/aside What is the token limit?');
  assert.strictEqual(asideRes.status, 'success');
  assert.strictEqual(asideRes.command, 'aside');
  console.log('  -> /aside executed without context displacement.');

  // 7. Error handling on non-slash input
  console.log('[Test 7] Testing invalid syntax handling...');
  const invalidRes = await runner.executeCommand('plan something');
  assert.strictEqual(invalidRes.status, 'error');

  // Clean up
  try {
    const fs = require('fs');
    fs.unlinkSync(path.join(__dirname, '.cmd-test-store.json'));
  } catch {}

  console.log('\n======================================================');
  console.log('  INTERACTIVE SLASH COMMAND TESTS PASSED (100%)');
  console.log('======================================================\n');
}

testCommands().catch(err => {
  console.error('Command Runner Test Failed:', err);
  process.exit(1);
});
