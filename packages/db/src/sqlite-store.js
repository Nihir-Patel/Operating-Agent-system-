/**
 * @file packages/db/src/sqlite-store.js
 * OAS Persistent SQLite Data Store (node:sqlite DatabaseSync with WAL mode)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /sk-(?:live|proj|ant)?[A-Za-z0-9_-]{20,}/
];

const SQLITE_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  filename TEXT,
  description TEXT,
  model TEXT DEFAULT 'sonnet',
  tools TEXT DEFAULT '[]',
  system_prompt TEXT,
  cluster TEXT,
  delegates_to TEXT DEFAULT '[]',
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS skill_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  directory TEXT,
  description TEXT,
  domain TEXT,
  has_scripts INTEGER DEFAULT 0,
  has_references INTEGER DEFAULT 0,
  has_examples INTEGER DEFAULT 0,
  triggers TEXT DEFAULT '[]',
  instructions TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  lead_agent_id TEXT,
  total_tokens INTEGER DEFAULT 0,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES agent_sessions(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  agent_id TEXT,
  step_type TEXT NOT NULL,
  content TEXT,
  tool_name TEXT,
  tool_args TEXT,
  tool_result TEXT,
  diff_content TEXT,
  duration_ms INTEGER DEFAULT 0,
  tokens INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS memory_vault (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  scope TEXT NOT NULL DEFAULT 'project',
  kind TEXT NOT NULL DEFAULT 'convention',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  artifact_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'in_progress',
  phases TEXT DEFAULT '[]',
  annotations TEXT DEFAULT '[]',
  file_path TEXT,
  content TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_steps_session ON agent_steps(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_vault(scope);
CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
`;

class OasSqliteStore {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), '.oas-database.sqlite');
    this.legacyJsonPath = options.legacyJsonPath || path.join(path.dirname(this.storagePath), '.oas-store.json');
    this.memoryRoot = options.memoryRoot || path.join(path.dirname(this.storagePath), '.oas', 'memory');

    // Initialize SQLite DatabaseSync
    this.db = new DatabaseSync(this.storagePath);
    this.initSchema();
    this.migrateFromLegacyJson();

    // Backwards-compatible proxy for store.data.*
    this.data = new Proxy({}, {
      get: (_, prop) => {
        if (prop === 'agent_sessions') return this.getSessions();
        if (prop === 'agent_steps') return this.getAllSteps();
        if (prop === 'memory_vault') return this.getMemoryVault();
        if (prop === 'artifacts') return this.getArtifacts();
        if (prop === 'settings') return this.getSettings();
        if (prop === 'agent_definitions') return this.getAgents();
        if (prop === 'skill_definitions') return this.getSkills();
        return [];
      }
    });
  }

  initSchema() {
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(SQLITE_SCHEMA);
  }

  migrateFromLegacyJson() {
    try {
      if (fs.existsSync(this.legacyJsonPath)) {
        const count = this.db.prepare('SELECT COUNT(*) as count FROM agent_sessions').get().count;
        if (count === 0) {
          const raw = fs.readFileSync(this.legacyJsonPath, 'utf8');
          const data = JSON.parse(raw);
          if (Array.isArray(data.agent_sessions)) {
            for (const s of data.agent_sessions) this.createSession(s);
          }
          if (Array.isArray(data.memory_vault)) {
            for (const m of data.memory_vault) this.addMemory(m);
          }
          if (Array.isArray(data.artifacts)) {
            for (const a of data.artifacts) this.addArtifact(a);
          }
          if (data.settings && typeof data.settings === 'object') {
            this.saveSettings(data.settings);
          }
        }
      }
    } catch {
      // Ignore migration errors
    }
  }

  // --- AGENTS & SKILLS ---
  syncAgents(agents) {
    const stmt = this.db.prepare(`
      INSERT INTO agent_definitions (id, name, filename, description, model, tools, system_prompt, cluster, delegates_to, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        filename = excluded.filename,
        description = excluded.description,
        model = excluded.model,
        tools = excluded.tools,
        system_prompt = excluded.system_prompt,
        cluster = excluded.cluster,
        delegates_to = excluded.delegates_to,
        updated_at = excluded.updated_at
    `);

    const now = new Date().toISOString();
    for (const a of agents) {
      stmt.run(
        a.id,
        a.name || a.id,
        a.filename || '',
        a.description || '',
        a.model || 'sonnet',
        JSON.stringify(a.tools || []),
        a.system_prompt || '',
        a.cluster || 'general',
        JSON.stringify(a.delegates_to || []),
        now
      );
    }
    return this.getAgents();
  }

  getAgents() {
    const rows = this.db.prepare('SELECT * FROM agent_definitions').all();
    return rows.map(r => ({
      ...r,
      tools: JSON.parse(r.tools || '[]'),
      delegates_to: JSON.parse(r.delegates_to || '[]')
    }));
  }

  syncSkills(skills) {
    const stmt = this.db.prepare(`
      INSERT INTO skill_definitions (id, name, directory, description, domain, has_scripts, has_references, has_examples, triggers, instructions, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        directory = excluded.directory,
        description = excluded.description,
        domain = excluded.domain,
        has_scripts = excluded.has_scripts,
        has_references = excluded.has_references,
        has_examples = excluded.has_examples,
        triggers = excluded.triggers,
        instructions = excluded.instructions,
        updated_at = excluded.updated_at
    `);

    const now = new Date().toISOString();
    for (const s of skills) {
      stmt.run(
        s.id,
        s.name || s.id,
        s.directory || '',
        s.description || '',
        s.domain || 'general',
        s.has_scripts ? 1 : 0,
        s.has_references ? 1 : 0,
        s.has_examples ? 1 : 0,
        JSON.stringify(s.triggers || []),
        s.instructions || '',
        now
      );
    }
    return this.getSkills();
  }

  getSkills() {
    const rows = this.db.prepare('SELECT * FROM skill_definitions').all();
    return rows.map(r => ({
      ...r,
      has_scripts: !!r.has_scripts,
      has_references: !!r.has_references,
      has_examples: !!r.has_examples,
      triggers: JSON.parse(r.triggers || '[]')
    }));
  }

  // --- SESSIONS ---
  createSession(payload) {
    const session = {
      id: payload.id || 'sess_' + Date.now().toString(36),
      workspace_id: payload.workspace_id || null,
      title: payload.title || 'New Agent Session',
      status: payload.status || 'active',
      lead_agent_id: payload.lead_agent_id || 'planner',
      total_tokens: payload.total_tokens || 0,
      prompt_tokens: payload.prompt_tokens || 0,
      completion_tokens: payload.completion_tokens || 0,
      cost_usd: payload.cost_usd || 0,
      started_at: payload.started_at || new Date().toISOString(),
      ended_at: payload.ended_at || null
    };

    const stmt = this.db.prepare(`
      INSERT INTO agent_sessions (id, workspace_id, title, status, lead_agent_id, total_tokens, prompt_tokens, completion_tokens, cost_usd, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.workspace_id,
      session.title,
      session.status,
      session.lead_agent_id,
      session.total_tokens,
      session.prompt_tokens,
      session.completion_tokens,
      session.cost_usd,
      session.started_at,
      session.ended_at
    );

    return session;
  }

  getSessions() {
    return this.db.prepare('SELECT * FROM agent_sessions ORDER BY started_at DESC').all();
  }

  getSession(id) {
    return this.db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) || null;
  }

  renameSession(id, title) {
    const stmt = this.db.prepare('UPDATE agent_sessions SET title = ? WHERE id = ?');
    stmt.run(title, id);
    return this.getSession(id);
  }

  deleteSession(id) {
    const stmt = this.db.prepare('DELETE FROM agent_sessions WHERE id = ?');
    const res = stmt.run(id);
    return (res.changes || 0) > 0;
  }

  // --- STEPS ---
  addStep(sessionId, stepPayload) {
    const countRow = this.db.prepare('SELECT COUNT(*) as count FROM agent_steps WHERE session_id = ?').get(sessionId);
    const stepIndex = (countRow?.count || 0) + 1;

    const step = {
      id: 'step_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      session_id: sessionId,
      step_index: stepIndex,
      agent_id: stepPayload.agent_id || 'planner',
      step_type: stepPayload.step_type || 'thought',
      content: stepPayload.content || '',
      tool_name: stepPayload.tool_name || null,
      tool_args: stepPayload.tool_args ? (typeof stepPayload.tool_args === 'string' ? stepPayload.tool_args : JSON.stringify(stepPayload.tool_args)) : null,
      tool_result: stepPayload.tool_result ? (typeof stepPayload.tool_result === 'string' ? stepPayload.tool_result : JSON.stringify(stepPayload.tool_result)) : null,
      diff_content: stepPayload.diff_content || null,
      duration_ms: stepPayload.duration_ms || 0,
      tokens: stepPayload.tokens || 0,
      created_at: new Date().toISOString()
    };

    const stmt = this.db.prepare(`
      INSERT INTO agent_steps (id, session_id, step_index, agent_id, step_type, content, tool_name, tool_args, tool_result, diff_content, duration_ms, tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      step.id,
      step.session_id,
      step.step_index,
      step.agent_id,
      step.step_type,
      step.content,
      step.tool_name,
      step.tool_args,
      step.tool_result,
      step.diff_content,
      step.duration_ms,
      step.tokens,
      step.created_at
    );

    // Update tokens on session
    if (step.tokens > 0) {
      this.db.prepare('UPDATE agent_sessions SET total_tokens = total_tokens + ? WHERE id = ?').run(step.tokens, sessionId);
    }

    return step;
  }

  getSteps(sessionId) {
    const rows = this.db.prepare('SELECT * FROM agent_steps WHERE session_id = ? ORDER BY step_index ASC').all(sessionId);
    return rows.map(r => ({
      ...r,
      tool_args: r.tool_args ? (r.tool_args.startsWith('{') || r.tool_args.startsWith('[') ? JSON.parse(r.tool_args) : r.tool_args) : null,
      tool_result: r.tool_result ? (r.tool_result.startsWith('{') || r.tool_result.startsWith('[') ? JSON.parse(r.tool_result) : r.tool_result) : null
    }));
  }

  getAllSteps() {
    const rows = this.db.prepare('SELECT * FROM agent_steps ORDER BY created_at ASC').all();
    return rows.map(r => ({
      ...r,
      tool_args: r.tool_args ? (r.tool_args.startsWith('{') || r.tool_args.startsWith('[') ? JSON.parse(r.tool_args) : r.tool_args) : null,
      tool_result: r.tool_result ? (r.tool_result.startsWith('{') || r.tool_result.startsWith('[') ? JSON.parse(r.tool_result) : r.tool_result) : null
    }));
  }

  // --- MEMORY VAULT ---
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
    const now = new Date().toISOString();

    const record = {
      id: memoryId,
      workspace_id: item.workspace_id || null,
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
      created_at: item.created_at || now,
      updated_at: now
    };

    const stmt = this.db.prepare(`
      INSERT INTO memory_vault (id, workspace_id, scope, kind, title, body, hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scope = excluded.scope,
        kind = excluded.kind,
        title = excluded.title,
        body = excluded.body,
        hash = excluded.hash,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      record.id,
      record.workspace_id,
      record.scope,
      record.kind,
      record.title,
      record.body,
      record.hash,
      record.created_at,
      record.updated_at
    );

    // Also persist Markdown file
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
      // Silent filesystem fallback
    }

    return record;
  }

  getMemoryVault(query) {
    const rows = this.db.prepare('SELECT * FROM memory_vault ORDER BY updated_at DESC').all();
    const records = rows.map(r => ({
      ...r,
      content: r.body,
      category: r.kind,
      sha256: r.hash
    }));

    if (!query) return records;
    const q = query.toLowerCase().trim();
    const terms = q.split(/\s+/).filter(Boolean);

    const semanticMap = {
      'test': ['coverage', 'tdd', 'unit', 'integration', 'assertion'],
      'security': ['sandbox', 'secret', 'credential', 'auth', 'loopback', 'guard'],
      'architecture': ['pattern', 'immutability', 'structure', 'modular', 'contract'],
      'spec': ['brownfield', 'requirement', 'extraction', 'srs', 'invariant'],
      'error': ['exception', 'fail', 'crash', 'rollback', 'checkpoint']
    };

    const expandedTerms = new Set(terms);
    for (const term of terms) {
      for (const [concept, synonyms] of Object.entries(semanticMap)) {
        if (concept.includes(term) || term.includes(concept)) {
          synonyms.forEach(s => expandedTerms.add(s));
        } else if (synonyms.some(s => s.includes(term) || term.includes(s))) {
          expandedTerms.add(concept);
          synonyms.forEach(s => expandedTerms.add(s));
        }
      }
    }

    const scored = records.map(m => {
      let score = 0;
      const title = (m.title || '').toLowerCase();
      const body = (m.body || m.content || '').toLowerCase();
      const scope = (m.scope || '').toLowerCase();
      const kind = (m.kind || m.category || '').toLowerCase();

      if (title.includes(q)) score += 10;
      if (body.includes(q)) score += 6;

      for (const term of expandedTerms) {
        if (title.includes(term)) score += 4;
        if (body.includes(term)) score += 2;
        if (scope.includes(term)) score += 3;
        if (kind.includes(term)) score += 3;
      }

      return { item: m, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => ({ ...s.item, semanticScore: s.score }));
  }

  deleteMemory(id) {
    const row = this.db.prepare('SELECT * FROM memory_vault WHERE id = ?').get(id);
    const stmt = this.db.prepare('DELETE FROM memory_vault WHERE id = ?');
    const res = stmt.run(id);

    if (row) {
      try {
        const filePath = path.join(this.memoryRoot, row.scope || 'project', `${id}.md`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Silent fallback
      }
    }

    return (res.changes || 0) > 0;
  }

  // --- ARTIFACTS ---
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

    const stmt = this.db.prepare(`
      INSERT INTO artifacts (id, session_id, artifact_type, title, status, phases, annotations, file_path, content, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.session_id,
      record.artifact_type,
      record.title,
      record.status,
      JSON.stringify(record.phases),
      JSON.stringify(record.annotations),
      record.file_path,
      record.content,
      JSON.stringify(record.metadata),
      record.created_at,
      record.updated_at
    );

    return record;
  }

  getArtifacts(sessionId) {
    let rows;
    if (sessionId) {
      rows = this.db.prepare('SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at DESC').all(sessionId);
    } else {
      rows = this.db.prepare('SELECT * FROM artifacts ORDER BY created_at DESC').all();
    }

    return rows.map(r => ({
      ...r,
      phases: JSON.parse(r.phases || '[]'),
      annotations: JSON.parse(r.annotations || '[]'),
      metadata: JSON.parse(r.metadata || '{}')
    }));
  }

  updateArtifact(id, updates) {
    const existing = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id);
    if (!existing) return null;

    const current = {
      ...existing,
      phases: JSON.parse(existing.phases || '[]'),
      annotations: JSON.parse(existing.annotations || '[]'),
      metadata: JSON.parse(existing.metadata || '{}')
    };

    const newTitle = updates.title !== undefined ? updates.title : current.title;
    const newStatus = updates.status !== undefined ? updates.status : current.status;
    const newPhases = updates.phases !== undefined ? updates.phases : current.phases;
    const newAnnotations = updates.annotations !== undefined ? updates.annotations : current.annotations;
    const newContent = updates.content !== undefined ? updates.content : current.content;
    const newMetadata = updates.metadata !== undefined ? { ...current.metadata, ...updates.metadata } : current.metadata;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE artifacts SET
        title = ?,
        status = ?,
        phases = ?,
        annotations = ?,
        content = ?,
        metadata = ?,
        updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      newTitle,
      newStatus,
      JSON.stringify(newPhases),
      JSON.stringify(newAnnotations),
      newContent,
      JSON.stringify(newMetadata),
      now,
      id
    );

    return {
      ...current,
      title: newTitle,
      status: newStatus,
      phases: newPhases,
      annotations: newAnnotations,
      content: newContent,
      metadata: newMetadata,
      updated_at: now
    };
  }

  // --- SETTINGS ---
  getSettings() {
    const defaultSettings = {
      provider: 'ollama',
      anthropicApiKey: '',
      openaiApiKey: '',
      geminiApiKey: '',
      ollamaHost: 'http://localhost:11434',
      ollamaModel: 'qwen2.5-coder:7b',
      defaultModel: 'qwen2.5-coder:7b',
      sandboxEnabled: true,
      worktreeIsolation: true
    };

    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    if (rows.length === 0) return defaultSettings;

    const loaded = { ...defaultSettings };
    for (const row of rows) {
      try {
        loaded[row.key] = JSON.parse(row.value);
      } catch {
        loaded[row.key] = row.value;
      }
    }
    return loaded;
  }

  saveSettings(newSettings) {
    const current = this.getSettings();
    const merged = { ...current, ...newSettings };
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    for (const [key, val] of Object.entries(merged)) {
      stmt.run(key, JSON.stringify(val), now);
    }
    return merged;
  }
}

module.exports = {
  OasSqliteStore
};
