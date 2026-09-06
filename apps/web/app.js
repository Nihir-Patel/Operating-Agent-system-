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

// Floating Action Dock Buttons
const dockButtons = {
  'dock-run-loop': () => alert('Initiating continuous agent loop (/loop) with stall monitoring.'),
  'dock-pause': () => alert('Agent execution paused. State checkpoint saved.'),
  'dock-intervene': () => {
    const feedback = prompt('Provide human intervention instructions for active subagent:');
    if (feedback) alert('Intervention dispatched to active subagent queue: ' + feedback);
  },
  'dock-compact': () => alert('Strategic Context Compactor executed. 18,400 tokens reclaimed.'),
  'dock-rollback': () => alert('Rollback to previous checkpoint (/checkpoint) executed.')
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

// Initialize on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  loadCatalog();
  selectDagNode('tdd-guide');
  connectSseStream();
  updateAgentPreview();
  updateSkillPreview();
});
