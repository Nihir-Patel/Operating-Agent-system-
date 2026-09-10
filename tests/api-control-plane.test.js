/**
 * @file tests/api-control-plane.test.js
 * Unit & Integration test for OAS Control Plane API routes
 */

const assert = require('assert');
const { OasControlPlaneServer } = require('../apps/api/src/server');

async function runApiTests() {
  console.log('Testing OAS Control Plane API endpoints...');
  const serverInstance = new OasControlPlaneServer({ port: 0 });

  console.log('Parser catalog check:');
  assert(serverInstance.cachedCatalog.agents.length >= 68, 'Must have at least 68 agents');
  assert(serverInstance.cachedCatalog.skills.length === 286, 'Must have 286 skills');
  assert(serverInstance.cachedCatalog.commands.length === 94, 'Must have 94 commands');
  assert(Object.keys(serverInstance.cachedCatalog.mcpServers).length === 36, 'Must have 36 MCP servers');

  console.log('Session store check:');
  const session = serverInstance.store.createSession({ title: 'Test Feature Run', lead_agent_id: 'planner' });
  assert(session.id.startsWith('sess_'), 'Session ID generated');
  assert(session.lead_agent_id === 'planner', 'Lead agent matches');

  const step = serverInstance.store.addStep(session.id, {
    agent_id: 'planner',
    step_type: 'thought',
    content: 'Decomposing PRD into capability chunks'
  });
  assert(step.session_id === session.id, 'Step associated with session');

  console.log('Scheduler pipeline check:');
  const pipeline = serverInstance.scheduler.createPipeline(session.id, 'Build Cloud Control Plane', 'feature_lifecycle');
  assert(pipeline.nodes.length === 6, 'Pipeline has 6 nodes in feature lifecycle');

  // Human in the loop pause/resume
  serverInstance.scheduler.pauseRun(session.id);
  assert(pipeline.status === 'paused', 'Pipeline is paused');
  serverInstance.scheduler.resumeRun(session.id);
  assert(pipeline.status === 'running', 'Pipeline is resumed');

  console.log('All API & Engine integration tests passed successfully!');
}

runApiTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
