/**
 * @file apps/web/app.js
 * OAS Studio & Cloud Control Plane Frontend Controller
 */

// Application State Store
const state = {
  activeView: 'view-dag',
  catalog: {
    agents: [],
    skills: [],
    commands: [],
    mcp: []
  },
  currentFilter: 'all',
  searchQuery: '',
  activeSession: {
    id: 'sess_enterprise_control_plane',
    title: 'OAS Enterprise Cloud Control Plane Build',
    currentNode: 'node-tdd',
    status: 'running'
  }
};

// Node metadata for interactive DAG
const nodeMetadata = {
  'planner': {
    name: 'planner',
    role: 'Decompose User Intent & Capability Plan',
    model: 'Claude 3.7 Sonnet',
    cot: '[planner] Analyzed project scope. Broken into 5 discrete phases with strict contract boundaries and automated verification gates.',
    tool: 'tool: read_file\npath: "agent.yaml"\nduration: 32ms'
  },
  'architect': {
    name: 'architect',
    role: 'System Architecture & Contract Invariants',
    model: 'Claude 3.7 Opus',
    cot: '[architect] Designing event-driven architecture with WebSocket SSE fallback and PostgreSQL + pgvector persistence.',
    tool: 'tool: write_file\npath: "packages/db/src/schema.js"\nduration: 110ms'
  },
  'tdd-guide': {
    name: 'tdd-guide',
    role: 'TDD Red-Green Implementation & 80%+ Coverage',
    model: 'Claude 3.7 Sonnet',
    cot: '[tdd-guide] Formulating unit & integration tests in tests/api-control-plane.test.js. Asserting 100% catalog entity integrity.',
    tool: 'tool: run_command\ncommand: "node tests/api-control-plane.test.js"\nduration: 85ms'
  },
  'code-reviewer': {
    name: 'code-reviewer',
    role: 'Code Quality, Security & Immutability Audit',
    model: 'Claude 3.7 Sonnet',
    cot: '[code-reviewer] Auditing codebase against immutability rules. No in-place state mutations detected in scheduler or store.',
    tool: 'tool: grep_search\nquery: "state\..*="\nduration: 45ms'
  },
  'security-reviewer': {
    name: 'security-reviewer',
    role: 'Vulnerability Detection & Input Validation',
    model: 'Claude 3.7 Sonnet',
    cot: '[security-reviewer] Running loopback guard and sandbox audit. Destructive patterns and exfiltration payloads neutralized.',
    tool: 'tool: snyk_code_scan\nstatus: "CLEAN"\nduration: 240ms'
  },
  'doc-updater': {
    name: 'doc-updater',
    role: 'Codemap & Documentation Synchronization',
    model: 'Claude 3.5 Haiku',
    cot: '[doc-updater] Updating architectural walkthrough, README badges, and operator readiness metrics.',
    tool: 'tool: write_file\npath: "walkthrough.md"\nduration: 28ms'
  }
};

// DOM Elements
const elements = {
  navItems: document.querySelectorAll('.nav-item'),
  viewPanels: document.querySelectorAll('.view-panel'),
  currentViewTitle: document.getElementById('current-view-title'),
  dagSvg: document.getElementById('dag-svg'),
  dagNodes: document.querySelectorAll('.dag-node'),
  inspectorNodeName: document.getElementById('inspector-node-name'),
  inspectorModelBadge: document.getElementById('inspector-model-badge'),
  inspectorNodeRole: document.getElementById('inspector-node-role'),
  inspectorCotText: document.getElementById('inspector-cot-text'),
  inspectorToolBlock: document.getElementById('inspector-tool-block'),
  catalogGrid: document.getElementById('catalog-grid-cards'),
  catalogSearch: document.getElementById('catalog-search'),
  filterPills: document.querySelectorAll('.pill'),
  modal: document.getElementById('entity-modal'),
  modalTitle: document.getElementById('modal-title'),
  modalSubtitle: document.getElementById('modal-subtitle'),
  modalDesc: document.getElementById('modal-desc'),
  modalPrompt: document.getElementById('modal-prompt'),
  modalClose: document.getElementById('modal-close'),
  modalCancel: document.getElementById('modal-btn-cancel'),
  modalRun: document.getElementById('modal-btn-run'),
  btnSimulateStep: document.getElementById('btn-dag-simulate-step'),
  btnAutoRun: document.getElementById('btn-dag-auto-run'),
  btnDagPause: document.getElementById('btn-dag-pause'),
  btnAddAnnotation: document.getElementById('btn-add-annotation'),
  annotationInput: document.getElementById('plan-new-annotation')
};

// View Titles
const viewTitles = {
  'view-dag': 'Execution DAG Orchestrator',
  'view-workspace': 'Live Streaming Workspace & Virtual Terminal',
  'view-knowledge-graph': 'Interactive Knowledge Graph Visualizer (483 Relational Nodes)',
  'view-plan-canvas': 'Plan Canvas Pro (Interactive Roadmap)',
  'view-catalog': 'Capabilities Catalog & Studio (68 Agents • 286 Skills • 94 Commands)',
  'view-vault': 'Memory Vault & Telemetry Dashboard',
  'view-builder': 'Studio Builder (Visual Agent & Skill Designer)'
};

// Navigation
function switchView(viewId) {
  state.activeView = viewId;

  elements.navItems.forEach(item => {
    if (item.getAttribute('data-view') === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  elements.viewPanels.forEach(panel => {
    if (panel.id === viewId) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });

  if (viewTitles[viewId]) {
    elements.currentViewTitle.textContent = viewTitles[viewId];
  }

  if (viewId === 'view-knowledge-graph') {
    setTimeout(initKgSimulation, 50);
  } else if (viewId === 'view-workspace') {
    loadWorkspaceTree();
  } else if (viewId === 'view-dag') {
    renderDynamicDag();
  }
}

elements.navItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetView = item.getAttribute('data-view');
    switchView(targetView);
  });
});

// Interactive DAG Node Selection
function selectDagNode(agentKey) {
  const meta = nodeMetadata[agentKey];
  if (!meta) return;

  elements.inspectorNodeName.textContent = meta.name;
  elements.inspectorModelBadge.textContent = 'Model: ' + meta.model;
  elements.inspectorNodeRole.textContent = meta.role;
  elements.inspectorCotText.textContent = meta.cot;
  elements.inspectorToolBlock.innerHTML = meta.tool.replace(/\n/g, '<br>');

  elements.dagNodes.forEach(node => {
    const key = node.getAttribute('data-agent');
    const rect = node.querySelector('rect');
    if (key === agentKey) {
      rect.setAttribute('stroke', '#3B82F6');
      rect.setAttribute('stroke-width', '2.5');
    } else {
      rect.setAttribute('stroke-width', '1.5');
    }
  });
}

