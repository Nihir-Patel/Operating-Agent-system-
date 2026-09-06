/**
 * @file packages/db/src/index.js
 * OAS Enterprise Data Store (SQLite / JSON / PostgreSQL driver adapter)
 */

const fs = require('fs');
const path = require('path');
const { schemaSql } = require('./schema');

class MemoryStore {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), '.oas-store.json');
    this.data = {
      organizations: [],
      workspaces: [],
      agent_definitions: [],
      skill_definitions: [],
      agent_sessions: [],
      agent_steps: [],
      memory_vault: [],
      artifacts: []
    };
    this.load();
  }

  load() {
    if (fs.existsSync(this.storagePath)) {
      try {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        this.data = Object.assign(this.data, JSON.parse(raw));
      } catch (err) {
        // Fallback to fresh store
      }
    }
  }

  save() {
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      // ignore write error
    }
  }

  // Sync parsed agents into DB
  syncAgents(agents) {
    this.data.agent_definitions = agents.map(a => ({
      ...a,
      updated_at: new Date().toISOString()
    }));
    this.save();
    return this.data.agent_definitions;
  }

  // Sync parsed skills into DB
  syncSkills(skills) {
    this.data.skill_definitions = skills.map(s => ({
      ...s,
      updated_at: new Date().toISOString()
    }));
    this.save();
    return this.data.skill_definitions;
  }

  createSession(payload) {
    const session = {
      id: payload.id || 'sess_' + Date.now().toString(36),
      title: payload.title || 'New Agent Session',
      status: payload.status || 'active',
      lead_agent_id: payload.lead_agent_id || 'planner',
      total_tokens: payload.total_tokens || 0,
      prompt_tokens: payload.prompt_tokens || 0,
      completion_tokens: payload.completion_tokens || 0,
      cost_usd: payload.cost_usd || 0,
      started_at: new Date().toISOString(),
      ended_at: null
    };
    this.data.agent_sessions.unshift(session);
    this.save();
    return session;
  }

  addStep(sessionId, stepPayload) {
    const step = {
      id: 'step_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      session_id: sessionId,
      step_index: this.data.agent_steps.filter(s => s.session_id === sessionId).length + 1,
      agent_id: stepPayload.agent_id || 'planner',
      step_type: stepPayload.step_type || 'thought', // 'thought', 'tool_call', 'tool_result', 'diff', 'intervention'
      content: stepPayload.content || '',
      tool_name: stepPayload.tool_name || null,
      tool_args: stepPayload.tool_args || null,
      tool_result: stepPayload.tool_result || null,
      diff_content: stepPayload.diff_content || null,
      duration_ms: stepPayload.duration_ms || 0,
      created_at: new Date().toISOString()
    };
    this.data.agent_steps.push(step);
    this.save();
    return step;
  }

  getSessions() {
    return this.data.agent_sessions;
  }

  getSession(id) {
    return this.data.agent_sessions.find(s => s.id === id);
  }

  getSteps(sessionId) {
    return this.data.agent_steps.filter(s => s.session_id === sessionId);
  }

  getMemoryVault() {
    return this.data.memory_vault;
  }

  addMemory(item) {
    const record = {
      id: 'mem_' + Date.now().toString(36),
      scope: item.scope || 'project',
      kind: item.kind || 'convention',
      title: item.title,
      body: item.body,
      hash: item.hash || Math.random().toString(36).substring(2, 10),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.data.memory_vault.push(record);
    this.save();
    return record;
  }

  getArtifacts(sessionId) {
    if (sessionId) {
      return this.data.artifacts.filter(a => a.session_id === sessionId);
    }
    return this.data.artifacts;
  }

  addArtifact(artifact) {
    const record = {
      id: 'art_' + Date.now().toString(36),
      session_id: artifact.session_id,
      artifact_type: artifact.artifact_type || 'plan',
      title: artifact.title,
      file_path: artifact.file_path,
      content: artifact.content,
      metadata: artifact.metadata || {},
      created_at: new Date().toISOString()
    };
    this.data.artifacts.push(record);
    this.save();
    return record;
  }
}

module.exports = {
  MemoryStore,
  schemaSql
};
