/**
 * @file tests/builder-api.test.js
 * Unit & Integration test for Custom Agent & Skill Studio Builder
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { OasParser } = require('../packages/parser/src/parser');

async function testBuilder() {
  console.log('=== TESTING STUDIO BUILDER CREATION & EXPORT ===');

  const workspaceRoot = path.resolve(__dirname, '..');
  const parser = new OasParser(workspaceRoot);

  const initialCatalog = parser.parseAll();
  const initialAgentCount = initialCatalog.agents.length;
  const initialSkillCount = initialCatalog.skills.length;

  console.log(`[Baseline] Agents: ${initialAgentCount}, Skills: ${initialSkillCount}`);

  // 1. Create Custom Agent
  console.log('[Test 1] Creating new custom agent definition...');
  const testAgentId = 'test-tracer-agent';
  const agentFile = path.join(workspaceRoot, 'agents', `${testAgentId}.md`);

  const agentContent = [
    '---',
    `name: ${testAgentId}`,
    'description: "Automated distributed tracer for microservices."',
    'model: sonnet',
    'tools: Read, Write, Grep, Bash',
    '---',
    '',
    `# ${testAgentId} Agent`,
    '',
    'Trace distributed spans and diagnose network latency bottlenecks.'
  ].join('\n');

  fs.writeFileSync(agentFile, agentContent, 'utf8');

  // Verify parser discovers new agent
  const updatedAgents = parser.parseAgents();
  assert.strictEqual(updatedAgents.length, initialAgentCount + 1, 'Agent count must increment by 1');
  const foundAgent = updatedAgents.find(a => a.id === testAgentId);
  assert(foundAgent, 'New agent must be discovered');
  assert.strictEqual(foundAgent.model, 'sonnet');
  assert.strictEqual(foundAgent.tools.length, 4);
  console.log('  -> Custom agent created, parsed, and registered successfully.');

  // 2. Create Custom Skill
  console.log('[Test 2] Creating new custom workflow skill...');
  const testSkillId = 'test-tracer-skill';
  const skillDir = path.join(workspaceRoot, 'skills', testSkillId);
  fs.mkdirSync(skillDir, { recursive: true });

  const skillContent = [
    '---',
    `name: ${testSkillId}`,
    'description: "Workflow skill for instrumenting OpenTelemetry spans."',
    'triggers:',
    '  - "opentelemetry"',
    '  - "jaeger"',
    '---',
    '',
    `# ${testSkillId}`,
    '',
    'Step 1: Check OpenTelemetry SDK setup.'
  ].join('\n');

  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent, 'utf8');

  // Verify parser discovers new skill
  const updatedSkills = parser.parseSkills();
  assert.strictEqual(updatedSkills.length, initialSkillCount + 1, 'Skill count must increment by 1');
  const foundSkill = updatedSkills.find(s => s.id === testSkillId);
  assert(foundSkill, 'New skill must be discovered');
  assert.strictEqual(foundSkill.triggers.length, 2);
  console.log('  -> Custom skill created, parsed, and registered successfully.');

  // Clean up test files
  console.log('[Cleanup] Removing test entity files...');
  if (fs.existsSync(agentFile)) fs.unlinkSync(agentFile);
  if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });

  const finalCatalog = parser.parseAll();
  assert.strictEqual(finalCatalog.agents.length, initialAgentCount);
  assert.strictEqual(finalCatalog.skills.length, initialSkillCount);
  console.log('  -> Cleanup complete, catalog state restored.');

  console.log('\n======================================================');
  console.log('  STUDIO BUILDER API & PARSER TESTS PASSED (100%)');
  console.log('======================================================\n');
}

testBuilder().catch(err => {
  console.error('Builder Test Failed:', err);
  process.exit(1);
});