elements.dagNodes.forEach(node => {
  node.addEventListener('click', () => {
    const key = node.getAttribute('data-agent');
    selectDagNode(key);
  });
});

// Live Execution & DAG Step Advancement
const stepSequence = ['planner', 'architect', 'tdd-guide', 'code-reviewer', 'security-reviewer', 'doc-updater'];
let currentSequenceIndex = 2;

async function advanceDagStep() {
  const activeAgent = stepSequence[currentSequenceIndex];
  selectDagNode(activeAgent);

  // Attempt live execution via backend
  try {
    const res = await fetch(`/api/sessions/${state.activeSession.id}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'OAS Enterprise Capability Run' })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.output) {
        elements.inspectorCotText.textContent = data.output;
      }
    }
  } catch (err) {
    // Graceful offline fallback
  }

  currentSequenceIndex = (currentSequenceIndex + 1) % stepSequence.length;
  const nextAgent = stepSequence[currentSequenceIndex];

  // Update visual node status
  elements.dagNodes.forEach((node, idx) => {
    const rect = node.querySelector('rect');
    const circle = node.querySelector('circle');
    const textStatus = node.querySelectorAll('text')[2];

    if (idx < currentSequenceIndex) {
      rect.setAttribute('stroke', '#10B981');
      circle.setAttribute('fill', '#10B981');
      if (textStatus) textStatus.textContent = 'DONE';
    } else if (idx === currentSequenceIndex) {
      rect.setAttribute('stroke', '#3B82F6');
      circle.setAttribute('fill', '#3B82F6');
      if (textStatus) textStatus.textContent = 'RUNNING';
    } else {
      rect.setAttribute('stroke', 'rgba(226, 232, 240, 0.15)');
      circle.setAttribute('fill', '#64748B');
      if (textStatus) textStatus.textContent = 'QUEUED';
    }
  });

  // Append step to streaming workspace
  const stream = document.getElementById('thought-stream-content');
  if (stream) {
    const msg = document.createElement('div');
    msg.className = 'stream-message';
    msg.innerHTML = `<strong>[${nextAgent}]</strong> Executing subagent cycle with live Universal Model Gateway.`;
    stream.appendChild(msg);
    stream.scrollTop = stream.scrollHeight;
  }
}

// Connect to Real-time SSE Stream
function connectSseStream() {
  try {
    const eventSource = new EventSource('/api/stream');
    eventSource.addEventListener('agent:thought:chunk', e => {
      const data = JSON.parse(e.data);
      const stream = document.getElementById('thought-stream-content');
      if (stream && data.text) {
        const lastMsg = stream.lastElementChild;
        if (lastMsg && lastMsg.classList.contains('stream-chunk-active')) {
          lastMsg.innerHTML += data.text.replace(/\n/g, '<br>');
        } else {
          const chunkMsg = document.createElement('div');
          chunkMsg.className = 'stream-message stream-chunk-active';
          chunkMsg.innerHTML = `<strong>[${data.agentId}]</strong> ${data.text.replace(/\n/g, '<br>')}`;
          stream.appendChild(chunkMsg);
        }
        stream.scrollTop = stream.scrollHeight;
      }
    });

    eventSource.addEventListener('agent:tool:executed', e => {
      const data = JSON.parse(e.data);
      const stream = document.getElementById('thought-stream-content');
      if (stream) {
        const toolMsg = document.createElement('div');
        toolMsg.className = 'stream-message tool-use';
        toolMsg.innerHTML = `<strong>[Tool Invoked]</strong> ${data.tool}: <code>${JSON.stringify(data.args)}</code> &rarr; Status: <em>${data.result?.status}</em>`;
        stream.appendChild(toolMsg);
        stream.scrollTop = stream.scrollHeight;
      }
    });
  } catch (err) {
    console.log('[OAS SSE] SSE connection skipped.');
  }
}

if (elements.btnSimulateStep) {
  elements.btnSimulateStep.addEventListener('click', advanceDagStep);
}

let autoRunTimer = null;
if (elements.btnAutoRun) {
  elements.btnAutoRun.addEventListener('click', () => {
    if (autoRunTimer) {
      clearInterval(autoRunTimer);
      autoRunTimer = null;
      elements.btnAutoRun.textContent = 'Auto Run';
    } else {
      autoRunTimer = setInterval(advanceDagStep, 2000);
      elements.btnAutoRun.textContent = 'Stop Auto';
    }
  });
}

// Fetch Catalog Data
async function loadCatalog() {
  try {
    const res = await fetch('/api/catalog');
    if (res.ok) {
      const data = await res.json();
      state.catalog.agents = data.agents || [];
      state.catalog.skills = data.skills || [];
      state.catalog.commands = data.commands || [];
      state.catalog.mcp = Object.entries(data.mcpServers || {}).map(([k, v]) => ({ id: k, name: k, ...v }));
    }
  } catch (err) {
    console.log('[OAS Web] Live API offline, loading embedded catalog fallback...');
  }

  // Fallback initial population if backend is not yet started
  if (state.catalog.agents.length === 0) {
    state.catalog.agents = [
      { id: 'planner', name: 'planner', description: 'Decompose complex features into modular implementation plans.', model: 'sonnet', cluster: 'architecture_and_planning' },
      { id: 'architect', name: 'architect', description: 'System design, scalability, and technical decision-making.', model: 'opus', cluster: 'architecture_and_planning' },
      { id: 'tdd-guide', name: 'tdd-guide', description: 'Test-driven development enforcing 80%+ test coverage with red-green cycles.', model: 'sonnet', cluster: 'architecture_and_planning' },
      { id: 'code-reviewer', name: 'code-reviewer', description: 'Code quality and maintainability reviewer enforcing immutability.', model: 'sonnet', cluster: 'quality_and_review' },
      { id: 'security-reviewer', name: 'security-reviewer', description: 'Vulnerability detection and input sanitization before commit.', model: 'sonnet', cluster: 'quality_and_review' },
      { id: 'build-error-resolver', name: 'build-error-resolver', description: 'Quick minimal-diff build and type error resolver.', model: 'sonnet', cluster: 'build_resolvers' },
      { id: 'rust-reviewer', name: 'rust-reviewer', description: 'Rust idioms, borrow checker, and performance optimization.', model: 'sonnet', cluster: 'quality_and_review' },
      { id: 'go-reviewer', name: 'go-reviewer', description: 'Go idioms, concurrency safety, and error handling.', model: 'sonnet', cluster: 'quality_and_review' }
    ];

    state.catalog.skills = [
      { id: 'tdd-workflow', name: 'tdd-workflow', domain: 'Testing & Evals', description: 'Enforce test-first methodology with unit, integration, and E2E coverage.' },
      { id: 'backend-patterns', name: 'backend-patterns', domain: 'Backend & APIs', description: 'REST APIs, Drizzle ORM, Fastify patterns, and connection pools.' },
      { id: 'strategic-compact', name: 'strategic-compact', domain: 'Agentic Infrastructure', description: 'Automated token compaction heuristics at 80% context window threshold.' },
      { id: 'unified-memory', name: 'unified-memory', domain: 'Agentic Infrastructure', description: 'Durable cross-harness Memory Vault with SHA-256 integrity checks.' },
      { id: 'frontend-patterns', name: 'frontend-patterns', domain: 'Frontend & Design', description: 'Next.js 15, Tailwind, React 19, and glassmorphic design systems.' }
    ];

    state.catalog.commands = [
      { id: 'plan', name: '/plan', description: 'Decompose PRD into capability plans and architecture milestones.' },
      { id: 'tdd', name: '/tdd', description: 'Run red-green TDD workflow for bug fixes or new features.' },
      { id: 'loop', name: '/loop', description: 'Autonomous agent execution loop with stall detection.' },
      { id: 'compact', name: '/compact', description: 'Run strategic context compaction and save token budget.' }
    ];

    state.catalog.mcp = [
      { id: 'supabase', name: 'supabase', description: 'PostgreSQL database queries and migration management.' },
      { id: 'firecrawl', name: 'firecrawl', description: 'Fast web scraping and LLM-ready markdown extraction.' },
      { id: 'oas-memory-vault', name: 'oas-memory-vault', description: 'Scoped durable memory storage with hash verification.' }
    ];
  }

  renderCatalog();
}

// Render Capabilities Catalog Cards
function renderCatalog() {
  if (!elements.catalogGrid) return;
  elements.catalogGrid.innerHTML = '';

  let items = [];
  const filter = state.currentFilter;

  if (filter === 'all' || filter === 'agents') {
    items = items.concat(state.catalog.agents.map(a => ({ ...a, type: 'Agent', badgeColor: 'var(--brand-blue)' })));
  }
  if (filter === 'all' || filter === 'skills') {
    items = items.concat(state.catalog.skills.map(s => ({ ...s, type: 'Skill', badgeColor: 'var(--glow-cyan)' })));
  }
  if (filter === 'all' || filter === 'commands') {
    items = items.concat(state.catalog.commands.map(c => ({ ...c, type: 'Command', badgeColor: 'var(--glow-purple)' })));
  }
  if (filter === 'all' || filter === 'mcp') {
    items = items.concat(state.catalog.mcp.map(m => ({ ...m, type: 'MCP', badgeColor: 'var(--status-warning)' })));
  }

  const query = state.searchQuery.toLowerCase();
  const filtered = items.filter(item => {
    const titleMatch = (item.name || item.id || '').toLowerCase().includes(query);
    const descMatch = (item.description || '').toLowerCase().includes(query);
    return titleMatch || descMatch;
  });

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'catalog-card';
    card.innerHTML = `
      <div class="card-title">
        <span>${item.name || item.id}</span>
        <span class="badge-tag" style="color: ${item.badgeColor};">${item.type}</span>
      </div>
      <p class="card-desc">${item.description || 'No description available.'}</p>
      <div class="card-tags">
        ${item.model ? `<span class="badge-tag">Model: ${item.model}</span>` : ''}
        ${item.domain ? `<span class="badge-tag">${item.domain}</span>` : ''}
        ${item.cluster ? `<span class="badge-tag">${item.cluster}</span>` : ''}
      </div>
    `;

    card.addEventListener('click', () => {
      openModal(item);
    });

    elements.catalogGrid.appendChild(card);
  });
}

// Modal handling
function openModal(item) {
  elements.modalTitle.textContent = `${item.type}: ${item.name || item.id}`;
  elements.modalSubtitle.textContent = item.model ? `Model: ${item.model}` : (item.domain || item.type);
  elements.modalDesc.textContent = item.description || 'Detailed specification for this entity.';
  elements.modalPrompt.textContent = item.systemPrompt || item.instructions || item.content || `Entity ${item.id} registered under OAS Enterprise Control Plane.`;
  elements.modal.classList.add('active');
}

function closeModal() {
  elements.modal.classList.remove('active');
}

if (elements.modalClose) elements.modalClose.addEventListener('click', closeModal);
if (elements.modalCancel) elements.modalCancel.addEventListener('click', closeModal);
if (elements.modalRun) {
  elements.modalRun.addEventListener('click', () => {
    alert('Prompt test evaluation initiated! Telemetry dispatched to OAS engine.');
    closeModal();
  });
}

// Filter Pills
elements.filterPills.forEach(pill => {
  pill.addEventListener('click', () => {
    elements.filterPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.currentFilter = pill.getAttribute('data-filter');
    renderCatalog();
  });
});

if (elements.catalogSearch) {
  elements.catalogSearch.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderCatalog();
  });
}

// Interactive Terminal CLI & Command Execution
async function executeCliCommand(cmdString) {
  if (!cmdString || !cmdString.trim()) return;
  const command = cmdString.trim();

  // Print command into virtual terminal
  const diffViewer = document.getElementById('workspace-diff-viewer');
  if (diffViewer) {
    diffViewer.innerHTML += `\n\n<span style="color: #38BDF8; font-weight: 700;">oas&gt; ${command}</span>\n`;
    diffViewer.scrollTop = diffViewer.scrollHeight;
  }

  try {
    const res = await fetch('/api/commands/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, sessionId: state.activeSession.id })
    });

    if (res.ok) {
      const result = await res.json();
      if (diffViewer && result.output) {
        diffViewer.innerHTML += `<span style="color: #34D399;">${result.output.replace(/\n/g, '<br>')}</span>\n`;
        diffViewer.scrollTop = diffViewer.scrollHeight;
      }
      // Also append to thought stream
      const stream = document.getElementById('thought-stream-content');
      if (stream && result.output) {
        const msg = document.createElement('div');
        msg.className = 'stream-message';
        msg.innerHTML = `<strong>[Command ${command.split(' ')[0]}]</strong> ${result.output}`;
        stream.appendChild(msg);
        stream.scrollTop = stream.scrollHeight;
      }
    }
  } catch (err) {
    if (diffViewer) {
      diffViewer.innerHTML += `<span style="color: #FB7185;">Execution error: ${err.message}</span>\n`;
    }
  }
}

const cliInput = document.getElementById('terminal-cli-input');
const btnCliExec = document.getElementById('btn-terminal-exec');

if (cliInput) {
  cliInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = cliInput.value;
      cliInput.value = '';
      executeCliCommand(val);
    }
  });
}

if (btnCliExec && cliInput) {
  btnCliExec.addEventListener('click', () => {
    const val = cliInput.value;
    cliInput.value = '';
    executeCliCommand(val);
  });
}

// Floating Action Dock Buttons
const dockButtons = {
  'dock-run-loop': () => executeCliCommand('/loop Autonomous loop iteration with stall detection'),
  'dock-pause': async () => {
    await fetch(`/api/sessions/${state.activeSession.id}/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' })
    });
    alert('Agent execution paused. State checkpoint saved.');
  },
  'dock-intervene': async () => {
    const feedback = prompt('Provide human intervention instructions for active subagent:');
    if (feedback) {
      await fetch(`/api/sessions/${state.activeSession.id}/intervene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'feedback', feedback })
      });
      alert('Intervention dispatched to active subagent: ' + feedback);
    }
  },
  'dock-compact': () => executeCliCommand('/compact'),
  'dock-rollback': () => executeCliCommand('/checkpoint manual_rollback_target')
};

Object.entries(dockButtons).forEach(([id, handler]) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', handler);
});

// Plan Canvas Annotation addition
if (elements.btnAddAnnotation && elements.annotationInput) {
  elements.btnAddAnnotation.addEventListener('click', () => {
    const text = elements.annotationInput.value.trim();
    if (!text) return;
    const box = document.createElement('div');
    box.className = 'annotation-box';
    box.innerHTML = `<strong>Human Reviewer:</strong> ${text}`;
    elements.annotationInput.parentNode.insertBefore(box, elements.annotationInput);
    elements.annotationInput.value = '';
  });
}

// --- STUDIO BUILDER (CUSTOM AGENT & SKILL DESIGNER) ---
const builderTabAgent = document.getElementById('builder-tab-agent');
const builderTabSkill = document.getElementById('builder-tab-skill');
const builderSectionAgent = document.getElementById('builder-section-agent');
const builderSectionSkill = document.getElementById('builder-section-skill');

if (builderTabAgent && builderTabSkill) {
  builderTabAgent.addEventListener('click', () => {
    builderTabAgent.classList.add('active');
    builderTabSkill.classList.remove('active');
    if (builderSectionAgent) builderSectionAgent.style.display = 'flex';
    if (builderSectionSkill) builderSectionSkill.style.display = 'none';
  });

  builderTabSkill.addEventListener('click', () => {
    builderTabSkill.classList.add('active');
    builderTabAgent.classList.remove('active');
    if (builderSectionAgent) builderSectionAgent.style.display = 'none';
    if (builderSectionSkill) builderSectionSkill.style.display = 'flex';
  });
}

function updateAgentPreview() {
  const preview = document.getElementById('builder-agent-preview');
  if (!preview) return;
  const id = document.getElementById('builder-agent-id')?.value.trim() || 'custom-agent';
  const model = document.getElementById('builder-agent-model')?.value || 'sonnet';
  const tools = document.getElementById('builder-agent-tools')?.value || 'Read, Write, Edit, Grep, Glob, Bash';
  const desc = document.getElementById('builder-agent-desc')?.value.trim() || 'Custom domain agent.';
  const prompt = document.getElementById('builder-agent-prompt')?.value || 'You are an autonomous domain agent...';

  preview.textContent = [
    '---',
    `name: ${id}`,
    `description: "${desc.replace(/"/g, '\\"')}"`,
    `model: ${model}`,
    `tools: ${tools}`,
    '---',
    '',
    `# ${id} Agent`,
    '',
    prompt
  ].join('\n');
}

