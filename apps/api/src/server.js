/**
 * @file apps/api/src/server.js
 * OAS Cloud Control Plane & Streaming Engine Server
 */

const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec, execSync } = require('child_process');

const { OasParser } = require('../../../packages/parser/src/parser');
const { MemoryStore } = require('../../../packages/db/src/index');
const { AgentDagScheduler, ExecutionSandbox, StrategicCompactor, UniversalModelGateway, AgentRunner, WorktreeRunner, CommandRunner } = require('../../../packages/engine/src/index');
const { AuthMiddleware } = require('./middleware/auth');
const { isInsideWorkspace } = require('../../../packages/engine/src/path-guard');
const { getContextWindow, resolveDefaultModel } = require('../../../packages/engine/src/model-registry');
const { dispatchRoutes } = require('./routes');

class OasControlPlaneServer {
  constructor(options = {}) {
    this.port = options.port || 3457;
    this.host = options.host || '127.0.0.1';
    this.workspaceRoot = options.workspaceRoot || path.resolve(__dirname, '../../../');

    this.parser = new OasParser(this.workspaceRoot);
    if (options.store) {
      this.store = options.store;
    } else {
      try {
        const { OasSqliteStore } = require('../../../packages/db/src/index');
        this.store = new OasSqliteStore({
          storagePath: path.join(this.workspaceRoot, '.oas-database.sqlite')
        });
      } catch {
        this.store = new MemoryStore({
          storagePath: path.join(this.workspaceRoot, '.oas-store.json')
        });
      }
    }
    this.scheduler = new AgentDagScheduler({ store: this.store });
    this.sandbox = new ExecutionSandbox({ allowedPaths: [this.workspaceRoot] });
    this.compactor = new StrategicCompactor(200000);
    const savedSettings = this.store.getSettings() || {};
    this.gateway = new UniversalModelGateway({ ...savedSettings, ...options });
    this.worktrees = new WorktreeRunner({ repoRoot: this.workspaceRoot });
    this.runner = new AgentRunner({
      workspaceRoot: this.workspaceRoot,
      sandbox: this.sandbox,
      gateway: this.gateway,
      store: this.store
    });
    this.commands = new CommandRunner({
      scheduler: this.scheduler,
      runner: this.runner,
      compactor: this.compactor,
      store: this.store,
      worktrees: this.worktrees
    });

    this.customNodeOverrides = {};
    this.customEdges = [];

    // Connected SSE clients for live agent streaming
    this.sseClients = new Set();
    this.auth = new AuthMiddleware({
      token: savedSettings.apiToken || options.apiToken || process.env.OAS_API_TOKEN,
      bindHost: this.host
    });

    this.cachedCatalog = null;
    this.initCatalog();
    this.bindEngineEvents();
  }

  initCatalog() {
    try {
      this.cachedCatalog = this.parser.parseAll();
      this.store.syncAgents(this.cachedCatalog.agents);
      this.store.syncSkills(this.cachedCatalog.skills);
    } catch (err) {
      console.error('[OAS Control Plane] Error indexing catalog:', err);
    }
  }

  bindEngineEvents() {
    this.scheduler.on('agent:step', event => {
      this.broadcastSse('agent:step', event);
    });

    this.scheduler.on('agent:session:completed', event => {
      this.broadcastSse('agent:session:completed', event);
    });

    this.scheduler.on('agent:intervention:paused', event => {
      this.broadcastSse('agent:intervention:paused', event);
    });

    this.scheduler.on('agent:intervention:resumed', event => {
      this.broadcastSse('agent:intervention:resumed', event);
    });

    this.scheduler.on('agent:intervention:aborted', event => {
      this.broadcastSse('agent:intervention:aborted', event);
    });

    this.scheduler.on('agent:human_in_the_loop:feedback', event => {
      this.broadcastSse('agent:human_in_the_loop:feedback', event);
    });
  }

