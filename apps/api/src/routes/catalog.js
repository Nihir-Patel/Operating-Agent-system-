/**
 * @file apps/api/src/routes/catalog.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

const fs = require('fs');
const path = require('path');
const { resolveDefaultModel } = require('../../../../packages/engine/src/model-registry');
const { writeSkillPromotion } = require('../../../../packages/engine/src/skill-promotion');

module.exports = async function catalogRoutes(req, res, pathname, parsedUrl) {
// --- CATALOG APIS ---
if (pathname === '/api/catalog') {
  if (!this.cachedCatalog) this.initCatalog();
  return this.sendJson(res, 200, this.cachedCatalog);
}

if (pathname === '/api/agents' && req.method === 'GET') {
  if (!this.cachedCatalog) this.initCatalog();
  return this.sendJson(res, 200, this.cachedCatalog.agents);
}

if (pathname === '/api/agents/create' && req.method === 'POST') {
  const body = await this.parseBody(req);
  const rawId = (body.id || body.name || '').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-');
  if (!rawId) {
    return this.sendJson(res, 400, { error: 'Agent name or ID is required.' });
  }

  const toolsList = Array.isArray(body.tools) ? body.tools.join(', ') : (body.tools || 'Read, Write, Edit, Grep, Glob');
  const content = [
    '---',
    `name: ${rawId}`,
    `description: "${(body.description || 'Custom agent created via OAS Studio.').replace(/"/g, '\\"')}"`,
    `model: ${body.model || resolveDefaultModel()}`,
    `tools: ${toolsList}`,
    '---',
    '',
    '# ' + (body.name || rawId) + ' Agent',
    '',
    body.instructions || 'You are an autonomous agent specialized in executing domain software tasks.'
  ].join('\n');

  const targetFile = path.join(this.workspaceRoot, 'agents', `${rawId}.md`);
  fs.writeFileSync(targetFile, content, 'utf8');

  this.initCatalog();
  return this.sendJson(res, 201, {
    success: true,
    id: rawId,
    file: `agents/${rawId}.md`,
    totalAgents: this.cachedCatalog?.agents.length
  });
}

if (pathname === '/api/skills' && req.method === 'GET') {
  if (!this.cachedCatalog) this.initCatalog();
  return this.sendJson(res, 200, this.cachedCatalog.skills);
}

if (pathname === '/api/skills/create' && req.method === 'POST') {
  const body = await this.parseBody(req);
  const rawId = (body.id || body.name || '').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-');
  if (!rawId) {
    return this.sendJson(res, 400, { error: 'Skill name or ID is required.' });
  }

  try {
    const result = writeSkillPromotion({
      workspaceRoot: this.workspaceRoot,
      id: rawId,
      name: body.name || rawId,
      description: body.description,
      instructions: body.instructions,
      triggers: body.triggers,
      confirmPromote: body.confirmPromote === true || body.confirmPromote === 'true'
    });
    if (result.stage === 'catalog') this.initCatalog();
    return this.sendJson(res, result.stage === 'catalog' ? 201 : 202, {
      success: true,
      id: result.id,
      file: result.file,
      stage: result.stage,
      failures: result.failures,
      totalSkills: this.cachedCatalog?.skills.length
    });
  } catch (err) {
    if (err.code === 'SKILL_PROMOTION_BLOCKED') {
      return this.sendJson(res, 409, {
        error: err.message,
        errorCode: err.code,
        failures: err.evaluation && err.evaluation.failures
      });
    }
    return this.sendJson(res, 400, { error: err.message });
  }
}

if (pathname === '/api/commands' && req.method === 'GET') {
  if (!this.cachedCatalog) this.initCatalog();
  return this.sendJson(res, 200, this.cachedCatalog.commands);
}

if (pathname === '/api/commands/execute' && req.method === 'POST') {
  const body = await this.parseBody(req);
  const cmdString = body.command || '';
  const result = await this.commands.executeCommand(cmdString, { sessionId: body.sessionId });
  this.broadcastSse('agent:command:executed', result);
  return this.sendJson(res, 200, result);
}

if (pathname === '/api/mcp') {
  if (!this.cachedCatalog) this.initCatalog();
  return this.sendJson(res, 200, this.cachedCatalog.mcpServers);
}
};