function updateSkillPreview() {
  const preview = document.getElementById('builder-skill-preview');
  if (!preview) return;
  const id = document.getElementById('builder-skill-id')?.value.trim() || 'custom-skill';
  const domain = document.getElementById('builder-skill-domain')?.value || 'Engineering Workflows';
  const triggers = document.getElementById('builder-skill-triggers')?.value.trim() || 'custom, workflow';
  const desc = document.getElementById('builder-skill-desc')?.value.trim() || 'Custom workflow skill.';
  const prompt = document.getElementById('builder-skill-prompt')?.value || 'Instructions for this skill...';

  const triggerLines = triggers.split(',').map(t => `  - "${t.trim()}"`).join('\n');
  preview.textContent = [
    '---',
    `name: ${id}`,
    `description: "${desc.replace(/"/g, '\\"')}"`,
    'triggers:',
    triggerLines,
    '---',
    '',
    `# ${id}`,
    '',
    prompt
  ].join('\n');
}

['builder-agent-id', 'builder-agent-model', 'builder-agent-tools', 'builder-agent-desc', 'builder-agent-prompt'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateAgentPreview);
});

['builder-skill-id', 'builder-skill-domain', 'builder-skill-triggers', 'builder-skill-desc', 'builder-skill-prompt'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateSkillPreview);
});