  broadcastSse(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.sseClients) {
      if (!res || res.writableEnded || res.destroyed) {
        this.sseClients.delete(res);
        continue;
      }
      try {
        res.write(payload, err => {
          if (err) {
            this.sseClients.delete(res);
          }
        });
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  buildKnowledgeGraph() {
    if (!this.cachedCatalog) this.initCatalog();
    const agents = this.cachedCatalog?.agents || [];
    const skills = this.cachedCatalog?.skills || [];
    const commands = this.cachedCatalog?.commands || [];
    const mcpServers = this.cachedCatalog?.mcpServers || {};

    const nodes = [];
    const edges = [];
    const nodeIds = new Set();

    // 1. Agents
    for (const a of agents) {
      const id = `agent:${a.id}`;
      nodeIds.add(id);
      nodes.push({
        id,
        entityId: a.id,
        name: a.name || a.id,
        type: 'agent',
        category: 'Agents',
        model: a.model || 'sonnet-3.7',
        description: a.description || 'Specialized OAS agent',
        tools: a.tools || [],
        weight: 10
      });
    }

    // 2. Skills
    for (const s of skills) {
      const id = `skill:${s.id}`;
      nodeIds.add(id);
      nodes.push({
        id,
        entityId: s.id,
        name: s.name || s.id,
        type: 'skill',
        category: 'Skills',
        description: s.description || 'Workflow skill',
        triggers: s.triggers || [],
        weight: 6
      });
    }

    // 3. Commands
    for (const c of commands) {
      const id = `command:${c.id}`;
      nodeIds.add(id);
      nodes.push({
        id,
        entityId: c.id,
        name: `/${c.id}`,
        type: 'command',
        category: 'Commands',
        description: c.description || 'Slash command entrypoint',
        weight: 4
      });
    }

    // 4. MCP Servers
    for (const [mcpName, mcpConfig] of Object.entries(mcpServers)) {
      const id = `mcp:${mcpName}`;
      nodeIds.add(id);
      nodes.push({
        id,
        entityId: mcpName,
        name: mcpName,
        type: 'mcp',
        category: 'MCPs',
        description: mcpConfig.description || `MCP Server: ${mcpName}`,
        weight: 5
      });
    }

    // Edges: Agent -> Skill
    for (const a of agents) {
      const agentNodeId = `agent:${a.id}`;
      for (const s of skills) {
        const skillNodeId = `skill:${s.id}`;
        const aClean = a.id.replace(/-guide|-reviewer|-architect|-resolver|-hunter|-cleaner/g, '');
        const sClean = s.id.replace(/-workflow|-patterns|-database|-design/g, '');
        if (a.id === s.id || (aClean.length > 3 && s.id.includes(aClean)) || (sClean.length > 3 && a.id.includes(sClean))) {
          edges.push({
            id: `edge:${agentNodeId}->${skillNodeId}`,
            source: agentNodeId,
            target: skillNodeId,
            type: 'uses_skill',
            label: 'uses skill'
          });
        }
      }
    }

    // Edges: Command -> Agent / Skill
    for (const c of commands) {
      const cmdNodeId = `command:${c.id}`;
      const targetAgent = agents.find(a => a.id === c.id || a.id.startsWith(c.id) || c.id.startsWith(a.id));
      if (targetAgent) {
        edges.push({
          id: `edge:${cmdNodeId}->agent:${targetAgent.id}`,
          source: cmdNodeId,
          target: `agent:${targetAgent.id}`,
          type: 'triggers_agent',
          label: 'triggers'
        });
      }
      const targetSkill = skills.find(s => s.id === c.id || s.id.startsWith(c.id) || c.id.startsWith(s.id));
      if (targetSkill) {
        edges.push({
          id: `edge:${cmdNodeId}->skill:${targetSkill.id}`,
          source: cmdNodeId,
          target: `skill:${targetSkill.id}`,
          type: 'executes_skill',
          label: 'executes'
        });
      }
    }

    // Edges: Agent Delegation Pipeline
    const delegations = [
      ['planner', 'architect'],
      ['planner', 'tdd-guide'],
      ['architect', 'tdd-guide'],
      ['tdd-guide', 'code-reviewer'],
      ['tdd-guide', 'build-error-resolver'],
      ['code-reviewer', 'security-reviewer'],
      ['code-reviewer', 'typescript-reviewer'],
      ['code-reviewer', 'python-reviewer'],
      ['code-reviewer', 'go-reviewer'],
      ['code-reviewer', 'rust-reviewer'],
      ['security-reviewer', 'e2e-runner'],
      ['e2e-runner', 'doc-updater']
    ];

    for (const [src, tgt] of delegations) {
      if (nodeIds.has(`agent:${src}`) && nodeIds.has(`agent:${tgt}`)) {
        edges.push({
          id: `edge:agent:${src}->agent:${tgt}`,
          source: `agent:${src}`,
          target: `agent:${tgt}`,
          type: 'delegates_to',
          label: 'delegates to'
        });
      }
    }

    // Edges: MCP bindings
    const mcpBindings = {
      'context7': ['docs-lookup', 'planner'],
      'firecrawl': ['code-explorer'],
      'exa': ['code-explorer'],
      'postgres': ['database-reviewer'],
      'playwright': ['e2e-runner'],
      'snyk': ['security-reviewer']
    };

    for (const [mcp, boundAgents] of Object.entries(mcpBindings)) {
      if (nodeIds.has(`mcp:${mcp}`)) {
        for (const ag of boundAgents) {
          if (nodeIds.has(`agent:${ag}`)) {
            edges.push({
              id: `edge:mcp:${mcp}->agent:${ag}`,
              source: `mcp:${mcp}`,
              target: `agent:${ag}`,
              type: 'provides_tools',
              label: 'provides context'
            });
          }
        }
      }
    }

    // Apply custom user-defined node overrides and edges
    const finalNodes = nodes.map(n => {
      const override = this.customNodeOverrides[n.id];
      return override ? { ...n, ...override } : n;
    });

    const finalEdges = [...edges, ...(this.customEdges || [])];

    return {
      totalNodes: finalNodes.length,
      totalEdges: finalEdges.length,
      counts: {
        agents: agents.length,
        skills: skills.length,
        commands: commands.length,
        mcps: Object.keys(mcpServers).length
      },
      nodes: finalNodes,
      edges: finalEdges
    };
  }

  buildHudStatus() {
    const settings = this.store.getSettings();
    const allRuns = this.scheduler.getAllRuns();
    const activeRun = allRuns.find(r => r.status === 'running') || allRuns[0];
    const sessions = this.store.getSessions();
    const activeSession = sessions.find(s => s.status === 'active') || sessions[0];
    const artifacts = this.store.getArtifacts();
    const steps = this.store.data.agent_steps || [];

    // Real Git Inspection
    let currentBranch = 'unknown';
    let isDirtyWorktree = false;
    let conflictCount = 0;
    try {
      currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: this.workspaceRoot, encoding: 'utf8' }).trim();
      const statusOutput = execSync('git status --porcelain', { cwd: this.workspaceRoot, encoding: 'utf8' });
      isDirtyWorktree = statusOutput.trim().length > 0;
      conflictCount = (statusOutput.match(/^UU |^AA |^DD /gm) || []).length;
    } catch {
      // Not a git repo or git not in PATH
    }

    // Real Token Usage & Cost Estimation
    const totalTokens = steps.reduce((sum, s) => sum + (s.tokens || 0), 0);
    // Estimated cost: ~$0.003 / 1k tokens for blended frontier inference, or $0 for local ollama
    const costPerToken = settings.provider === 'ollama' ? 0.0 : 0.000003;
    const sessionUsd = Number((totalTokens * costPerToken).toFixed(4));
    const budgetUsd = Number(settings.budgetLimit || 10.0);

    const activeArtifact = artifacts.find(a => a.status === 'in_progress') || artifacts[0];
    const pendingArtifacts = artifacts.filter(a => a.status === 'pending' || a.status === 'draft').length;
    const completedArtifacts = artifacts.filter(a => a.status === 'completed' || a.status === 'published').length;

    const handoffPath = path.join(this.workspaceRoot, '.oas/memory/project/handoff.md');
    const handoffExists = fs.existsSync(handoffPath);

    return {
      schema_version: 'oas.hud-status.v1',
      generatedAt: new Date().toISOString(),
      context: {
        harness: 'universal-studio',
        model: settings.provider === 'ollama' ? (settings.ollamaModel || resolveDefaultModel()) : (settings.defaultModel || resolveDefaultModel()),
        repo: path.basename(this.workspaceRoot),
        branch: currentBranch,
        worktree: this.workspaceRoot,
        sessionId: activeRun ? activeRun.id : (activeSession ? activeSession.id : null),
        contextWindow: (() => {
          const windowSize = getContextWindow(settings.ollamaModel || settings.defaultModel || resolveDefaultModel());
          return {
            totalTokens,
            windowSize,
            remainingPct: Math.max(0, 100 - Math.round((totalTokens / windowSize) * 100)),
            pressure: totalTokens > windowSize * 0.75 ? 'high' : (totalTokens > windowSize * 0.4 ? 'medium' : 'normal')
          };
        })()
      },
      toolCalls: {
        total: steps.length,
        pending: steps.filter(s => s.status === 'running' || s.status === 'pending').length,
        stale: 0,
        lastTool: steps.length > 0 ? {
          name: steps[steps.length - 1].agent_id || 'system',
          status: steps[steps.length - 1].status || 'success',
          finishedAt: steps[steps.length - 1].timestamp || new Date().toISOString()
        } : null
      },
      activeAgents: (this.cachedCatalog?.agents || []).slice(0, 4).map((a, idx) => ({
        id: a.id,
        name: a.name || a.id,
        state: idx === 0 && steps.some(s => s.status === 'running') ? 'running' : 'ready',
        branch: currentBranch,
        worktree: this.workspaceRoot,
        objective: a.description || 'Specialized domain automation',
        handoffPath: path.join(this.workspaceRoot, '.oas/memory/project', `${a.id}-handoff.md`)
      })),
      todos: {
        inProgress: activeArtifact ? activeArtifact.title : 'None active',
        counts: {
          pending: pendingArtifacts,
          inProgress: artifacts.filter(a => a.status === 'in_progress').length,
          completed: completedArtifacts
        }
      },
      checks: {
        local: [
          { command: 'git status', status: isDirtyWorktree ? 'dirty' : 'clean' },
          { command: 'active provider', status: settings.provider || 'ollama' }
        ],
        remote: []
      },
      cost: {
        sessionUsd,
        budgetUsd,
        trend: sessionUsd > budgetUsd ? 'exceeded-budget' : (sessionUsd > budgetUsd * 0.8 ? 'approaching-limit' : 'within-budget')
      },
      risk: {
        status: conflictCount > 0 ? 'critical' : (isDirtyWorktree ? 'warning' : 'safe'),
        reasons: [
          ...(conflictCount > 0 ? [`${conflictCount} merge conflicts detected`] : []),
          ...(isDirtyWorktree ? ['Uncommitted changes in worktree'] : [])
        ],
        dirtyWorktree: isDirtyWorktree,
        conflicts: conflictCount,
        manualReviewRequired: conflictCount > 0
      },
      queueState: {
        github: {
          openPullRequests: 0,
          openIssues: 0,
          openDiscussions: 0
        },
        mergeQueue: [],
        conflictQueue: [],
        staleSalvageQueue: []
      },
      sessionControls: {
        supported: [
          'create',
          'resume',
          'status',
          'stop',
          'diff',
          'pr',
          'mergeQueue',
          'conflictQueue'
        ],
        blocked: []
      },
      sync: {
        Linear: {
          connected: Boolean(process.env.LINEAR_API_KEY),
          status: process.env.LINEAR_API_KEY ? 'configured' : 'unconfigured'
        },
        GitHub: {
          connected: Boolean(process.env.GITHUB_TOKEN),
          status: process.env.GITHUB_TOKEN ? 'configured' : 'unconfigured'
        },
        handoff: {
          path: handoffPath,
          written: handoffExists
        }
      }
    };
  }

