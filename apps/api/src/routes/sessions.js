/**
 * @file apps/api/src/routes/sessions.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

module.exports = async function sessionsRoutes(req, res, pathname, parsedUrl) {
if (pathname === '/api/sessions' && req.method === 'GET') {
  const sessions = this.store.getSessions();
  // Annotate with steps count and active run info
  const annotated = sessions.map(s => {
    const steps = this.store.getSteps(s.id);
    const run = this.scheduler.getRun(s.id);
    return {
      ...s,
      stepCount: steps.length,
      activeNodes: run ? run.nodes.filter(n => n.status === 'completed').length : 0,
      totalNodes: run ? run.nodes.length : 0
    };
  });
  return this.sendJson(res, 200, annotated);
}

if (pathname === '/api/sessions' && req.method === 'POST') {
  const body = await this.parseBody(req);
  const session = this.store.createSession(body);
  this.scheduler.createPipeline(session.id, session.title, body.pipelineType || 'feature_lifecycle');
  return this.sendJson(res, 201, session);
}

if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/pipeline') && req.method === 'GET') {
  const parts = pathname.split('/');
  const sessionId = parts[3];
  let run = this.scheduler.getRun(sessionId);
  if (!run) {
    run = this.scheduler.createPipeline(sessionId, 'OAS Session Task', 'feature_lifecycle');
  }
  return this.sendJson(res, 200, run);
}

if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/step') && req.method === 'POST') {
  const parts = pathname.split('/');
  const sessionId = parts[3];
  const body = await this.parseBody(req);
  const stepRecord = this.scheduler.advanceStep(sessionId, body);
  if (stepRecord) {
    this.store.addStep(sessionId, stepRecord);
  }
  return this.sendJson(res, 200, { step: stepRecord, pipeline: this.scheduler.getRun(sessionId) });
}

if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/execute') && req.method === 'POST') {
  const parts = pathname.split('/');
  const sessionId = parts[3];
  const body = await this.parseBody(req);
  try {
    const result = await this.executeActiveNode(sessionId, body);
    if (result.done && !result.success) {
      return this.sendJson(res, 200, { message: result.message, run: result.run });
    }
    return this.sendJson(res, 200, result);
  } catch (execErr) {
    const status = execErr.statusCode || (execErr.code === 'PIPELINE_BLOCKED' ? 409 : 500);
    return this.sendJson(res, status, {
      error: execErr.message,
      errorCode: execErr.code || 'EXECUTE_FAILED',
      status: execErr.pipeline ? execErr.pipeline.status : 'failed',
      pipeline: execErr.pipeline || this.scheduler.getRun(sessionId)
    });
  }
}

// --- PIPELINE AUTO-ADVANCE ENDPOINT ---
if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/pipeline/run') && req.method === 'POST') {
  const parts = pathname.split('/');
  const sessionId = parts[3];
  const body = await this.parseBody(req);
  try {
    const result = await this.runPipeline(sessionId, body);
    return this.sendJson(res, 200, { success: true, sessionId, ...result });
  } catch (execErr) {
    const status = execErr.statusCode || (execErr.code === 'PIPELINE_BLOCKED' ? 409 : 500);
    return this.sendJson(res, status, {
      error: execErr.message,
      errorCode: execErr.code || 'EXECUTE_FAILED',
      status: execErr.pipeline ? execErr.pipeline.status : 'failed',
      pipeline: execErr.pipeline || this.scheduler.getRun(sessionId)
    });
  }
}

if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/pipeline/advance') && req.method === 'POST') {
  const parts = pathname.split('/');
  const sessionId = parts[3];
  const run = this.scheduler.getRun(sessionId);
  if (!run) {
    return this.sendJson(res, 404, { error: 'Session pipeline not found' });
  }

  const runningNode = run.nodes.find(n => n.status === 'running');
  if (runningNode) {
    runningNode.status = 'completed';
  }
  const nextPending = run.nodes.find(n => n.status === 'pending');
  if (nextPending) {
    nextPending.status = 'running';
  } else {
    run.status = 'completed';
  }

  if (this.scheduler.persistRun) this.scheduler.persistRun(run);

  this.broadcastSse('agent:pipeline:advanced', {
    sessionId,
    advancedNode: runningNode ? runningNode.id : null,
    nextNode: nextPending ? nextPending.id : null,
    status: run.status
  });

  return this.sendJson(res, 200, {
    success: true,
    sessionId,
    advancedNode: runningNode ? runningNode.id : null,
    nextNode: nextPending ? nextPending.id : null,
    status: run.status,
    pipeline: run
  });
}

if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/intervene') && req.method === 'POST') {
  const parts = pathname.split('/');
  const sessionId = parts[3];
  const body = await this.parseBody(req);
  const action = body.action;

  let updatedRun = null;
  if (action === 'pause') updatedRun = this.scheduler.pauseRun(sessionId);
  else if (action === 'resume') updatedRun = this.scheduler.resumeRun(sessionId);
  else if (action === 'abort') updatedRun = this.scheduler.abortRun(sessionId);
  else if (action === 'feedback') updatedRun = this.scheduler.provideFeedback(sessionId, body.feedback);

  return this.sendJson(res, 200, {
    success: true,
    status: updatedRun ? updatedRun.status : (action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'aborted'),
    run: updatedRun
  });
}

if (pathname.startsWith('/api/sessions/') && ((pathname.endsWith('/rename') && req.method === 'POST') || req.method === 'PATCH')) {
  const parts = pathname.split('/');
  const sessionId = parts[3];
  const body = await this.parseBody(req);
  const renamed = this.store.renameSession(sessionId, body.title || 'Untitled Session');
  return this.sendJson(res, 200, { success: Boolean(renamed), session: renamed, title: renamed?.title });
}

if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/fork') && req.method === 'POST') {
  const parts = pathname.split('/');
  const sessionId = parts[3];
  const body = await this.parseBody(req);
  const fromStep = parseInt(body.fromStep, 10) || 0;
  const session = this.store.getSession(sessionId);
  if (!session) {
    return this.sendJson(res, 404, { error: 'Session not found: ' + sessionId });
  }
  const allSteps = this.store.getSteps(sessionId);
  const forkedSteps = allSteps.filter(s => s.step_index <= fromStep);
  const newSessionTitle = body.title || `${session.title} (Fork at Step ${fromStep})`;
  const newSession = this.store.createSession({
    title: newSessionTitle,
    lead_agent_id: session.lead_agent_id || 'planner',
    pipelineType: session.pipelineType || 'feature_lifecycle'
  });
  for (const s of forkedSteps) {
    this.store.addStep(newSession.id, { ...s, session_id: newSession.id });
  }
  return this.sendJson(res, 201, {
    success: true,
    originalSessionId: sessionId,
    forkedFromStep: fromStep,
    newSession,
    session: newSession,
    steps: forkedSteps,
    stepsCount: forkedSteps.length
  });
}

if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/export') && req.method === 'GET') {
  const parts = pathname.split('/');
  const sessionId = parts[3];
  const session = this.store.getSession(sessionId);
  if (!session) {
    return this.sendJson(res, 404, { error: 'Session not found' });
  }
  const steps = this.store.getSteps(sessionId);
  const artifacts = this.store.getArtifacts(sessionId);
  const markdown = [
    `# Session Transcript: ${session.title}`,
    `**Session ID:** \`${session.id}\` | **Status:** \`${session.status}\` | **Started:** ${session.started_at}`,
    '',
    '## Execution Steps',
    ...steps.map(s => `### Step ${s.step_index} [${s.agent_id}] (${s.step_type})\n${s.content || ''}\n`),
    '',
    '## Artifacts',
    ...artifacts.map(a => `### ${a.title}\n\`\`\`\n${a.content}\n\`\`\``)
  ].join('\n');
  return this.sendJson(res, 200, {
    sessionId,
    session_id: sessionId,
    title: session.title,
    stepsCount: steps.length,
    markdown,
    transcript: markdown,
    json: { session, steps, artifacts }
  });
}

// Canonical session adapters registry (docs/SESSION-ADAPTER-CONTRACT.md)
if (pathname === '/api/sessions/adapters' && req.method === 'GET') {
  try {
    const { createDefaultAdapters, TARGET_TYPE_TO_ADAPTER_ID } = require('../../../../scripts/lib/session-adapters/registry');
    const adapters = createDefaultAdapters();
    const adapterList = adapters.map(a => ({
      id: a.id || a.adapterId,
      label: a.label || a.id,
      supportedTargetTypes: a.supportedTargetTypes || []
    }));
    return this.sendJson(res, 200, {
      schemaVersion: 'oas.session.v1',
      adapters: adapterList,
      targetMapping: TARGET_TYPE_TO_ADAPTER_ID
    });
  } catch (err) {
    return this.sendJson(res, 500, { error: err.message });
  }
}

// Single session details and steps
if (pathname.startsWith('/api/sessions/') && req.method === 'GET') {
  const parts = pathname.split('/');
  if (parts.length === 5 && parts[4] === 'steps') {
    const sessionId = parts[3];
    const session = this.store.getSession(sessionId);
    if (!session) {
      return this.sendJson(res, 404, { error: 'Session not found: ' + sessionId });
    }
    const steps = this.store.getSteps(sessionId) || [];
    return this.sendJson(res, 200, { sessionId, steps });
  }
  if (parts.length === 4) {
    const sessionId = parts[3];
    const session = this.store.getSession(sessionId);
    if (!session) {
      return this.sendJson(res, 404, { error: 'Session not found: ' + sessionId });
    }
    const steps = this.store.getSteps(sessionId) || [];
    const artifacts = this.store.getArtifacts(sessionId);
    const pipeline = this.scheduler.getRun(sessionId);
    return this.sendJson(res, 200, { session, steps, artifacts, pipeline });
  }
}

// Delete session
if (pathname.startsWith('/api/sessions/') && req.method === 'DELETE') {
  const parts = pathname.split('/');
  if (parts.length === 4) {
    const sessionId = parts[3];
    const deleted = this.store.deleteSession(sessionId);
    return this.sendJson(res, 200, { success: deleted, sessionId });
  }
}

// --- MEMORY VAULT ---
if (pathname === '/api/memory' && req.method === 'GET') {
  const query = (parsedUrl.query && (parsedUrl.query.query || parsedUrl.query.q)) || '';
  const mode = parsedUrl.query && parsedUrl.query.mode;
  const list = this.store.getMemoryVault(mode === 'semantic' ? '' : query);
  if (mode === 'semantic') {
    const { rankByLocalVector } = require('../../../../packages/db/src/local-vectors');
    return this.sendJson(res, 200, rankByLocalVector(list, query));
  }
  return this.sendJson(res, 200, list);
}

if (pathname === '/api/memory' && req.method === 'POST') {
  try {
    const body = await this.parseBody(req);
    const record = this.store.addMemory(body);
    return this.sendJson(res, 201, record);
  } catch (err) {
    return this.sendJson(res, 400, { error: err.message });
  }
}

if (pathname.startsWith('/api/memory/') && req.method === 'DELETE') {
  const parts = pathname.split('/');
  const id = parts[3];
  const success = this.store.deleteMemory(id);
  return this.sendJson(res, 200, { success, id });
}

// --- ARTIFACTS & PLANS ---
if (pathname === '/api/artifacts' && req.method === 'GET') {
  const sessionId = parsedUrl.query && parsedUrl.query.sessionId;
  return this.sendJson(res, 200, this.store.getArtifacts(sessionId));
}

if (pathname === '/api/artifacts' && req.method === 'POST') {
  const body = await this.parseBody(req);
  const record = this.store.addArtifact(body);
  return this.sendJson(res, 201, record);
}

if (pathname.startsWith('/api/artifacts/') && req.method === 'PUT') {
  const parts = pathname.split('/');
  const id = parts[3];
  const body = await this.parseBody(req);
  const updated = this.store.updateArtifact(id, body);
  if (!updated) {
    return this.sendJson(res, 404, { error: 'Artifact not found' });
  }
  return this.sendJson(res, 200, updated);
}

};