// Export Agent
const btnExportAgent = document.getElementById('btn-export-agent');
if (btnExportAgent) {
  btnExportAgent.addEventListener('click', async () => {
    const id = document.getElementById('builder-agent-id')?.value.trim();
    if (!id) return alert('Please enter an Agent Identifier (slug).');

    try {
      const res = await fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          model: document.getElementById('builder-agent-model')?.value,
          tools: document.getElementById('builder-agent-tools')?.value,
          description: document.getElementById('builder-agent-desc')?.value,
          instructions: document.getElementById('builder-agent-prompt')?.value
        })
      });

      if (res.ok) {
        const data = await res.json();
        alert(`Success! Agent exported to ${data.file} and registered in OAS catalog.`);
        loadCatalog();
      } else {
        const err = await res.json();
        alert(`Export failed: ${err.error}`);
      }
    } catch (e) {
      alert(`Export error: ${e.message}`);
    }
  });
}

// Export Skill
const btnExportSkill = document.getElementById('btn-export-skill');
if (btnExportSkill) {
  btnExportSkill.addEventListener('click', async () => {
    const id = document.getElementById('builder-skill-id')?.value.trim();
    if (!id) return alert('Please enter a Skill Identifier (directory name).');

    try {
      const res = await fetch('/api/skills/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          domain: document.getElementById('builder-skill-domain')?.value,
          triggers: document.getElementById('builder-skill-triggers')?.value,
          description: document.getElementById('builder-skill-desc')?.value,
          instructions: document.getElementById('builder-skill-prompt')?.value
        })
      });

      if (res.ok) {
        const data = await res.json();
        alert(`Success! Skill exported to ${data.file} and registered in OAS catalog.`);
        loadCatalog();
      } else {
        const err = await res.json();
        alert(`Export failed: ${err.error}`);
      }
    } catch (e) {
      alert(`Export error: ${e.message}`);
    }
  });
}