  getWorkspaceFileTree(dirPath, relativePath = '', depth = 0) {
    if (depth > 4) return [];
    const ignored = new Set(['node_modules', '.git', '.oas-worktrees', '.next', 'dist', 'build', '.DS_Store', '.oas-store.json']);
    const entries = [];
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const item of items) {
        if (ignored.has(item.name)) continue;
        if (item.name.startsWith('.') && item.name !== '.agents') continue;
        const itemRel = relativePath ? `${relativePath}/${item.name}` : item.name;
        const fullPath = path.join(dirPath, item.name);
        if (item.isDirectory()) {
          entries.push({
            name: item.name,
            path: itemRel,
            type: 'directory',
            children: this.getWorkspaceFileTree(fullPath, itemRel, depth + 1)
          });
        } else if (item.isFile()) {
          const stat = fs.statSync(fullPath);
          entries.push({
            name: item.name,
            path: itemRel,
            type: 'file',
            size: stat.size,
            extension: path.extname(item.name)
          });
        }
      }
    } catch {
      // ignore unreadable dirs
    }
    entries.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });
    return entries;
  }

  readWorkspaceFile(relativeFilePath) {
    const resolved = path.resolve(this.workspaceRoot, relativeFilePath);
    if (!isInsideWorkspace(this.workspaceRoot, resolved)) {
      throw new Error('Access denied: Path outside workspace sandbox');
    }
    if (!fs.existsSync(resolved)) {
      throw new Error('File not found: ' + relativeFilePath);
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      throw new Error('Path is a directory');
    }
    if (stat.size > 1024 * 1024) {
      throw new Error('File exceeds maximum readable size of 1MB');
    }
    const content = fs.readFileSync(resolved, 'utf8');
    const lines = content.split('\n').length;
    return {
      path: relativeFilePath,
      size: stat.size,
      lines,
      extension: path.extname(resolved),
      content
    };
  }

  writeWorkspaceFile(relativeFilePath, content) {
    if (!relativeFilePath || typeof relativeFilePath !== 'string') {
      throw new Error('Invalid file path specified');
    }
    const resolved = path.resolve(this.workspaceRoot, relativeFilePath);
    if (!isInsideWorkspace(this.workspaceRoot, resolved)) {
      throw new Error('Access denied: Path outside workspace sandbox');
    }
    const rel = path.relative(this.workspaceRoot, resolved);
    const forbidden = ['.git', 'node_modules', '.oas-store.json'];
    if (forbidden.some(f => rel === f || rel.startsWith(f + '/') || rel.startsWith(f + '\\'))) {
      throw new Error('Protected system path: Cannot write to ' + relativeFilePath);
    }
    const parentDir = path.dirname(resolved);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(resolved, content, 'utf8');
    const stat = fs.statSync(resolved);
    return {
      success: true,
      path: relativeFilePath,
      size: stat.size,
      lines: content.split('\n').length,
      updatedAt: new Date().toISOString()
    };
  }

  computeSimpleDiff(originalContent, modifiedContent, filename = 'file') {
    const origLines = (originalContent || '').split('\n');
    const modLines = (modifiedContent || '').split('\n');
    const diffLines = [];
    let additions = 0;
    let deletions = 0;

    diffLines.push(`--- a/${filename}`);
    diffLines.push(`+++ b/${filename}`);

    const maxLen = Math.max(origLines.length, modLines.length);
    for (let i = 0; i < maxLen; i++) {
      const o = origLines[i];
      const m = modLines[i];
      if (o === undefined) {
        diffLines.push(`+ ${m}`);
        additions++;
      } else if (m === undefined) {
        diffLines.push(`- ${o}`);
        deletions++;
      } else if (o !== m) {
        diffLines.push(`- ${o}`);
        diffLines.push(`+ ${m}`);
        additions++;
        deletions++;
      } else {
        diffLines.push(`  ${o}`);
      }
    }

    return {
      diff: diffLines.join('\n'),
      additions,
      deletions,
      totalChanges: additions + deletions
    };
  }

  setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  sendJson(res, statusCode, data) {
    if (!res || res.headersSent || res.writableEnded || res.destroyed) {
      return;
    }
    try {
      this.setCorsHeaders(res);
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      console.error('[sendJson Error]', err.message);
    }
  }

  async parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 5 * 1024 * 1024) {
          reject(new Error('Body too large'));
        }
      });
      req.on('end', () => {
        if (!body) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch {
          const err = new Error('Invalid JSON body');
          err.code = 'INVALID_JSON';
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  verifyGithubSignature(rawBody, signatureHeader, secret) {
    if (!secret) return true;
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  async handleRequest(req, res) {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // --- REQUEST AUTHENTICATION & RATE LIMITING MIDDLEWARE ---
    const authResult = this.auth.authenticate(req, pathname, req.method);
    if (!authResult.authorized) {
      if (authResult.statusCode === 429) {
        res.setHeader('Retry-After', String(authResult.retryAfter || 60));
      }
      return this.sendJson(res, authResult.statusCode, { error: authResult.error });
    }

    try {
        const handled = await dispatchRoutes(this, req, res, pathname, parsedUrl);
        if (handled) return;

        // Fallback 404
        return this.sendJson(res, 404, { error: 'Route not found: ' + pathname });
      } catch (err) {
        console.error('[OAS Control Plane Error]', err);
        if (err && err.code === 'INVALID_JSON') {
          return this.sendJson(res, 400, { error: err.message });
        }
        return this.sendJson(res, 500, { error: err.message });
      }
  }

  start(callback) {
    // Start SSE heartbeat ping every 15s to keep connections alive and evict dead sockets
    if (!this.sseHeartbeat) {
      this.sseHeartbeat = setInterval(() => {
        for (const res of this.sseClients) {
          if (!res || res.writableEnded || res.destroyed) {
            this.sseClients.delete(res);
            continue;
          }
          try {
            res.write(': keepalive\n\n', err => {
              if (err) this.sseClients.delete(res);
            });
          } catch {
            this.sseClients.delete(res);
          }
        }
      }, 15000);
      if (this.sseHeartbeat.unref) this.sseHeartbeat.unref();
    }

    const tryListen = (currentPort) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch(err => {
          console.error('[OAS Studio Request Error]', err);
          if (res && !res.headersSent && !res.writableEnded && !res.destroyed) {
            try {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
            } catch {}
          }
        });
      });
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[OAS Studio] Port ${currentPort} in use, trying ${currentPort + 1}...`);
          tryListen(currentPort + 1);
        } else {
          console.error('[OAS Studio Server Error]', err);
        }
      });
      server.listen(currentPort, this.host, () => {
        this.port = currentPort;
        console.log(`[OAS Control Plane API] Running on http://${this.host}:${this.port}`);
        this.detectOllama();
        if (callback) callback(server, this.port);
      });
      return server;
    };
    return tryListen(this.port);
  }

  detectOllama() {
    try {
      const ollamaHost = this.store.getSettings()?.ollamaHost || 'http://localhost:11434';
      const parsed = url.parse(ollamaHost);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.get(`${ollamaHost}/api/tags`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsedData = JSON.parse(data);
            const models = (parsedData.models || []).map(m => m.name);
            console.log(`[OAS LLM Gateway] Ollama detected at ${ollamaHost} with ${models.length} local models: [${models.slice(0, 5).join(', ')}]`);
          } catch {
            // silent
          }
        });
      });
      req.on('error', () => {
        // Ollama not reachable on startup
      });
    } catch {
      // ignore
    }
  }
}

if (require.main === module) {
  const server = new OasControlPlaneServer({ port: 3457 });
  server.start();
}

module.exports = {
  OasControlPlaneServer
};
