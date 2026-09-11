/**
 * @file packages/db/src/index.js
 * OAS Enterprise Data Store (SQLite / JSON / PostgreSQL driver adapter)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { schemaSql } = require('./schema');
const { loadFileMemories, mergeMemoryRecords, filterMemories } = require('./memory-files');
const { rankByLocalVector } = require('./local-vectors');

function cloneRecord(value) {
  return JSON.parse(JSON.stringify(value));
}

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /sk-(?:live|proj|ant)?[A-Za-z0-9_-]{20,}/
];

class MemoryStore {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), '.oas-store.json');
    this.memoryRoot = options.memoryRoot || path.join(path.dirname(this.storagePath), '.oas', 'memory');
    this.data = {
      organizations: [],
      workspaces: [],
      agent_definitions: [],
      skill_definitions: [],
      agent_sessions: [],
      agent_steps: [],
      memory_vault: [],
      artifacts: [],
      pipeline_runs: [],
      worktree_records: [],
      cost_events: [],
      path_leases: [],
      work_items: [],
      arena_traces: [],
      graph_state: { customNodeOverrides: {}, customEdges: [] },
      settings: {
        provider: 'ollama',
        anthropicApiKey: '',
        openaiApiKey: '',
        geminiApiKey: '',
        ollamaHost: 'http://localhost:11434',
        ollamaModel: 'qwen2.5-coder:7b',
        defaultModel: 'qwen2.5-coder:7b',
        sandboxEnabled: true,
        worktreeIsolation: true,
        githubToken: '',
        linearApiKey: '',
        firstRunDismissed: false
      }
    };
    this.load();
  }

  load() {
    if (fs.existsSync(this.storagePath)) {
      try {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        this.data = Object.assign(this.data, JSON.parse(raw));
        this.data.cost_events = this.data.cost_events || [];
        this.data.path_leases = this.data.path_leases || [];
        this.data.work_items = this.data.work_items || [];
        this.data.arena_traces = this.data.arena_traces || [];
      } catch (_err) {
        // Fallback to fresh store
      }
    }
    // No seed data — app starts empty. Users create sessions, memories, and artifacts via the UI.
  }

  save() {
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (_err) {
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
      lead_agent_id: payload.lead_agent_id || payload.leadAgent || 'planner',
      total_tokens: payload.total_tokens || 0,
      prompt_tokens: payload.prompt_tokens || 0,
      completion_tokens: payload.completion_tokens || 0,
      cost_usd: payload.cost_usd || 0,
      started_at: new Date().toISOString(),
      ended_at: null,
      metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
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

  getMemoryVault(query) {
    const merged = mergeMemoryRecords(this.data.memory_vault, loadFileMemories(this.memoryRoot));
    return filterMemories(merged, query);
  }

  addMemory(item) {
    const title = item.title || item.key || 'Untitled Memory';
    const content = item.body || item.content || '';
    const fullText = title + '\n' + content;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(fullText)) {
        throw new Error('Secret shape detected: Secret-shaped token detected: Memory rejects storing unencrypted credentials or private keys');
      }
    }

    const memoryId = item.id || ('mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6));
    const hash = item.hash || crypto.createHash('sha256').update(content).digest('hex').substring(0, 12);
    const scope = item.scope || 'project';
    const kind = item.kind || item.category || 'convention';

    const record = {
      id: memoryId,
      key: item.key || memoryId,
      scope,
      kind,
      category: kind,
      title,
      body: content,
      content,
      trust: 'unreviewed',
      hash,
      sha256: hash,
      created_at: item.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.data.memory_vault.push(record);
    this.save();

    // Persist Markdown file to .oas/memory/<scope>/<id>.md
    try {
      const scopeDir = path.join(this.memoryRoot, scope);
      if (!fs.existsSync(scopeDir)) {
        fs.mkdirSync(scopeDir, { recursive: true });
      }
      const mdContent = [
        '---',
        'schema: "oas.memory.v1"',
        `id: "${record.id}"`,
        `title: "${record.title.replace(/"/g, '\\"')}"`,
        `kind: "${record.kind}"`,
        `scope: "${record.scope}"`,
        'trust: "unreviewed"',
        `hash: "${record.hash}"`,
        `created_at: "${record.created_at}"`,
        '---',
        '',
        `# ${record.title}`,
        '',
        record.body
      ].join('\n');
      fs.writeFileSync(path.join(scopeDir, `${record.id}.md`), mdContent, 'utf8');
    } catch {
      // Fallback silently if filesystem is non-writable
    }

    return record;
  }

  deleteMemory(id) {
    const initialLen = this.data.memory_vault.length;
    const target = this.data.memory_vault.find(m => m.id === id);
    this.data.memory_vault = this.data.memory_vault.filter(m => m.id !== id);
    this.save();

    if (target) {
      try {
        const filePath = path.join(this.memoryRoot, target.scope || 'project', `${id}.md`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore deletion error
      }
    }

    return this.data.memory_vault.length < initialLen;
  }

  getArtifacts(sessionId) {
    if (sessionId) {
      return this.data.artifacts.filter(a => a.session_id === sessionId);
    }
    return this.data.artifacts;
  }

  addArtifact(artifact) {
    const record = {
      id: artifact.id || ('art_' + Date.now().toString(36)),
      session_id: artifact.session_id || null,
      artifact_type: artifact.artifact_type || 'plan',
      title: artifact.title || 'Capability Roadmap',
      status: artifact.status || 'in_progress',
      phases: artifact.phases || [],
      annotations: artifact.annotations || [],
      file_path: artifact.file_path || null,
      content: artifact.content || null,
      metadata: artifact.metadata || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.data.artifacts.push(record);
    this.save();
    return record;
  }

  updateArtifact(id, updates) {
    const art = this.data.artifacts.find(a => a.id === id);
    if (!art) return null;
    if (updates.title !== undefined) art.title = updates.title;
    if (updates.status !== undefined) art.status = updates.status;
    if (updates.phases !== undefined) art.phases = updates.phases;
    if (updates.annotations !== undefined) art.annotations = updates.annotations;
    if (updates.content !== undefined) art.content = updates.content;
    if (updates.metadata !== undefined) art.metadata = { ...art.metadata, ...updates.metadata };
    art.updated_at = new Date().toISOString();
    this.save();
    return art;
  }

  deleteSession(id) {
    const initialCount = this.data.agent_sessions.length;
    this.data.agent_sessions = this.data.agent_sessions.filter(s => s.id !== id);
    this.data.agent_steps = this.data.agent_steps.filter(s => s.session_id !== id);
    this.data.artifacts = this.data.artifacts.filter(a => a.session_id !== id);
    this.data.pipeline_runs = (this.data.pipeline_runs || []).filter(r => r.id !== id);
    this.save();
    return this.data.agent_sessions.length < initialCount;
  }

  savePipeline(run) {
    if (!run || !run.id) return null;
    const copy = cloneRecord(run);
    this.data.pipeline_runs = this.data.pipeline_runs || [];
    const idx = this.data.pipeline_runs.findIndex(r => r.id === copy.id);
    if (idx >= 0) {
      this.data.pipeline_runs = [
        ...this.data.pipeline_runs.slice(0, idx),
        copy,
        ...this.data.pipeline_runs.slice(idx + 1)
      ];
    } else {
      this.data.pipeline_runs = [...this.data.pipeline_runs, copy];
    }
    this.save();
    return copy;
  }

  getPipeline(id) {
    const found = (this.data.pipeline_runs || []).find(r => r.id === id);
    return found ? cloneRecord(found) : null;
  }

  listPipelines() {
    return (this.data.pipeline_runs || []).map(cloneRecord);
  }

  saveWorktree(record) {
    if (!record || !record.id) return null;
    const copy = cloneRecord(record);
    this.data.worktree_records = this.data.worktree_records || [];
    const idx = this.data.worktree_records.findIndex(r => r.id === copy.id);
    if (idx >= 0) {
      this.data.worktree_records = [
        ...this.data.worktree_records.slice(0, idx),
        copy,
        ...this.data.worktree_records.slice(idx + 1)
      ];
    } else {
      this.data.worktree_records = [...this.data.worktree_records, copy];
    }
    this.save();
    return copy;
  }

  listWorktrees() {
    return (this.data.worktree_records || []).map(cloneRecord);
  }

  deleteWorktree(id) {
    const initial = (this.data.worktree_records || []).length;
    this.data.worktree_records = (this.data.worktree_records || []).filter(r => r.id !== id);
    this.save();
    return this.data.worktree_records.length < initial;
  }

  saveGraphState(state) {
    this.data.graph_state = {
      customNodeOverrides: cloneRecord((state && state.customNodeOverrides) || {}),
      customEdges: cloneRecord((state && state.customEdges) || [])
    };
    this.save();
    return cloneRecord(this.data.graph_state);
  }

  savePathLease(lease) {
    if (!lease || !lease.id) return null;
    const copy = cloneRecord(lease);
    this.data.path_leases = this.data.path_leases || [];
    const idx = this.data.path_leases.findIndex(r => r.id === copy.id);
    if (idx >= 0) {
      this.data.path_leases = [
        ...this.data.path_leases.slice(0, idx),
        copy,
        ...this.data.path_leases.slice(idx + 1)
      ];
    } else {
      this.data.path_leases = [...this.data.path_leases, copy];
    }
    this.save();
    return copy;
  }

  listPathLeases() {
    return (this.data.path_leases || []).map(cloneRecord);
  }

  deletePathLease(id) {
    const initial = (this.data.path_leases || []).length;
    this.data.path_leases = (this.data.path_leases || []).filter(r => r.id !== id);
    this.save();
    return this.data.path_leases.length < initial;
  }

  saveWorkItem(item) {
    if (!item || !item.id) return null;
    const copy = cloneRecord(item);
    this.data.work_items = this.data.work_items || [];
    const idx = this.data.work_items.findIndex(r => r.id === copy.id);
    if (idx >= 0) {
      this.data.work_items = [
        ...this.data.work_items.slice(0, idx),
        copy,
        ...this.data.work_items.slice(idx + 1)
      ];
    } else {
      this.data.work_items = [...this.data.work_items, copy];
    }
    this.save();
    return copy;
  }

  listWorkItems() {
    return (this.data.work_items || []).map(cloneRecord);
  }

  getWorkItem(id) {
    const found = (this.data.work_items || []).find(r => r.id === id);
    return found ? cloneRecord(found) : null;
  }

  deleteWorkItem(id) {
    const initial = (this.data.work_items || []).length;
    this.data.work_items = (this.data.work_items || []).filter(r => r.id !== id);
    this.save();
    return this.data.work_items.length < initial;
  }

  saveArenaTrace(trace) {
    if (!trace || !trace.id) return null;
    const copy = cloneRecord(trace);
    this.data.arena_traces = [...(this.data.arena_traces || []), copy].slice(-200);
    this.save();
    return copy;
  }

  listArenaTraces(filter = {}) {
    const benchmarkId = filter.benchmarkId ? String(filter.benchmarkId) : null;
    return (this.data.arena_traces || [])
      .filter(row => !benchmarkId || row.benchmarkId === benchmarkId)
      .map(cloneRecord);
  }

  addCostEvent(event) {
    const copy = cloneRecord(event);
    this.data.cost_events = [...(this.data.cost_events || []), copy];
    this.save();
    return copy;
  }

  listCostEvents() {
    return (this.data.cost_events || []).map(cloneRecord);
  }

  addSessionCost(sessionId, delta = {}) {
    const tokens = Number(delta.tokens) || 0;
    const usd = Number(delta.usd) || 0;
    const promptTokens = Number(delta.promptTokens != null ? delta.promptTokens : delta.prompt_tokens) || 0;
    const completionTokens = Number(delta.completionTokens != null ? delta.completionTokens : delta.completion_tokens) || 0;
    this.data.agent_sessions = (this.data.agent_sessions || []).map(session => {
      if (session.id !== sessionId) return session;
      return {
        ...session,
        total_tokens: (session.total_tokens || 0) + tokens,
        prompt_tokens: (session.prompt_tokens || 0) + promptTokens,
        completion_tokens: (session.completion_tokens || 0) + completionTokens,
        cost_usd: Number(((session.cost_usd || 0) + usd).toFixed(6))
      };
    });
    this.save();
    return this.getSession(sessionId);
  }

  getGraphState() {
    const state = this.data.graph_state || { customNodeOverrides: {}, customEdges: [] };
    return {
      customNodeOverrides: cloneRecord(state.customNodeOverrides || {}),
      customEdges: cloneRecord(state.customEdges || [])
    };
  }

  renameSession(id, title) {
    const session = this.data.agent_sessions.find(s => s.id === id);
    if (session) {
      session.title = title;
      this.save();
      return session;
    }
    return null;
  }

  getSettings() {
    return this.data.settings || {
      provider: 'ollama',
      anthropicApiKey: '',
      openaiApiKey: '',
      geminiApiKey: '',
      ollamaHost: 'http://localhost:11434',
      defaultModel: 'qwen2.5-coder:7b',
      sandboxEnabled: true,
      worktreeIsolation: true
    };
  }

  saveSettings(newSettings) {
    this.data.settings = Object.assign(this.getSettings(), newSettings);
    this.save();
    return this.data.settings;
  }
}

const { OasSqliteStore } = require('./sqlite-store');

module.exports = {
  MemoryStore,
  OasSqliteStore,
  schemaSql,
  rankByLocalVector
};