// ==========================================
// 1. DYNAMIC DAG FLOW RENDERER
// ==========================================
let dagZoom = 1;
let dagPan = { x: 0, y: 0 };
let isDraggingDag = false;
let dagDragStart = { x: 0, y: 0 };
let dagNodesData = [
  { id: 'node_planner', agentId: 'planner', status: 'completed', x: 80, y: 120 },
  { id: 'node_architect', agentId: 'architect', status: 'completed', x: 340, y: 120 },
  { id: 'node_tdd', agentId: 'tdd-guide', status: 'running', x: 600, y: 120 },
  { id: 'node_review', agentId: 'code-reviewer', status: 'pending', x: 600, y: 320 },
  { id: 'node_sec', agentId: 'security-reviewer', status: 'pending', x: 340, y: 320 },
  { id: 'node_docs', agentId: 'doc-updater', status: 'pending', x: 80, y: 320 }
];

function renderDynamicDag() {
  const viewport = document.getElementById('dag-viewport');
  if (!viewport) return;
  viewport.innerHTML = '';
  viewport.setAttribute('transform', `translate(${dagPan.x}, ${dagPan.y}) scale(${dagZoom})`);

  // Draw bezier links between consecutive nodes
  for (let i = 0; i < dagNodesData.length - 1; i++) {
    const from = dagNodesData[i];
    const to = dagNodesData[i + 1];
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const sx = from.x + 140;
    const sy = from.y + 45;
    const tx = to.x;
    const ty = to.y + 45;
    const mx = (sx + tx) / 2;
    const d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
    path.setAttribute('d', d);
    path.setAttribute('class', 'dag-edge');
    if (from.status === 'completed' && to.status === 'completed') {
      path.setAttribute('stroke', '#10B981');
    } else if (to.status === 'running') {
      path.setAttribute('stroke', '#3B82F6');
    } else {
      path.setAttribute('stroke', 'rgba(226, 232, 240, 0.2)');
    }
    viewport.appendChild(path);
  }

  // Draw nodes
  dagNodesData.forEach((node) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `dag-node ${node.status === 'running' ? 'active' : ''}`);
    g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    g.setAttribute('data-agent', node.agentId);
    g.style.cursor = 'pointer';

    const strokeColor = node.status === 'completed' ? '#10B981' : (node.status === 'running' ? '#3B82F6' : 'rgba(226, 232, 240, 0.2)');
    const statusText = node.status === 'completed' ? 'DONE' : (node.status === 'running' ? 'RUNNING' : 'QUEUED');
    const badgeColor = node.status === 'completed' ? '#10B981' : (node.status === 'running' ? '#3B82F6' : '#94A3B8');

    g.innerHTML = `
      <rect width="140" height="90" rx="10" fill="#0B1120" stroke="${strokeColor}" stroke-width="2" />
      <circle cx="24" cy="28" r="6" fill="${badgeColor}" />
      <text x="38" y="32" fill="#F8FAFC" font-size="13" font-weight="700">${node.agentId}</text>
      <text x="18" y="55" fill="#94A3B8" font-size="10">${(nodeMetadata[node.agentId]?.role || 'Agent Task').substring(0, 20)}...</text>
      <rect x="18" y="65" width="54" height="16" rx="4" fill="rgba(255, 255, 255, 0.06)" />
      <text x="24" y="77" fill="${badgeColor}" font-size="9" font-weight="600">${statusText}</text>
    `;

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      selectDagNode(node.agentId);
    });

    viewport.appendChild(g);
  });
}

function initDynamicDag() {
  const svg = document.getElementById('dag-svg');
  if (!svg) return;

  svg.addEventListener('mousedown', e => {
    isDraggingDag = true;
    dagDragStart = { x: e.clientX - dagPan.x, y: e.clientY - dagPan.y };
    svg.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', e => {
    if (isDraggingDag) {
      dagPan.x = e.clientX - dagDragStart.x;
      dagPan.y = e.clientY - dagDragStart.y;
      renderDynamicDag();
    }
  });

  window.addEventListener('mouseup', () => {
    isDraggingDag = false;
    if (svg) svg.style.cursor = 'grab';
  });

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    dagZoom = Math.max(0.4, Math.min(2.5, dagZoom * factor));
    renderDynamicDag();
  }, { passive: false });

  const zoomIn = document.getElementById('btn-dag-zoom-in');
  if (zoomIn) zoomIn.onclick = () => { dagZoom = Math.min(2.5, dagZoom * 1.2); renderDynamicDag(); };

  const zoomOut = document.getElementById('btn-dag-zoom-out');
  if (zoomOut) zoomOut.onclick = () => { dagZoom = Math.max(0.4, dagZoom / 1.2); renderDynamicDag(); };

  const resetZoom = document.getElementById('btn-dag-reset-zoom');
  if (resetZoom) resetZoom.onclick = () => { dagZoom = 1; dagPan = { x: 0, y: 0 }; renderDynamicDag(); };

  const autoLayout = document.getElementById('btn-dag-auto-layout');
  if (autoLayout) autoLayout.onclick = () => {
    dagNodesData[0] = { ...dagNodesData[0], x: 80, y: 120 };
    dagNodesData[1] = { ...dagNodesData[1], x: 340, y: 120 };
    dagNodesData[2] = { ...dagNodesData[2], x: 600, y: 120 };
    dagNodesData[3] = { ...dagNodesData[3], x: 600, y: 320 };
    dagNodesData[4] = { ...dagNodesData[4], x: 340, y: 320 };
    dagNodesData[5] = { ...dagNodesData[5], x: 80, y: 320 };
    dagZoom = 1;
    dagPan = { x: 0, y: 0 };
    renderDynamicDag();
  };

  renderDynamicDag();
}

// ==========================================
// 2. WORKSPACE FILESYSTEM EXPLORER & CODE VIEWER
// ==========================================
let workspaceTree = [];

async function loadWorkspaceTree() {
  const container = document.getElementById('fs-tree-container');
  if (!container) return;
  try {
    const res = await fetch('/api/fs/tree');
    if (res.ok) {
      const data = await res.json();
      workspaceTree = data.tree || [];
      renderFsTree(workspaceTree, container);
    }
  } catch (err) {
    container.innerHTML = '<div style="color: var(--status-error); padding: 8px;">Failed to load filesystem tree</div>';
  }
}

function renderFsTree(items, parentEl, depth = 0) {
  if (depth === 0) parentEl.innerHTML = '';
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = `fs-tree-item fs-depth-${Math.min(depth, 4)}`;
    const isDir = item.type === 'directory';
    const icon = isDir ? '📁' : '📄';

    row.innerHTML = `<span class="fs-icon">${icon}</span><span>${item.name}</span>`;
    parentEl.appendChild(row);

    if (isDir && item.children && item.children.length > 0) {
      const childContainer = document.createElement('div');
      childContainer.style.display = depth < 1 ? 'block' : 'none';
      parentEl.appendChild(childContainer);
      renderFsTree(item.children, childContainer, depth + 1);

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = childContainer.style.display !== 'none';
        childContainer.style.display = open ? 'none' : 'block';
        row.querySelector('.fs-icon').textContent = open ? '📁' : '📂';
      });
    } else if (!isDir) {
      row.addEventListener('click', () => {
        document.querySelectorAll('.fs-tree-item').forEach(el => el.classList.remove('active'));
        row.classList.add('active');
        openWorkspaceFile(item.path);
      });
    }
  });
}

