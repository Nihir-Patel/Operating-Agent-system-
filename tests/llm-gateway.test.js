/**
 * @file tests/llm-gateway.test.js
 * Unit & Integration test for Universal Model Gateway & AgentRunner
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { UniversalModelGateway, AgentRunner, ExecutionSandbox } = require('../packages/engine/src/index');

async function testGateway() {
  console.log('=== TESTING UNIVERSAL MODEL GATEWAY & AGENT RUNNER ===');

  // 1. Provider Resolution
  const gateway = new UniversalModelGateway();
  assert.strictEqual(gateway.resolveProvider('sonnet').provider, 'anthropic');
  assert.strictEqual(gateway.resolveProvider('opus').provider, 'anthropic');
  assert.strictEqual(gateway.resolveProvider('haiku').provider, 'anthropic');
  assert.strictEqual(gateway.resolveProvider('gpt-4o').provider, 'openai');
  assert.strictEqual(gateway.resolveProvider('o3-mini').provider, 'openai');
  assert.strictEqual(gateway.resolveProvider('gemini-2.5-pro').provider, 'gemini');
  assert.strictEqual(gateway.resolveProvider('llama3.3').provider, 'ollama');
  console.log('[Test 1] Provider resolution logic passed for all supported models.');

  // 2. Stream Completion Fallback & Callbacks
  let tokensReceived = 0;
  let toolCallsReceived = 0;
  const result = await gateway.streamCompletion({
    agentId: 'planner',
    model: 'sonnet',
    prompt: 'Create high-level architecture roadmap'
  }, {
    onToken: (tok) => { tokensReceived++; },
    onToolCall: (call) => { toolCallsReceived++; }
  });

  assert(result.text.length > 0);
  assert(tokensReceived >= 3, 'Must have received streaming token deltas');
  assert(toolCallsReceived >= 1, 'Must have triggered tool callback');
  console.log('[Test 2] Streaming token deltas and tool callback verified.');

  // 3. AgentRunner Tool Execution
  const sandbox = new ExecutionSandbox();
  const runner = new AgentRunner({ workspaceRoot: path.resolve(__dirname, '..'), sandbox });

  // Read file tool
  const readRes = runner.executeTool('read_file', { path: 'package.json' });
  assert.strictEqual(readRes.status, 'success');
  assert(readRes.content.includes('oas-universal'));

  // Sandboxed command tool (safe command)
  const cmdRes = runner.executeTool('run_command', { command: 'node -v' });
  assert.strictEqual(cmdRes.status, 'success');
  assert(cmdRes.stdout.includes('v'));

  // Sandboxed command tool (blocked dangerous command)
  const badCmdRes = runner.executeTool('run_command', { command: 'rm -rf /' });
  assert.strictEqual(badCmdRes.status, 'blocked');
  assert.strictEqual(badCmdRes.dangerLevel, 'CRITICAL');
  console.log('[Test 3] AgentRunner safe and blocked tool execution verified.');

  // 4. Complete Agent Execution Cycle
  let stepChunks = 0;
  const cycleResult = await runner.executeAgentCycle(
    { id: 'tdd-guide', model: 'sonnet', systemPrompt: 'Enforce 80%+ test coverage' },
    'Validate event protocol compliance',
    {
      onStepChunk: () => { stepChunks++; }
    }
  );

  assert.strictEqual(cycleResult.agentId, 'tdd-guide');
  assert(cycleResult.output.length > 0);
  assert(stepChunks > 0);
  console.log('[Test 4] Subagent full execution cycle passed.');

  console.log('\n======================================================');
  console.log('  LIVE LLM EXECUTION INTEGRATION TESTS PASSED (100%)');
  console.log('======================================================\n');
}

testGateway().catch(err => {
  console.error('LLM Gateway Test Failed:', err);
  process.exit(1);
});