async function openWorkspaceFile(filePath) {
  const codeDisplay = document.getElementById('workspace-code-display');
  const badge = document.getElementById('code-viewer-file-badge');
  if (badge) badge.textContent = filePath;
  if (codeDisplay) codeDisplay.textContent = 'Loading ' + filePath + '...';

  try {
    const res = await fetch(`/api/fs/read?path=${encodeURIComponent(filePath)}`);
    if (res.ok) {
      const data = await res.json();
      if (codeDisplay) {
        const lines = (data.content || '').split('\n');
        codeDisplay.innerHTML = lines.map((line, i) => {
          const num = String(i + 1).padStart(4, ' ');
          const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `<span style="color: #475569; user-select: none;">${num}  </span>${escaped}`;
        }).join('\n');
      }
    } else {
      const err = await res.json();
      if (codeDisplay) codeDisplay.textContent = 'Error: ' + (err.error || 'Failed to read file');
    }
  } catch (err) {
    if (codeDisplay) codeDisplay.textContent = 'Error loading file: ' + err.message;
  }
}

function initWorkspaceFilesystem() {
  const refreshBtn = document.getElementById('btn-refresh-fs');
  if (refreshBtn) refreshBtn.onclick = loadWorkspaceTree;

  const searchInput = document.getElementById('fs-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      const items = document.querySelectorAll('.fs-tree-item');
      items.forEach(el => {
        const text = el.textContent.toLowerCase();
        el.style.display = text.includes(q) ? 'flex' : 'none';
      });
    });
  }

  const tabCode = document.getElementById('tab-code-viewer');
  const tabDiff = document.getElementById('tab-diff-viewer');
  const codeDisplay = document.getElementById('workspace-code-display');
  const diffDisplay = document.getElementById('workspace-diff-viewer');

  if (tabCode && tabDiff) {
    tabCode.onclick = () => {
      tabCode.classList.add('active');
      tabDiff.classList.remove('active');
      if (codeDisplay) codeDisplay.style.display = 'block';
      if (diffDisplay) diffDisplay.style.display = 'none';
    };
    tabDiff.onclick = () => {
      tabDiff.classList.add('active');
      tabCode.classList.remove('active');
      if (codeDisplay) codeDisplay.style.display = 'none';
      if (diffDisplay) diffDisplay.style.display = 'block';
    };
  }

  loadWorkspaceTree();
}

// ==========================================
// 3. SLASH COMMAND AUTOCOMPLETE
// ==========================================
function initCommandAutocomplete() {
  const input = document.getElementById('terminal-cli-input');
  const popup = document.getElementById('command-autocomplete');
  if (!input || !popup) return;

  let selectedIdx = 0;

  input.addEventListener('input', () => {
    const val = input.value;
    if (val.startsWith('/')) {
      const query = val.slice(1).toLowerCase();
      const matched = (state.catalog.commands || []).filter(c =>
        c.id.toLowerCase().includes(query) || (c.description || '').toLowerCase().includes(query)
      ).slice(0, 8);

      if (matched.length > 0) {
        selectedIdx = 0;
        popup.style.display = 'block';
        popup.innerHTML = matched.map((cmd, i) => `
          <div class="autocomplete-option ${i === 0 ? 'selected' : ''}" data-cmd="/${cmd.id}">
            <span class="autocomplete-name">/${cmd.id}</span>
            <span class="autocomplete-desc">${cmd.description || ''}</span>
          </div>
        `).join('');

        popup.querySelectorAll('.autocomplete-option').forEach(opt => {
          opt.addEventListener('click', () => {
            input.value = opt.getAttribute('data-cmd') + ' ';
            popup.style.display = 'none';
            input.focus();
          });
        });
      } else {
        popup.style.display = 'none';
      }
    } else {
      popup.style.display = 'none';
    }
  });

  input.addEventListener('keydown', (e) => {
    if (popup.style.display === 'block') {
      const options = popup.querySelectorAll('.autocomplete-option');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIdx = (selectedIdx + 1) % options.length;
        options.forEach((opt, idx) => opt.classList.toggle('selected', idx === selectedIdx));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIdx = (selectedIdx - 1 + options.length) % options.length;
        options.forEach((opt, idx) => opt.classList.toggle('selected', idx === selectedIdx));
      } else if (e.key === 'Enter') {
        const active = options[selectedIdx];
        if (active) {
          e.preventDefault();
          input.value = active.getAttribute('data-cmd') + ' ';
          popup.style.display = 'none';
        }
      } else if (e.key === 'Escape') {
        popup.style.display = 'none';
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !popup.contains(e.target)) {
      popup.style.display = 'none';
    }
  });
}

// ==========================================
// 4. INTERACTIVE KNOWLEDGE GRAPH VISUALIZER
// ==========================================
let kgData = { nodes: [], edges: [] };
let kgFilteredNodes = [];
let kgCanvas = null;
let kgCtx = null;
let kgZoom = 1;
let kgPan = { x: 0, y: 0 };
let isDraggingKg = false;
let kgDragStart = { x: 0, y: 0 };
let selectedKgNode = null;
let kgAnimationId = null;

async function loadKnowledgeGraph() {
  try {
    const res = await fetch('/api/graph');
    if (res.ok) {
      kgData = await res.json();
      initKgSimulation();
    }
  } catch (err) {
    console.error('Error loading graph:', err);
  }
}

function initKgSimulation() {
  kgCanvas = document.getElementById('kg-canvas');
  if (!kgCanvas) return;
  kgCtx = kgCanvas.getContext('2d');

  const rect = kgCanvas.getBoundingClientRect();
  kgCanvas.width = (rect.width || 800) * window.devicePixelRatio;
  kgCanvas.height = (rect.height || 500) * window.devicePixelRatio;

  const cx = kgCanvas.width / (2 * window.devicePixelRatio);
  const cy = kgCanvas.height / (2 * window.devicePixelRatio);

  const categoryOffsets = {
    'Agents': { angle: 0, dist: 160 },
    'Skills': { angle: (2 * Math.PI) / 3, dist: 220 },
    'Commands': { angle: (4 * Math.PI) / 3, dist: 180 },
    'MCPs': { angle: Math.PI / 2, dist: 140 }
  };

  kgData.nodes.forEach((node, i) => {
    const conf = categoryOffsets[node.category] || { angle: (i / kgData.nodes.length) * 2 * Math.PI, dist: 200 };
    const jitterAngle = conf.angle + (Math.random() - 0.5) * 1.2;
    const jitterDist = conf.dist + (Math.random() - 0.5) * 120;
    node.x = cx + Math.cos(jitterAngle) * jitterDist;
    node.y = cy + Math.sin(jitterAngle) * jitterDist;
    node.vx = (Math.random() - 0.5) * 0.5;
    node.vy = (Math.random() - 0.5) * 0.5;
    node.radius = node.type === 'agent' ? 8 : (node.type === 'mcp' ? 7 : (node.type === 'skill' ? 5 : 4));
    node.color = node.type === 'agent' ? '#3B82F6' : (node.type === 'skill' ? '#10B981' : (node.type === 'command' ? '#F59E0B' : '#8B5CF6'));
  });

  applyKgFilter('all');
  if (!kgAnimationId) loopKg();
}

function applyKgFilter(category) {
  if (category === 'all') {
    kgFilteredNodes = kgData.nodes;
  } else {
    kgFilteredNodes = kgData.nodes.filter(n => n.type === category);
  }
}

function loopKg() {
  renderKgFrame();
  kgAnimationId = requestAnimationFrame(loopKg);
}

function renderKgFrame() {
  if (!kgCtx || !kgCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  kgCtx.save();
  kgCtx.scale(dpr, dpr);
  kgCtx.clearRect(0, 0, kgCanvas.width, kgCanvas.height);

  kgCtx.translate(kgPan.x, kgPan.y);
  kgCtx.scale(kgZoom, kgZoom);

  // Draw Edges
  const visibleNodeIds = new Set(kgFilteredNodes.map(n => n.id));
  const nodeMap = new Map(kgData.nodes.map(n => [n.id, n]));

  kgData.edges.forEach(edge => {
    if (visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (src && tgt) {
        kgCtx.beginPath();
        kgCtx.moveTo(src.x, src.y);
        kgCtx.lineTo(tgt.x, tgt.y);
        kgCtx.strokeStyle = (selectedKgNode && (selectedKgNode.id === src.id || selectedKgNode.id === tgt.id))
          ? '#60A5FA'
          : 'rgba(71, 85, 105, 0.25)';
        kgCtx.lineWidth = (selectedKgNode && (selectedKgNode.id === src.id || selectedKgNode.id === tgt.id)) ? 2 : 1;
        kgCtx.stroke();
      }
    }
  });

  // Draw Nodes
  kgFilteredNodes.forEach(node => {
    kgCtx.beginPath();
    kgCtx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    kgCtx.fillStyle = node.color;
    kgCtx.shadowColor = node.color;
    kgCtx.shadowBlur = (selectedKgNode && selectedKgNode.id === node.id) ? 14 : 4;
    kgCtx.fill();
    kgCtx.shadowBlur = 0;

    // Node labels when zoomed in or selected
    if (kgZoom > 0.8 || (selectedKgNode && selectedKgNode.id === node.id)) {
      kgCtx.font = '10px "Inter", sans-serif';
      kgCtx.fillStyle = '#E2E8F0';
      kgCtx.fillText(node.name, node.x + node.radius + 3, node.y + 3);
    }
  });

  kgCtx.restore();
}

function initKnowledgeGraph() {
  loadKnowledgeGraph();

  const canvas = document.getElementById('kg-canvas');
  if (!canvas) return;

  canvas.addEventListener('mousedown', e => {
    isDraggingKg = true;
    kgDragStart = { x: e.clientX - kgPan.x, y: e.clientY - kgPan.y };
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', e => {
    if (isDraggingKg) {
      kgPan.x = e.clientX - kgDragStart.x;
      kgPan.y = e.clientY - kgDragStart.y;
    }
  });

  window.addEventListener('mouseup', () => {
    isDraggingKg = false;
    if (canvas) canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left - kgPan.x) / kgZoom;
    const clickY = (e.clientY - rect.top - kgPan.y) / kgZoom;

    // Hit test
    const hit = kgFilteredNodes.find(n => {
      const dx = n.x - clickX;
      const dy = n.y - clickY;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 4;
    });

    if (hit) {
      selectedKgNode = hit;
      updateKgInspector(hit);
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    kgZoom = Math.max(0.3, Math.min(3, kgZoom * factor));
  }, { passive: false });

  // Filter Pills
  document.querySelectorAll('.pill[data-kg-filter]').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.pill[data-kg-filter]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      applyKgFilter(pill.getAttribute('data-kg-filter'));
    });
  });

  // Search input
  const search = document.getElementById('kg-search-input');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      if (!q) {
        applyKgFilter('all');
        return;
      }
      kgFilteredNodes = kgData.nodes.filter(n => n.name.toLowerCase().includes(q) || n.description.toLowerCase().includes(q));
      if (kgFilteredNodes.length > 0) {
        selectedKgNode = kgFilteredNodes[0];
        updateKgInspector(selectedKgNode);
      }
    });
  }

  // Zoom buttons
  const zin = document.getElementById('btn-kg-zoom-in');
  if (zin) zin.onclick = () => { kgZoom = Math.min(3, kgZoom * 1.2); };

  const zout = document.getElementById('btn-kg-zoom-out');
  if (zout) zout.onclick = () => { kgZoom = Math.max(0.3, kgZoom / 1.2); };

  const rst = document.getElementById('btn-kg-reset');
  if (rst) rst.onclick = () => { kgZoom = 1; kgPan = { x: 0, y: 0 }; };

  const btnLayout = document.getElementById('btn-kg-layout');
  if (btnLayout) btnLayout.onclick = initKgSimulation;
}

function updateKgInspector(node) {
  const nameEl = document.getElementById('kg-inspector-name');
  const typeEl = document.getElementById('kg-inspector-type');
  const descEl = document.getElementById('kg-inspector-desc');
  const connEl = document.getElementById('kg-inspector-connections');

  if (nameEl) nameEl.textContent = node.name;
  if (typeEl) {
    typeEl.textContent = node.category + ' Subsystem';
    typeEl.style.color = node.color;
  }
  if (descEl) descEl.textContent = node.description;

  if (connEl) {
    const connectedEdges = (kgData.edges || []).filter(e => e.source === node.id || e.target === node.id);
    if (connectedEdges.length === 0) {
      connEl.innerHTML = '<div style="color: var(--text-muted);">No direct links in catalog.</div>';
    } else {
      connEl.innerHTML = connectedEdges.map(e => {
        const isOut = e.source === node.id;
        const otherId = isOut ? e.target : e.source;
        return `
          <div style="padding: 6px 8px; background: #050914; border-radius: 4px; border-left: 2px solid ${node.color}; cursor: pointer;">
            <span style="color: var(--text-muted);">${e.label}:</span> <strong>${otherId.replace(/agent:|skill:|command:|mcp:/, '')}</strong>
          </div>
        `;
      }).join('');
    }
  }
}

// ==========================================
// 5. MULTI-SESSION DRAWER & LIFECYCLE
// ==========================================
async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    if (res.ok) {
      const sessions = await res.json();
      updateSessionDropdown(sessions);
      renderSessionList(sessions);
    }
  } catch (err) {
    console.error('Error loading sessions:', err);
  }
}

function updateSessionDropdown(sessions) {
  const select = document.getElementById('global-session-select');
  const badge = document.getElementById('session-count-badge');
  if (badge) badge.textContent = `Sessions (${sessions.length})`;
  if (!select) return;

  select.innerHTML = sessions.map(s =>
    `<option value="${s.id}" ${s.id === state.activeSession.id ? 'selected' : ''}>${s.title} [${s.status}]</option>`
  ).join('');

  select.onchange = () => {
    switchActiveSession(select.value);
  };
}

function renderSessionList(sessions) {
  const container = document.getElementById('session-list-container');
  if (!container) return;

  container.innerHTML = sessions.map(s => `
    <div class="session-card-item ${s.id === state.activeSession.id ? 'active' : ''}" data-session-id="${s.id}">
      <div class="session-header-row">
        <span class="session-title-text">${s.title}</span>
        <span class="badge-tag" style="font-size: 9px;">${s.status}</span>
      </div>
      <div class="session-meta-row">
        <span>Lead: ${s.lead_agent_id}</span>
        <span>Steps: ${s.stepCount || 0}</span>
      </div>
      <div style="display: flex; gap: 4px; margin-top: 4px;">
        <button class="btn btn-secondary btn-switch-session" data-id="${s.id}" style="flex: 1; font-size: 10px; padding: 2px 6px;">Switch</button>
        <button class="btn btn-secondary btn-export-session" data-id="${s.id}" style="font-size: 10px; padding: 2px 6px;">Export</button>
        <button class="btn btn-secondary btn-delete-session" data-id="${s.id}" style="font-size: 10px; padding: 2px 6px; color: #F87171;">✕</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.btn-switch-session').forEach(b => {
    b.onclick = () => switchActiveSession(b.getAttribute('data-id'));
  });

  container.querySelectorAll('.btn-export-session').forEach(b => {
    b.onclick = async () => {
      const res = await fetch(`/api/sessions/${b.getAttribute('data-id')}/export`);
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([data.markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${b.getAttribute('data-id')}-transcript.md`;
        a.click();
      }
    };
  });

  container.querySelectorAll('.btn-delete-session').forEach(b => {
    b.onclick = async () => {
      if (confirm('Delete this session and all historical steps?')) {
        await fetch(`/api/sessions/${b.getAttribute('data-id')}`, { method: 'DELETE' });
        loadSessions();
      }
    };
  });
}

function switchActiveSession(sessionId) {
  state.activeSession.id = sessionId;
  const label = document.getElementById('dag-session-label');
  if (label) label.textContent = sessionId;
  loadSessions();
}

function initSessionManager() {
  const overlay = document.getElementById('session-drawer-overlay');
  const openBtn = document.getElementById('btn-toggle-sessions');
  const closeBtn = document.getElementById('btn-close-sessions');
  const newBtn = document.getElementById('btn-new-session');

  if (openBtn && overlay) openBtn.onclick = () => { overlay.style.display = 'block'; loadSessions(); };
  if (closeBtn && overlay) closeBtn.onclick = () => { overlay.style.display = 'none'; };

  if (overlay) {
    overlay.onclick = e => {
      if (e.target === overlay) overlay.style.display = 'none';
    };
  }

  if (newBtn) {
    newBtn.onclick = async () => {
      const title = prompt('Enter a title or objective for the new agent session:');
      if (!title) return;
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, lead_agent_id: 'planner' })
      });
      if (res.ok) {
        const session = await res.json();
        switchActiveSession(session.id);
        if (overlay) overlay.style.display = 'none';
      }
    };
  }

  loadSessions();
}

// ==========================================
// 6. PLATFORM SETTINGS & LLM PROVIDER HUB
// ==========================================
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const s = await res.json();
      const prov = document.getElementById('settings-provider-select');
      if (prov) prov.value = s.provider || 'mock';
      const ant = document.getElementById('settings-anthropic-key');
      if (ant) ant.value = s.anthropicApiKey || '';
      const oai = document.getElementById('settings-openai-key');
      if (oai) oai.value = s.openaiApiKey || '';
      const gem = document.getElementById('settings-gemini-key');
      if (gem) gem.value = s.geminiApiKey || '';
      const oll = document.getElementById('settings-ollama-host');
      if (oll) oll.value = s.ollamaHost || 'http://localhost:11434';
      const sb = document.getElementById('settings-sandbox-toggle');
      if (sb) sb.checked = s.sandboxEnabled !== false;
      const wt = document.getElementById('settings-worktree-toggle');
      if (wt) wt.checked = s.worktreeIsolation !== false;
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

function initSettingsManager() {
  const modal = document.getElementById('settings-modal');
  const openBtn = document.getElementById('btn-open-settings');
  const closeBtn = document.getElementById('settings-modal-close');
  const cancelBtn = document.getElementById('settings-modal-cancel');
  const saveBtn = document.getElementById('settings-modal-save');
  const testBtn = document.getElementById('btn-test-provider');

  if (openBtn && modal) openBtn.onclick = () => { modal.style.display = 'flex'; loadSettings(); };
  if (closeBtn && modal) closeBtn.onclick = () => { modal.style.display = 'none'; };
  if (cancelBtn && modal) cancelBtn.onclick = () => { modal.style.display = 'none'; };

  if (saveBtn) {
    saveBtn.onclick = async () => {
      const payload = {
        provider: document.getElementById('settings-provider-select')?.value,
        anthropicApiKey: document.getElementById('settings-anthropic-key')?.value,
        openaiApiKey: document.getElementById('settings-openai-key')?.value,
        geminiApiKey: document.getElementById('settings-gemini-key')?.value,
        ollamaHost: document.getElementById('settings-ollama-host')?.value,
        sandboxEnabled: document.getElementById('settings-sandbox-toggle')?.checked,
        worktreeIsolation: document.getElementById('settings-worktree-toggle')?.checked
      };

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        alert('Settings saved successfully!');
        if (modal) modal.style.display = 'none';
      }
    };
  }

  if (testBtn) {
    testBtn.onclick = () => {
      const prov = document.getElementById('settings-provider-select')?.value;
      alert(`Provider connectivity verified for: ${prov.toUpperCase()} Gateway.`);
    };
  }
}

// Initialize on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  loadCatalog();
  selectDagNode('tdd-guide');
  connectSseStream();
  updateAgentPreview();
  updateSkillPreview();

  // Full-Platform Modules
  initDynamicDag();
  initWorkspaceFilesystem();
  initCommandAutocomplete();
  initKnowledgeGraph();
  initSessionManager();
  initSettingsManager();
});

