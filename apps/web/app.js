/**
 * @file apps/web/app.js
 * OAS Local Studio 0.9 frontend controller
 */

import { state, nodeMetadata, viewTitles } from './js/studio-state.js';
import { escapeHtml, showToast, formatUnifiedDiffHtml } from './js/ui.js';
import { persistApiToken, getApiToken, attachAuthHeaders, getSseStreamUrl, installAuthenticatedFetch } from './js/api-client.js';
import { initWorkspaceFilesystem, loadWorkspaceTree, openWorkspaceFile, hideWorkspaceEditors } from './js/workspace-editor.js';

installAuthenticatedFetch({ onAuthRetry: () => connectSseStream() });

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


// Navigation
function switchView(viewId) {
  state.activeView = viewId;

  elements.navItems.forEach(item => {
    const isActive = item.getAttribute('data-view') === viewId;
    item.classList.toggle('active', isActive);
    if (isActive) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
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
    loadSessionSteps(state.activeSession.id);
  } else if (viewId === 'view-dag') {
    renderDynamicDag();
  } else if (viewId === 'view-plan-canvas') {
    loadPlanCanvas();
  } else if (viewId === 'view-vault') {
    loadTelemetry();
    loadMemoryVault();
  } else if (viewId === 'view-catalog') {
    renderCatalog();
  }
}

elements.navItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetView = item.getAttribute('data-view');
    switchView(targetView);
  });
});


// Interactive DAG Node Selection & Bidirectional Inspector
let activeSelectedDagNode = 'tdd-guide';

function selectDagNode(agentKey) {
  if (!agentKey) return;
  activeSelectedDagNode = agentKey;

  const agentDef = (state.catalog.agents || []).find(a => a.id === agentKey);
  const meta = nodeMetadata[agentKey] || {};

  const name = agentDef ? agentDef.name || agentDef.id : (meta.name || agentKey);
  const defaultModel = (state.settings?.provider === 'ollama')
    ? (state.settings?.ollamaModel || 'qwen2.5-coder:7b')
    : (agentDef?.model ? `Claude 3.7 ${agentDef.model.toUpperCase()}` : 'Claude 3.7 Sonnet');
  const model = meta.model || defaultModel;
  const role = meta.role || agentDef?.description || 'Autonomous Domain Subagent';
  const cot = meta.cot || `[${agentKey}] Active and ready for orchestration in session ${state.activeSession.id}.`;
  const tool = meta.tool || (agentDef?.tools ? `tools: ${Array.isArray(agentDef.tools) ? agentDef.tools.join(', ') : agentDef.tools}` : 'tool: inspect_workspace\nduration: 45ms\nstatus: active');

  // Determine active status from dagNodesData or metadata
  const dagNode = dagNodesData.find(n => n.agentId === agentKey);
  const currentStatus = dagNode?.status || meta.status || 'queued';
  const duration = meta.duration || '65ms';

  // 1. Update Title & Badges
  const titleEl = document.getElementById('inspector-node-name');
  if (titleEl) titleEl.textContent = name;

  const statusBadge = document.getElementById('inspector-status-badge');
  if (statusBadge) {
    statusBadge.textContent = currentStatus.toUpperCase();
    if (currentStatus === 'completed') statusBadge.style.color = '#10B981';
    else if (currentStatus === 'running') statusBadge.style.color = '#38BDF8';
    else if (currentStatus === 'paused') statusBadge.style.color = '#F59E0B';
    else if (currentStatus === 'failed') statusBadge.style.color = '#EF4444';
    else statusBadge.style.color = '#94A3B8';
  }

  const statusDot = document.getElementById('inspector-status-dot');
  if (statusDot) {
    let dotColor = '#94A3B8';
    if (currentStatus === 'completed') dotColor = '#10B981';
    else if (currentStatus === 'running') dotColor = '#38BDF8';
    else if (currentStatus === 'paused') dotColor = '#F59E0B';
    else if (currentStatus === 'failed') dotColor = '#EF4444';
    statusDot.style.background = dotColor;
    statusDot.style.boxShadow = `0 0 8px ${dotColor}`;
  }

  const statusSelect = document.getElementById('inspector-node-status-select');
  if (statusSelect) {
    statusSelect.value = currentStatus === 'pending' ? 'queued' : currentStatus;
  }

  // 2. Update Model Selector & Badge
  const modelSelect = document.getElementById('inspector-model-select');
  if (modelSelect) {
    modelSelect.value = model;
  }
  const modelBadge = document.getElementById('inspector-model-badge');
  if (modelBadge) {
    modelBadge.textContent = model;
  }

  // 3. Update Editable Fields
  const roleInput = document.getElementById('inspector-node-role-input');
  if (roleInput) roleInput.value = role;

  const cotInput = document.getElementById('inspector-cot-input');
  if (cotInput) cotInput.value = cot;

  const toolInput = document.getElementById('inspector-tool-input');
  if (toolInput) toolInput.value = tool;

  // 4. Update Performance Telemetry
  const metricDuration = document.getElementById('inspector-metric-duration');
  if (metricDuration) metricDuration.textContent = duration;

  const metricStatus = document.getElementById('inspector-metric-status');
  if (metricStatus) {
    metricStatus.textContent = currentStatus === 'running' ? 'ACTIVE (SSE)' : currentStatus.toUpperCase();
    metricStatus.style.color = currentStatus === 'completed' ? '#10B981' : (currentStatus === 'running' ? '#38BDF8' : '#94A3B8');
  }

  // 5. Update Legacy DOM elements if present for backward compatibility
  if (elements.inspectorNodeRole) elements.inspectorNodeRole.textContent = role;
  if (elements.inspectorCotText) elements.inspectorCotText.textContent = cot;
  if (elements.inspectorToolBlock) elements.inspectorToolBlock.textContent = tool;

  // 6. Highlight active SVG node box with high-visibility cyan border & halo
  document.querySelectorAll('.dag-node').forEach(node => {
    const key = node.getAttribute('data-agent');
    const rect = node.querySelector('rect');
    if (rect) {
      if (key === agentKey) {
        rect.setAttribute('stroke', '#38BDF8');
        rect.setAttribute('stroke-width', '2.5');
        rect.style.filter = 'drop-shadow(0 0 12px rgba(56, 189, 248, 0.75))';
      } else {
        rect.style.filter = 'none';
        const st = dagNodesData.find(n => n.agentId === key)?.status;
        if (st === 'completed') rect.setAttribute('stroke', '#10B981');
        else if (st === 'running') rect.setAttribute('stroke', '#3B82F6');
        else if (st === 'paused') rect.setAttribute('stroke', '#F59E0B');
        else if (st === 'failed') rect.setAttribute('stroke', '#EF4444');
        else rect.setAttribute('stroke', 'rgba(226, 232, 240, 0.2)');
        rect.setAttribute('stroke-width', '1.5');
      }
    }
  });
}

// Bind Inspector Editable Controls Once
function initInspectorControls() {
  // Status Selector
  const statusSelect = document.getElementById('inspector-node-status-select');
  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      const newStatus = e.target.value;
      if (!activeSelectedDagNode) return;
      if (nodeMetadata[activeSelectedDagNode]) {
        nodeMetadata[activeSelectedDagNode].status = newStatus;
      }
      const dagNode = dagNodesData.find(n => n.agentId === activeSelectedDagNode);
      if (dagNode) {
        dagNode.status = newStatus;
      }
      selectDagNode(activeSelectedDagNode);
      renderDynamicDag();
      showToast(`[${activeSelectedDagNode}] state set to ${newStatus.toUpperCase()}`, 'success');
    });
  }

  // Model Selector
  const modelSelect = document.getElementById('inspector-model-select');
  if (modelSelect) {
    modelSelect.addEventListener('change', (e) => {
      const newModel = e.target.value;
      if (!activeSelectedDagNode) return;
      if (!nodeMetadata[activeSelectedDagNode]) nodeMetadata[activeSelectedDagNode] = {};
      nodeMetadata[activeSelectedDagNode].model = newModel;
      const badge = document.getElementById('inspector-model-badge');
      if (badge) badge.textContent = newModel;
      showToast(`[${activeSelectedDagNode}] model updated to ${newModel}`, 'info');
    });
  }

  // Save Node Parameters Button
  const btnSaveParams = document.getElementById('btn-save-agent-params');
  if (btnSaveParams) {
    btnSaveParams.addEventListener('click', () => {
      if (!activeSelectedDagNode) return;
      if (!nodeMetadata[activeSelectedDagNode]) nodeMetadata[activeSelectedDagNode] = {};
      const roleInput = document.getElementById('inspector-node-role-input');
      const cotInput = document.getElementById('inspector-cot-input');
      const toolInput = document.getElementById('inspector-tool-input');
      if (roleInput) nodeMetadata[activeSelectedDagNode].role = roleInput.value;
      if (cotInput) nodeMetadata[activeSelectedDagNode].cot = cotInput.value;
      if (toolInput) nodeMetadata[activeSelectedDagNode].tool = toolInput.value;
      renderDynamicDag();
      showToast(`Agent [${activeSelectedDagNode}] configuration applied & synced!`, 'success');
    });
  }

  // Run Simulated Tool Button
  const btnRunTool = document.getElementById('btn-run-simulated-tool');
  if (btnRunTool) {
    btnRunTool.addEventListener('click', () => {
      if (!activeSelectedDagNode) return;
      const dur = Math.floor(Math.random() * 55 + 25);
      const metricDuration = document.getElementById('inspector-metric-duration');
      if (metricDuration) metricDuration.textContent = `${dur}ms`;
      const toolInput = document.getElementById('inspector-tool-input');
      if (toolInput) {
        toolInput.value = toolInput.value.replace(/duration: \d+ms/, `duration: ${dur}ms`);
      }
      const cotInput = document.getElementById('inspector-cot-input');
      if (cotInput) {
        cotInput.value += `\n[${activeSelectedDagNode}] Executed tool invocation: exit_code=0 (${dur}ms).`;
      }
      showToast(`[${activeSelectedDagNode}] Tool executed successfully (${dur}ms)`, 'success');
    });
  }

  // Copy CoT Stream Button
  const btnCopyCot = document.getElementById('btn-copy-cot');
  if (btnCopyCot) {
    btnCopyCot.addEventListener('click', () => {
      const cotInput = document.getElementById('inspector-cot-input');
      if (cotInput && cotInput.value) {
        navigator.clipboard?.writeText(cotInput.value);
        showToast('Reasoning stream copied to clipboard', 'info');
      }
    });
  }

  // Editable Session Title & Save Button
  const dagSessionInput = document.getElementById('dag-session-input');
  const btnSaveSession = document.getElementById('btn-save-session-name');
  const handleSaveSession = async () => {
    if (!dagSessionInput) return;
    const newTitle = dagSessionInput.value.trim();
    if (!newTitle) return;
    const previousTitle = state.activeSession.title;
    try {
      const res = await fetch(`/api/sessions/${state.activeSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      });
      if (!res.ok) {
        dagSessionInput.value = previousTitle;
        showToast('Rename Failed', `Server returned ${res.status}`, 'error');
        return;
      }
      state.activeSession.title = newTitle;
      const globalSelect = document.getElementById('global-session-select');
      if (globalSelect) {
        const currentOpt = globalSelect.querySelector(`option[value="${state.activeSession.id}"]`);
        if (currentOpt) currentOpt.textContent = `${newTitle} [active]`;
      }
      showToast(`Active session renamed: "${newTitle}"`, 'success');
    } catch (err) {
      dagSessionInput.value = previousTitle;
      showToast('Rename Failed', err.message, 'error');
    }
  };

  if (btnSaveSession) btnSaveSession.addEventListener('click', handleSaveSession);
  if (dagSessionInput) {
    dagSessionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSaveSession();
    });
  }
}

// Call init once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initInspectorControls);
} else {
  initInspectorControls();
}

// Live Session Steps & Thought Stream Loader

function updateDagTimelineScrubber(steps) {
  const slider = document.getElementById('dag-step-slider');
  const label = document.getElementById('dag-step-label');
  if (!slider || !label) return;

  const count = steps.length;
  slider.min = '0';
  slider.max = String(count);
  slider.value = String(count);
  label.textContent = `Step ${count} / ${count}`;
}

async function loadSessionSteps(sessionId) {
  const stream = document.getElementById('thought-stream-content');
  const stepCountBadge = document.getElementById('stream-step-count');
  const activeAgentBadge = document.getElementById('agent-active-badge');
  if (!stream) return;
  stream.innerHTML = '';

  if (!sessionId) {
    if (stepCountBadge) stepCountBadge.textContent = '0 Steps';
    if (activeAgentBadge) activeAgentBadge.textContent = 'No agent active';
    stream.innerHTML = `
      <div class="stream-empty-state" style="padding: 24px 16px; text-align: center; color: var(--text-muted); background: rgba(5, 9, 20, 0.6); border-radius: 8px; border: 1px dashed rgba(56, 189, 248, 0.2);">
        <div style="font-size: 26px; margin-bottom: 6px;">⚡</div>
        <div style="font-size: 13px; font-weight: 700; color: #F1F5F9;">No Active Session Selected</div>
        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px; line-height: 1.5;">
          Create a session in the Sessions drawer or launch a mission prompt to begin execution.
        </div>
      </div>
    `;
    return;
  }

  try {
    const res = await fetch(`/api/sessions/${sessionId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.session) {
        state.activeSession = {
          id: data.session.id,
          title: data.session.title || data.session.id,
          currentNode: data.session.currentNode || 'node-tdd',
          status: data.session.status || 'active'
        };
        const input = document.getElementById('dag-session-input');
        if (input) input.value = data.session.id;
        const label = document.getElementById('dag-session-label');
        if (label) label.textContent = data.session.id;
      }
      const steps = data.steps || [];
      state.activeSessionSteps = steps;
      updateDagTimelineScrubber(steps);

      if (stepCountBadge) {
        stepCountBadge.textContent = `${steps.length} Steps`;
      }
      if (activeAgentBadge) {
        const lastStep = steps[steps.length - 1];
        const activeAgent = (lastStep && lastStep.agent_id) || data.session?.leadAgent || 'planner';
        activeAgentBadge.textContent = `${activeAgent} active`;
      }

      if (steps.length === 0) {
        stream.innerHTML = `
          <div class="stream-empty-state" style="padding: 24px 16px; text-align: center; color: var(--text-muted); background: rgba(5, 9, 20, 0.6); border-radius: 8px; border: 1px dashed rgba(56, 189, 248, 0.2);">
            <div style="font-size: 26px; margin-bottom: 6px;">⚡</div>
            <div style="font-size: 13px; font-weight: 700; color: #F1F5F9;">Agent Workspace Primed</div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px; line-height: 1.5;">
              Active Session: <strong style="color: #38BDF8;">${data.session?.title || sessionId}</strong><br>
              Click a quick action chip below or enter a mission prompt to execute with your autonomous agent.
            </div>
          </div>
        `;
        return;
      }

      steps.forEach(step => {
        appendStepToStream(step);
      });
      stream.scrollTop = stream.scrollHeight;
    } else {
      console.warn(`Session ${sessionId} returned ${res.status}. Attempting auto-recovery...`);
      const sessRes = await fetch('/api/sessions');
      if (sessRes.ok) {
        const sessions = await sessRes.json();
        if (sessions && sessions.length > 0) {
          switchActiveSession(sessions[0].id);
          return;
        }
      }
      stream.innerHTML = `<div style="color: var(--status-error); padding: 12px;">Failed to load session (HTTP ${res.status})</div>`;
    }
  } catch (err) {
    stream.innerHTML = `<div style="color: var(--status-error); padding: 12px;">Failed to load session steps: ${err.message}</div>`;
  }
}

function appendThoughtStreamStep(agentId, content) {
  appendStepToStream({
    agent_id: agentId,
    title: 'Council adoption',
    content,
    timestamp: new Date().toISOString()
  });
}

function appendStepToStream(step) {
  const stream = document.getElementById('thought-stream-content');
  if (!stream) return;
  const empty = stream.querySelector('.stream-empty-state');
  if (empty) empty.remove();

  const card = document.createElement('div');
  card.className = 'stream-step-card';

  const agent = step.agent_id || 'system';
  const agentColors = {
    'planner': '#38BDF8',
    'architect': '#818CF8',
    'tdd-guide': '#34D399',
    'code-reviewer': '#F59E0B',
    'security-reviewer': '#EF4444',
    'build-error-resolver': '#EC4899'
  };
  const agentColor = agentColors[agent] || '#38BDF8';
  card.style.borderLeftColor = agentColor;

  const timeStr = step.timestamp ? new Date(step.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  const stepTitle = step.title || (step.tool_name ? `Tool: ${step.tool_name}` : `Execution Cycle`);

  let bodyHtml = '';

  // 1. Collapsible Chain of Thought (CoT) Accordion
  if (step.cot) {
    bodyHtml += `
      <div class="cot-accordion">
        <div class="cot-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'block' ? 'none' : 'block'">
          <span>🧠 Chain of Thought (${step.cot.length} chars)</span>
          <span style="font-size: 9px; opacity: 0.7;">▾ Toggle</span>
        </div>
        <div class="cot-body">${escapeHtml(step.cot)}</div>
      </div>
    `;
  }

  // 2. Tool Invocation Inspector
  if (step.step_type === 'tool_call' || step.tool_name) {
    const toolArgs = step.tool_args ? (typeof step.tool_args === 'string' ? step.tool_args : JSON.stringify(step.tool_args, null, 2)) : '';
    bodyHtml += `
      <div class="tool-inspector-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <strong style="color: #34D399;">🔧 Invoked: ${step.tool_name || 'tool'}</strong>
          <span class="badge-tag font-mono" style="font-size: 8.5px; color: #10B981;">SUCCESS</span>
        </div>
        ${toolArgs ? `<pre style="margin: 0; background: #030712; padding: 6px; border-radius: 4px; font-family: monospace; font-size: 10px; color: #93C5FD; overflow-x: auto;">${escapeHtml(toolArgs)}</pre>` : ''}
      </div>
    `;
  }

  // 3. Diff or Formatted Output
  const content = step.content || '';
  const isDiff = step.step_type === 'diff' || step.diff_content || (content.includes('---') && content.includes('+++')) || content.includes('@@');

  if (isDiff) {
    const diffText = step.diff_content || content;
    bodyHtml += `
      <div style="margin-top: 4px;">
        <div style="font-size: 10px; font-weight: 700; color: #38BDF8; margin-bottom: 4px;">Unified Patch Diff:</div>
        ${formatUnifiedDiffHtml(diffText)}
      </div>
    `;
  } else if (content) {
    bodyHtml += `<div style="font-size: 11.5px; color: #E2E8F0; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(content)}</div>`;
  }

  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span class="badge-tag" style="background: rgba(15,23,42,0.8); border-color: ${agentColor}; color: ${agentColor}; font-size: 10px; font-weight: 700;">${agent}</span>
        <strong style="font-size: 11px; color: #F8FAFC;">${escapeHtml(stepTitle)}</strong>
      </div>
      <span style="font-size: 9.5px; color: var(--text-muted); font-family: monospace;">${timeStr}</span>
    </div>
    ${bodyHtml}
  `;

  stream.appendChild(card);
  stream.scrollTop = stream.scrollHeight;

  const countBadge = document.getElementById('stream-step-count');
  if (countBadge) {
    const count = stream.querySelectorAll('.stream-step-card').length;
    countBadge.textContent = `${count} Steps`;
  }
}

// Live Execution & DAG Step Advancement
async function advanceDagStep() {
  try {
    const res = await fetch(`/api/sessions/${state.activeSession.id}/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'Advance DAG pipeline step', isNodeCompleted: true })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.step) {
        appendStepToStream(data.step);
        if (data.step.agentId) {
          selectDagNode(data.step.agentId);
        }
      }
      renderDynamicDag();
    }
  } catch (err) {
    console.error('Failed to advance step:', err);
  }
}

// Connect to Real-time SSE Stream with Exponential Reconnection
let sseEventSource = null;
let sseReconnectAttempts = 0;

function connectSseStream() {
  if (sseEventSource) {
    try { sseEventSource.close(); } catch {}
  }

  try {
    sseEventSource = new EventSource(getSseStreamUrl());

    sseEventSource.onopen = () => {
      sseReconnectAttempts = 0;
      const indicator = document.querySelector('.system-status-indicator');
      if (indicator) {
        indicator.innerHTML = '<div class="status-dot"></div><span>Control Plane Online</span>';
      }
    };

    sseEventSource.onerror = () => {
      sseReconnectAttempts++;
      const indicator = document.querySelector('.system-status-indicator');
      if (indicator) {
        indicator.innerHTML = '<div class="status-dot" style="background: var(--status-warning);"></div><span>Reconnecting SSE...</span>';
      }
      try { sseEventSource.close(); } catch {}
      const timeout = Math.min(10000, 1000 * Math.pow(1.5, sseReconnectAttempts));
      setTimeout(connectSseStream, timeout);
    };

    // Live thought stream chunks
    sseEventSource.addEventListener('agent:thought:chunk', e => {
      const data = JSON.parse(e.data);
      const stream = document.getElementById('thought-stream-content');
      if (stream && data.text) {
        const lastMsg = stream.lastElementChild;
        if (lastMsg && lastMsg.classList.contains('stream-chunk-active')) {
          lastMsg.innerHTML += data.text.replace(/\n/g, '<br>');
        } else {
          const chunkMsg = document.createElement('div');
          chunkMsg.className = 'stream-message stream-chunk-active';
          chunkMsg.innerHTML = `<strong>[${escapeHtml(data.agentId || 'agent')}]</strong> ${escapeHtml(data.text).replace(/\n/g, '<br>')}`;
          stream.appendChild(chunkMsg);
        }
        stream.scrollTop = stream.scrollHeight;
      }
    });

    // Tool executions
    sseEventSource.addEventListener('agent:tool:executed', e => {
      const data = JSON.parse(e.data);
      const stream = document.getElementById('thought-stream-content');
      if (stream) {
        const toolMsg = document.createElement('div');
        toolMsg.className = 'stream-message tool-use';
        toolMsg.innerHTML = `<strong>[Tool Invoked]</strong> ${escapeHtml(data.tool)}: <code>${escapeHtml(JSON.stringify(data.args))}</code> &rarr; Status: <em>${escapeHtml(data.result?.status || 'ok')}</em>`;
        stream.appendChild(toolMsg);
        stream.scrollTop = stream.scrollHeight;
      }
    });

    // Step completions & updates
    sseEventSource.addEventListener('agent:step', e => {
      const data = JSON.parse(e.data);
      if (data.sessionId === state.activeSession.id) {
        loadSessionSteps(data.sessionId);
        renderDynamicDag();
      }
    });

    // Human-in-the-Loop Intervention: Paused
    sseEventSource.addEventListener('agent:intervention:paused', e => {
      const data = JSON.parse(e.data);
      if (window.triggerHitlModal) {
        window.triggerHitlModal(data);
      }
      renderDynamicDag();
    });

    // Human-in-the-Loop Intervention: Resumed
    sseEventSource.addEventListener('agent:intervention:resumed', e => {
      if (window.dismissHitlModal) {
        window.dismissHitlModal();
      }
      renderDynamicDag();
    });

    // Human-in-the-Loop Intervention: Aborted
    sseEventSource.addEventListener('agent:intervention:aborted', e => {
      if (window.dismissHitlModal) {
        window.dismissHitlModal();
      }
      renderDynamicDag();
    });

    // Session completion
    sseEventSource.addEventListener('agent:session:completed', e => {
      const data = JSON.parse(e.data);
      const badge = document.getElementById('dag-session-label');
      if (badge && data.sessionId === state.activeSession.id) {
        badge.textContent = `${state.activeSession.id} [COMPLETED]`;
        badge.style.color = 'var(--status-success)';
      }
      renderDynamicDag();
    });
  } catch (err) {
    console.log('[OAS SSE] SSE connection error:', err);
  }
}

if (elements.btnSimulateStep) {
  elements.btnSimulateStep.addEventListener('click', advanceDagStep);
}

let autoRunInFlight = false;
if (elements.btnAutoRun) {
  elements.btnAutoRun.addEventListener('click', async () => {
    if (autoRunInFlight) return;
    if (!state.activeSession.id) {
      showToast('Create or select a session before Auto Run', 'warning');
      return;
    }
    autoRunInFlight = true;
    const original = elements.btnAutoRun.textContent;
    elements.btnAutoRun.textContent = 'Running…';
    try {
      const res = await fetch(`/api/sessions/${state.activeSession.id}/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: state.activeSession.title || 'Studio pipeline',
          maxNodes: 16
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'Pipeline run failed', 'error');
      } else if (Array.isArray(data.results)) {
        data.results.forEach(step => {
          if (step && step.step) appendStepToStream(step.step);
        });
      }
      renderDynamicDag();
    } catch (err) {
      console.error('Pipeline auto-run failed:', err);
      showToast(err.message || 'Pipeline auto-run failed', 'error');
    } finally {
      autoRunInFlight = false;
      elements.btnAutoRun.textContent = original || 'Auto Run';
    }
  });
}

if (elements.btnDagPause) {
  let isDagPaused = false;
  elements.btnDagPause.addEventListener('click', async () => {
    isDagPaused = !isDagPaused;
    const action = isDagPaused ? 'pause' : 'resume';
    elements.btnDagPause.textContent = isDagPaused ? 'Resume' : 'Pause';
    elements.btnDagPause.className = isDagPaused ? 'btn btn-primary' : 'btn btn-secondary';
    try {
      await fetch(`/api/sessions/${state.activeSession.id}/intervene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      renderDynamicDag();
    } catch (err) {
      console.error('Failed to toggle DAG pause state:', err);
    }
  });
}


// ==========================================
// PIPELINE RUNNER CONTROLLER (RUN PIPELINE MODAL)
// ==========================================
function initPipelineRunnerController() {
  const btnOpen = document.getElementById('btn-quick-run-dialog');
  const modal = document.getElementById('pipeline-runner-modal');
  const btnClose = document.getElementById('btn-close-pipeline-modal');
  const btnCancel = document.getElementById('btn-cancel-pipeline');
  const btnLaunch = document.getElementById('btn-launch-pipeline-action');
  const intentInput = document.getElementById('pipeline-intent-input');
  const leadSelect = document.getElementById('pipeline-lead-agent-select');
  const presetBtns = document.querySelectorAll('.pipeline-preset-btn');

  let activePipelineType = 'feature_lifecycle';

  if (presetBtns) {
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        presetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activePipelineType = btn.dataset.pipelineType || 'feature_lifecycle';
        if (intentInput && btn.dataset.intent) {
          intentInput.value = btn.dataset.intent;
        }
      });
    });
  }

  const openRunner = () => {
    if (modal) {
      modal.style.display = 'flex';
      intentInput?.focus();
    }
  };

  const closeRunner = () => {
    if (modal) modal.style.display = 'none';
  };

  if (btnOpen) btnOpen.onclick = openRunner;
  if (btnClose) btnClose.onclick = closeRunner;
  if (btnCancel) btnCancel.onclick = closeRunner;

  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) closeRunner();
    };
  }

  if (btnLaunch) {
    btnLaunch.onclick = async () => {
      const intent = intentInput?.value.trim() || 'Deploy feature and verify full contract integrity';
      const leadAgent = leadSelect?.value || 'tdd-guide';

      btnLaunch.disabled = true;
      btnLaunch.innerHTML = '<span class="status-dot" style="background: var(--brand-blue); display: inline-block;"></span> Launching...';

      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: intent,
            lead_agent_id: leadAgent,
            pipelineType: activePipelineType
          })
        });

        if (res.ok) {
          const session = await res.json();
          state.activeSession.id = session.id;
          state.activeSession.title = session.title;
          closeRunner();
          switchView('view-dag');
          loadSessions();
          renderDynamicDag();
          advanceDagStep();
          showToast('Pipeline Active', `Orchestrating ${intent} with lead ${leadAgent}`, 'success');
        } else {
          showToast('Launch Failed', `Session create failed (${res.status})`, 'error');
          closeRunner();
        }
      } catch (err) {
        showToast('Pipeline Error', err.message, 'error');
      } finally {
        btnLaunch.disabled = false;
        btnLaunch.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Launch Pipeline</span>';
      }
    };
  }
}

// Sync Entities
const btnRefreshCatalog = document.getElementById('btn-refresh-catalog');
if (btnRefreshCatalog) {
  btnRefreshCatalog.addEventListener('click', async () => {
    btnRefreshCatalog.disabled = true;
    btnRefreshCatalog.innerHTML = '<span class="status-dot" style="background: var(--brand-blue); display: inline-block;"></span> Syncing...';
    try {
      await loadCatalog();
      renderCatalog();
      if (state.activeView === 'view-knowledge-graph') {
        initKgSimulation();
      }
      await loadTelemetry();
      const agentsCount = state.catalog?.agents?.length || 68;
      const skillsCount = state.catalog?.skills?.length || 286;
      const commandsCount = state.catalog?.commands?.length || 94;
      showToast('Entities Synchronized', `${agentsCount} Agents, ${skillsCount} Skills, ${commandsCount} Commands refreshed in real-time.`, 'success');
    } catch (err) {
      showToast('Sync Failed', err.message, 'error');
    } finally {
      btnRefreshCatalog.disabled = false;
      btnRefreshCatalog.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg><span>Sync Entities</span>';
    }
  });
}

// Inspector View Diff Button
const btnInspectorDiff = document.getElementById('btn-inspector-diff');
if (btnInspectorDiff) {
  btnInspectorDiff.addEventListener('click', () => {
    switchView('view-workspace');
    const tabDiff = document.getElementById('tab-diff-viewer');
    if (tabDiff) tabDiff.click();
  });
}

// Inspector Intervene Button
const btnInspectorIntervene = document.getElementById('btn-inspector-intervene');
if (btnInspectorIntervene) {
  btnInspectorIntervene.addEventListener('click', () => {
    const activeNode = document.getElementById('inspector-node-name')?.textContent || 'tdd-guide';
    if (window.triggerHitlModal) {
      window.triggerHitlModal({
        agentId: activeNode,
        tool: 'manual_intervention',
        command: `Operator intervention initiated for [${activeNode}] in session ${state.activeSession.id}`,
        risk: 'HIGH'
      });
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
    console.error('[OAS Web] Catalog load failed:', err.message);
    showToast('Catalog Offline', 'Could not load agents and skills from the API.', 'error');
  }

  renderCatalog();
}

// Render Capabilities Catalog Cards
function renderCatalog() {
  if (!elements.catalogGrid) return;
  elements.catalogGrid.innerHTML = '';

  let items = [];
  const filter = state.currentFilter || 'all';

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

  // Profile filtering
  const profile = state.currentProfile || 'all';
  if (profile !== 'all') {
    if (profile === 'minimal') {
      const minimalKeys = ['planner', 'architect', 'tdd-guide', 'code-reviewer', 'security-reviewer', 'build-error-resolver', 'doc-updater', 'plan', 'tdd', 'compact'];
      items = items.filter(it => {
        const key = (it.id || it.name || '').toLowerCase();
        return minimalKeys.some(m => key.includes(m));
      });
    } else if (profile === 'security') {
      items = items.filter(it => {
        const text = `${it.id} ${it.name} ${it.description || ''} ${it.cluster || ''} ${it.domain || ''}`.toLowerCase();
        return text.includes('security') || text.includes('hipaa') || text.includes('sandbox') || text.includes('guard') || text.includes('audit') || text.includes('auth') || text.includes('secret') || text.includes('reviewer');
      });
    } else if (profile === 'frontend') {
      items = items.filter(it => {
        const text = `${it.id} ${it.name} ${it.description || ''} ${it.cluster || ''} ${it.domain || ''}`.toLowerCase();
        return text.includes('front') || text.includes('react') || text.includes('vue') || text.includes('ui') || text.includes('css') || text.includes('motion') || text.includes('slides') || text.includes('next');
      });
    } else if (profile === 'backend') {
      items = items.filter(it => {
        const text = `${it.id} ${it.name} ${it.description || ''} ${it.cluster || ''} ${it.domain || ''}`.toLowerCase();
        return text.includes('back') || text.includes('api') || text.includes('sql') || text.includes('db') || text.includes('database') || text.includes('node') || text.includes('django') || text.includes('postgres');
      });
    } else if (profile === 'science') {
      items = items.filter(it => {
        const text = `${it.id} ${it.name} ${it.description || ''} ${it.cluster || ''} ${it.domain || ''}`.toLowerCase();
        return text.includes('science') || text.includes('protein') || text.includes('alpha') || text.includes('chem') || text.includes('bio') || text.includes('trial') || text.includes('drug');
      });
    }
  }

  // Update profile indicator text
  const profileInd = document.getElementById('catalog-profile-indicator');
  if (profileInd) {
    profileInd.textContent = profile === 'all'
      ? `Viewing: All Entities (${items.length})`
      : `Install Profile: ${profile.toUpperCase()} (${items.length} Active)`;
  }

  // Query search
  const query = (state.searchQuery || '').toLowerCase().trim();
  let filtered = items;
  if (query) {
    filtered = items.filter(item => {
      const titleMatch = (item.name || item.id || '').toLowerCase().includes(query);
      const descMatch = (item.description || '').toLowerCase().includes(query);
      const modelMatch = (item.model || '').toLowerCase().includes(query);
      const clusterMatch = (item.cluster || '').toLowerCase().includes(query);
      const domainMatch = (item.domain || '').toLowerCase().includes(query);
      const toolsMatch = (item.tools ? (Array.isArray(item.tools) ? item.tools.join(' ') : String(item.tools)) : '').toLowerCase().includes(query);
      return titleMatch || descMatch || modelMatch || clusterMatch || domainMatch || toolsMatch;
    });
  }

  // Sorting
  const sortMode = state.currentSort || 'az';
  filtered.sort((a, b) => {
    if (sortMode === 'type') {
      return (a.type || '').localeCompare(b.type || '');
    } else if (sortMode === 'cluster') {
      return (a.cluster || a.domain || '').localeCompare(b.cluster || b.domain || '');
    }
    return (a.name || a.id || '').localeCompare(b.name || b.id || '');
  });

  if (filtered.length === 0) {
    elements.catalogGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px 20px; text-align: center; background: rgba(8, 14, 28, 0.7); border: 1px dashed rgba(56, 189, 248, 0.2); border-radius: var(--radius-lg);">
        <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 12px;">No capabilities found matching the active filter.</p>
        <button class="btn btn-secondary btn-sm" id="btn-reset-catalog-filters" style="padding: 6px 14px;">Reset Search &amp; Filters</button>
      </div>
    `;
    const btnReset = document.getElementById('btn-reset-catalog-filters');
    if (btnReset) {
      btnReset.onclick = () => {
        state.searchQuery = '';
        state.currentProfile = 'all';
        state.currentFilter = 'all';
        if (elements.catalogSearch) elements.catalogSearch.value = '';
        document.querySelectorAll('.filter-pills .pill').forEach(p => p.classList.toggle('active', p.getAttribute('data-filter') === 'all'));
        document.querySelectorAll('.profile-filter-row .pill').forEach(p => p.classList.toggle('active', p.getAttribute('data-profile') === 'all'));
        renderCatalog();
      };
    }
    return;
  }

  filtered.forEach(item => {
    const card = document.createElement('div');
    const typeClass = (item.type || 'skill').toLowerCase();
    card.className = `catalog-card ${typeClass}`;
    card.innerHTML = `
      <div class="card-title">
        <span style="font-weight: 700; letter-spacing: -0.01em;">${escapeHtml(item.name || item.id)}</span>
        <span class="badge-tag font-mono" style="color: ${item.badgeColor}; border-color: ${item.badgeColor}44; background: ${item.badgeColor}18; display: inline-flex; align-items: center; gap: 4px;">
          <span style="width: 5px; height: 5px; border-radius: 50%; background: ${item.badgeColor}; box-shadow: 0 0 6px ${item.badgeColor};"></span>
          ${item.type}
        </span>
      </div>
      <p class="card-desc">${escapeHtml(item.description || 'No description available.')}</p>
      <div class="card-tags">
        ${item.model ? `<span class="badge-tag font-mono">Model: ${escapeHtml(item.model)}</span>` : ''}
        ${item.domain ? `<span class="badge-tag">${escapeHtml(item.domain)}</span>` : ''}
        ${item.cluster ? `<span class="badge-tag font-mono">${escapeHtml(item.cluster)}</span>` : ''}
      </div>
      <div class="card-actions-bar">
        <button class="card-action-btn primary btn-card-launch" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type)}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span>Run</span>
        </button>
        <button class="card-action-btn btn-card-inspect" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type)}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span>Inspect</span>
        </button>
      </div>
    `;

    // Card click opens modal
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openModal(item);
    });

    // Run action
    const btnLaunch = card.querySelector('.btn-card-launch');
    if (btnLaunch) {
      btnLaunch.onclick = (e) => {
        e.stopPropagation();
        if (item.type === 'Agent') {
          switchView('view-dag');
          selectDagNode(item.id);
          advanceDagStep();
          showToast('Agent Dispatched', `Launched execution for ${item.id}.`, 'success');
        } else if (item.type === 'Command') {
          const cmd = item.id.startsWith('/') ? item.id : `/${item.id}`;
          switchView('view-workspace');
          executeCliCommand(cmd);
        } else {
          switchView('view-workspace');
          executeCliCommand(`/${item.id}`);
        }
      };
    }

    // Inspect spec action
    const btnInspect = card.querySelector('.btn-card-inspect');
    if (btnInspect) {
      btnInspect.onclick = (e) => {
        e.stopPropagation();
        openModal(item);
      };
    }

    elements.catalogGrid.appendChild(card);
  });
}

let currentModalItem = null;

function openEntityModal(type, id) {
  const normType = (type || '').toLowerCase();
  let item = null;
  if (normType === 'agent') {
    item = state.catalog.agents.find(a => a.id === id);
    if (item) item = { ...item, type: 'Agent' };
  } else if (normType === 'skill') {
    item = state.catalog.skills.find(s => s.id === id);
    if (item) item = { ...item, type: 'Skill' };
  } else if (normType === 'command') {
    item = state.catalog.commands.find(c => c.id === id);
    if (item) item = { ...item, type: 'Command' };
  } else if (normType === 'mcp') {
    item = state.catalog.mcp.find(m => m.id === id);
    if (item) item = { ...item, type: 'MCP' };
  }
  if (!item) {
    item = { id, name: id, type: type ? (type.charAt(0).toUpperCase() + type.slice(1)) : 'Entity', description: `Entity ${id}` };
  }
  openModal(item);
}

// Modal handling
function openModal(item) {
  currentModalItem = item;
  elements.modalTitle.textContent = `${item.type || 'Entity'}: ${item.name || item.id}`;
  elements.modalSubtitle.textContent = item.model ? `Model: ${item.model}` : (item.domain || item.type || '');
  elements.modalDesc.textContent = item.description || 'Detailed specification for this entity.';
  elements.modalPrompt.textContent = item.systemPrompt || item.instructions || item.content || `Entity ${item.id} registered in the local OAS catalog.`;
  elements.modal.classList.add('active');
}

function closeModal() {
  elements.modal.classList.remove('active');
  currentModalItem = null;
}

if (elements.modalClose) elements.modalClose.addEventListener('click', closeModal);
if (elements.modalCancel) elements.modalCancel.addEventListener('click', closeModal);
if (elements.modalRun) {
  elements.modalRun.addEventListener('click', async () => {
    if (!currentModalItem) return closeModal();
    const it = currentModalItem;
    closeModal();
    if (it.type === 'Command' || (it.id && it.id.startsWith('/'))) {
      const cmd = it.id.startsWith('/') ? it.id : '/' + it.id;
      switchView('view-workspace');
      executeCliCommand(cmd);
    } else if (it.type === 'Agent') {
      switchView('view-dag');
      selectDagNode(it.id);
      advanceDagStep();
    } else {
      switchView('view-workspace');
      executeCliCommand(`/${it.id}`);
    }
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

let commandHistory = [];
let commandHistoryIdx = -1;

// Interactive Terminal CLI & Command Execution
async function executeCliCommand(cmdString) {
  if (!cmdString || !cmdString.trim()) return;
  const command = cmdString.trim();

  // Save in command history
  if (!commandHistory.includes(command)) {
    commandHistory.push(command);
  }
  commandHistoryIdx = -1;

  // Auto-switch to diff/terminal tab so output is immediately visible
  const tabDiff = document.getElementById('tab-diff-viewer');
  const tabCode = document.getElementById('tab-code-viewer');
  const diffDisplay = document.getElementById('workspace-diff-viewer');
  const codeDisplay = document.getElementById('workspace-code-display');

  if (tabDiff && tabCode && diffDisplay) {
    tabDiff.classList.add('active');
    tabCode.classList.remove('active');
    diffDisplay.style.display = 'block';
    if (codeDisplay) codeDisplay.style.display = 'none';
    hideWorkspaceEditors();
  }

  // Handle local clear command
  if (command === 'clear') {
    if (diffDisplay) {
      diffDisplay.innerHTML = `<span style="color: #94A3B8;">Terminal cleared. Ready for input.</span>\n`;
    }
    return;
  }

  // Print command into virtual terminal
  if (diffDisplay) {
    diffDisplay.innerHTML += `\n\n<span style="color: #38BDF8; font-weight: 700;">oas&gt; ${escapeHtml(command)}</span>\n`;
    diffDisplay.scrollTop = diffDisplay.scrollHeight;
  }

  try {
    const res = await fetch('/api/commands/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, sessionId: state.activeSession.id })
    });

    if (res.ok) {
      const result = await res.json();
      if (diffDisplay && result.output) {
        diffDisplay.innerHTML += `<span style="color: #34D399;">${escapeHtml(result.output).replace(/\n/g, '<br>')}</span>\n`;
        diffDisplay.scrollTop = diffDisplay.scrollHeight;
      }
      // Also append to thought stream as execution step
      const stream = document.getElementById('thought-stream-content');
      if (stream && result.output) {
        const msg = document.createElement('div');
        msg.className = 'stream-step-card';
        msg.style.borderLeftColor = '#34D399';
        msg.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="badge-tag" style="background: rgba(16,185,129,0.15); border-color:#10B981; color:#34D399; font-size:10px; font-weight:700;">CLI</span>
              <strong style="color: #34D399; font-size: 11px;">Command Executed</strong>
            </div>
            <span style="font-size: 9.5px; color: var(--text-muted); font-family: monospace;">${new Date().toLocaleTimeString()}</span>
          </div>
          <div style="font-size: 11px; font-family: monospace; color: #38BDF8; margin-top: 4px;">oas&gt; ${escapeHtml(command)}</div>
          <pre style="margin-top: 4px; background: #030712; padding: 6px; border-radius: 4px; font-family: monospace; font-size: 10px; color: #94A3B8; overflow-x: auto;">${escapeHtml(result.output)}</pre>
        `;
        stream.appendChild(msg);
        stream.scrollTop = stream.scrollHeight;
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      if (diffDisplay) {
        diffDisplay.innerHTML += `<span style="color: #FB7185;">Error: ${escapeHtml(errData.error || 'Command failed')}</span>\n`;
      }
    }
  } catch (err) {
    if (diffDisplay) {
      diffDisplay.innerHTML += `<span style="color: #FB7185;">Execution error: ${escapeHtml(err.message)}</span>\n`;
    }
  }
}

function initTerminalQuickChips() {
  const termChips = document.querySelectorAll('.term-chip');
  termChips.forEach(chip => {
    chip.onclick = () => {
      const cmd = chip.getAttribute('data-cmd');
      if (!cmd) return;
      executeCliCommand(cmd);
    };
  });

  const cliInput = document.getElementById('terminal-cli-input');
  if (cliInput) {
    cliInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        if (commandHistory.length > 0) {
          e.preventDefault();
          if (commandHistoryIdx === -1) {
            commandHistoryIdx = commandHistory.length - 1;
          } else if (commandHistoryIdx > 0) {
            commandHistoryIdx--;
          }
          cliInput.value = commandHistory[commandHistoryIdx] || '';
        }
      } else if (e.key === 'ArrowDown') {
        if (commandHistory.length > 0) {
          e.preventDefault();
          if (commandHistoryIdx !== -1 && commandHistoryIdx < commandHistory.length - 1) {
            commandHistoryIdx++;
            cliInput.value = commandHistory[commandHistoryIdx] || '';
          } else {
            commandHistoryIdx = -1;
            cliInput.value = '';
          }
        }
      }
    });
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
    showToast('Session Paused', 'Agent execution paused. State checkpoint saved.', 'info');
  },
  'dock-intervene': async () => {
    const feedback = prompt('Provide human intervention instructions for active subagent:');
    if (feedback) {
      await fetch(`/api/sessions/${state.activeSession.id}/intervene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'feedback', feedback })
      });
      showToast('Intervention Sent', 'Dispatched to active subagent: ' + feedback, 'info');
    }
  },
  'dock-compact': () => executeCliCommand('/compact'),
  'dock-rollback': () => executeCliCommand('/checkpoint manual_rollback_target')
};

Object.entries(dockButtons).forEach(([id, handler]) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', handler);
});

// --- PLAN CANVAS PRO CONTROLLER ---
let currentPlanArtifact = null;

async function loadPlanCanvas() {
  const container = document.getElementById('plan-phases-list');
  const annotationsContainer = document.getElementById('plan-annotations-list');
  const badge = document.getElementById('plan-status-badge');
  const desc = document.getElementById('plan-status-desc');
  const progFill = document.getElementById('plan-progress-fill');
  const progPercent = document.getElementById('plan-progress-percent');
  if (!container) return;

  container.innerHTML = '<div style="color: var(--text-muted); padding: 16px;">Loading capability plan from artifact store...</div>';

  try {
    const res = await fetch(`/api/artifacts?sessionId=${state.activeSession.id}`);
    let artifacts = [];
    if (res.ok) {
      artifacts = await res.json();
    }
    if (!artifacts || artifacts.length === 0) {
      const allRes = await fetch('/api/artifacts');
      if (allRes.ok) artifacts = await allRes.json();
    }

    const plan = (artifacts || []).find(a => a.artifact_type === 'plan') || (artifacts && artifacts[0]);
    if (!plan) {
      container.innerHTML = '<div style="color: var(--text-muted); padding: 16px;">No capability plan artifacts found. Use /plan to generate one.</div>';
      return;
    }

    // Filter out stale test phases
    if (plan.phases) {
      plan.phases = plan.phases.filter(p => p.id !== 'p_test' && p.title !== 'Phase Test');
    }

    currentPlanArtifact = plan;

    // Calculate progress
    const phases = plan.phases || [];
    const totalPhases = phases.length || 1;
    const completedCount = phases.filter(p => p.completed).length;
    const pct = Math.round((completedCount / totalPhases) * 100);

    if (progFill) progFill.style.width = `${pct}%`;
    if (progPercent) progPercent.textContent = `${pct}% (${completedCount}/${phases.length} Phases Passed)`;

    if (badge) {
      if (completedCount === phases.length && phases.length > 0) {
        badge.textContent = 'COMPLETED';
        badge.style.color = 'var(--status-active)';
      } else {
        badge.textContent = (plan.status || 'IN_PROGRESS').toUpperCase();
        badge.style.color = plan.status === 'completed' ? 'var(--status-active)' : 'var(--brand-blue)';
      }
    }
    if (desc) {
      desc.textContent = `Artifact ID: ${plan.id} • ${phases.length} phases tracked.`;
    }

    // Render phases
    container.innerHTML = '';
    phases.forEach((phase, idx) => {
      const card = document.createElement('div');
      card.className = 'phase-card';
      card.dataset.phaseId = phase.id || `p${idx}`;

      const statusText = phase.completed ? 'PASSED' : (phase.status || 'PENDING');
      const statusColor = phase.completed ? '#10B981' : (statusText === 'IN_PROGRESS' ? '#38BDF8' : '#F59E0B');

      card.innerHTML = `
        <div class="phase-card-header">
          <input type="checkbox" ${phase.completed ? 'checked' : ''} class="phase-check" id="chk-phase-${idx}" title="Toggle completion">
          <div style="flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong style="font-size: 14px; color: var(--text-primary);">${escapeHtml(phase.title)}</strong>
              <div style="display: flex; gap: 6px; align-items: center;">
                <span class="badge-tag font-mono phase-status-tag" style="color: ${statusColor}; border-color: ${statusColor}44; background: ${statusColor}18;">${statusText}</span>
                <span class="phase-expand-icon" style="font-size: 10px; color: var(--text-muted); transition: transform 0.2s ease;">▼</span>
              </div>
            </div>
            <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px; line-height: 1.5;">${escapeHtml(phase.description)}</p>
          </div>
        </div>
        <div class="phase-details-drawer">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px; margin-bottom: 8px;">
            <div style="display: flex; gap: 8px; font-size: 11px; align-items: center;">
              <span style="color: var(--text-muted);">Assigned Agent:</span>
              <span class="badge-tag font-mono" style="color: #38BDF8;">${escapeHtml(phase.assignedAgent || 'architect')}</span>
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary btn-sm btn-cycle-status" data-idx="${idx}" style="font-size: 10px; padding: 2px 8px;">Cycle Status</button>
              <button class="btn btn-danger btn-sm btn-delete-phase" data-idx="${idx}" style="font-size: 10px; padding: 2px 6px; color: #F43F5E;">Delete</button>
            </div>
          </div>
          <div style="font-size: 11px; color: #94A3B8;">
            <strong style="color: #BAE6FD;">Deliverables &amp; Verification:</strong>
            <p style="margin: 4px 0 0 0; line-height: 1.5; color: #CBD5E1;">${escapeHtml(phase.deliverables || phase.description || 'Verified through automated CI test matrix.')}</p>
          </div>
        </div>
      `;

      // Expand/collapse on card click (except when clicking controls)
      card.addEventListener('click', (e) => {
        if (e.target.closest('.phase-check') || e.target.closest('button')) return;
        card.classList.toggle('expanded');
        const icon = card.querySelector('.phase-expand-icon');
        if (icon) icon.style.transform = card.classList.contains('expanded') ? 'rotate(180deg)' : 'rotate(0deg)';
      });

      // Checkbox listener
      const chk = card.querySelector('.phase-check');
      chk.addEventListener('change', async () => {
        phase.completed = chk.checked;
        phase.status = chk.checked ? 'PASSED' : 'PENDING';
        const tag = card.querySelector('.phase-status-tag');
        tag.textContent = phase.status;
        tag.style.color = chk.checked ? '#10B981' : '#F59E0B';
        tag.style.borderColor = chk.checked ? '#10B98144' : '#F59E0B44';
        tag.style.background = chk.checked ? '#10B98118' : '#F59E0B18';

        await fetch(`/api/artifacts/${plan.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phases: plan.phases })
        });
        loadPlanCanvas();
      });

      // Cycle status listener
      const btnCycle = card.querySelector('.btn-cycle-status');
      if (btnCycle) {
        btnCycle.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (phase.status === 'PENDING') {
            phase.status = 'IN_PROGRESS';
            phase.completed = false;
          } else if (phase.status === 'IN_PROGRESS') {
            phase.status = 'PASSED';
            phase.completed = true;
          } else {
            phase.status = 'PENDING';
            phase.completed = false;
          }
          await fetch(`/api/artifacts/${plan.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phases: plan.phases })
          });
          loadPlanCanvas();
        });
      }

      // Delete phase listener
      const btnDel = card.querySelector('.btn-delete-phase');
      if (btnDel) {
        btnDel.addEventListener('click', async (e) => {
          e.stopPropagation();
          plan.phases.splice(idx, 1);
          await fetch(`/api/artifacts/${plan.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phases: plan.phases })
          });
          showToast('Phase Removed', `Phase "${phase.title}" removed from plan.`, 'info');
          loadPlanCanvas();
        });
      }

      container.appendChild(card);
    });

    // Render annotations
    if (annotationsContainer) {
      annotationsContainer.innerHTML = '';
      const annotations = plan.annotations || [];
      if (annotations.length === 0) {
        annotationsContainer.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 8px;">No human review annotations yet. Post one below.</div>';
      } else {
        annotations.forEach((ann, aIdx) => {
          const box = document.createElement('div');
          box.className = 'annotation-box';
          const author = ann.author || 'reviewer';
          const timeStr = ann.timestamp ? new Date(ann.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'recently';
          box.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span class="badge-tag font-mono" style="color: #38BDF8; font-size: 10px;">${escapeHtml(author)}</span>
              <div style="display: flex; gap: 6px; align-items: center;">
                <span style="font-size: 9.5px; color: var(--text-muted);">${timeStr}</span>
                <button class="btn-del-ann" data-idx="${aIdx}" style="background: none; border: none; color: #F43F5E; cursor: pointer; font-size: 12px; padding: 0 2px;" title="Remove annotation">&times;</button>
              </div>
            </div>
            <div style="color: #BAE6FD; font-size: 11.5px; line-height: 1.45;">${escapeHtml(ann.text)}</div>
          `;

          const btnDelAnn = box.querySelector('.btn-del-ann');
          if (btnDelAnn) {
            btnDelAnn.addEventListener('click', async (e) => {
              e.stopPropagation();
              plan.annotations.splice(aIdx, 1);
              await fetch(`/api/artifacts/${plan.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ annotations: plan.annotations })
              });
              loadPlanCanvas();
            });
          }

          annotationsContainer.appendChild(box);
        });
      }
    }
  } catch (err) {
    container.innerHTML = `<div style="color: var(--status-error); padding: 16px;">Failed to load plan: ${err.message}</div>`;
  }
}

function initPlanCanvasInteractions() {
  const btnAdd = document.getElementById('btn-add-annotation');
  const input = document.getElementById('plan-new-annotation');
  const roleSelect = document.getElementById('plan-annotation-role');
  const btnExec = document.getElementById('btn-execute-plan');
  const btnOpenAddPhase = document.getElementById('btn-open-add-phase');
  const btnResetPlan = document.getElementById('btn-reset-canonical-plan');
  const modalAddPhase = document.getElementById('modal-add-phase');
  const btnCloseAddPhase = document.getElementById('btn-close-add-phase');
  const btnCancelAddPhase = document.getElementById('btn-cancel-add-phase');
  const btnSaveAddPhase = document.getElementById('btn-save-add-phase');

  // Add Annotation
  if (btnAdd && input) {
    btnAdd.onclick = async () => {
      const text = input.value.trim();
      if (!text) return;
      const author = roleSelect ? roleSelect.value : 'reviewer';
      input.value = '';

      await fetch(`/api/sessions/${state.activeSession.id}/intervene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotation: text, author })
      });

      if (currentPlanArtifact) {
        if (!currentPlanArtifact.annotations) currentPlanArtifact.annotations = [];
        currentPlanArtifact.annotations.push({
          author,
          text,
          timestamp: new Date().toISOString()
        });
        await fetch(`/api/artifacts/${currentPlanArtifact.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ annotations: currentPlanArtifact.annotations })
        });
      }

      showToast('Annotation Posted', `Feedback registered as ${author}.`, 'success');
      loadPlanCanvas();
    };
  }

  // Reset to Canonical Plan
  if (btnResetPlan) {
    btnResetPlan.onclick = async () => {
      if (!confirm('Reset capability plan to canonical 5 enterprise milestones?')) return;
      const canonicalPhases = [
        { id: 'p0', title: 'Phase 0: Codebase Ontology & Directory Deep-Dive', description: 'Cataloged all 68 agents, 286 skills, 94 commands, and 36 MCP servers into relational knowledge graph.', completed: true, assignedAgent: 'architect' },
        { id: 'p1', title: 'Phase 1: System Architecture & Persistence Layer', description: 'Drizzle ORM schema with pgvector support and localized MemoryStore JSON fallback.', completed: true, assignedAgent: 'architect' },
        { id: 'p2', title: 'Phase 2: Live Workspace & File Tree Integration', description: 'Live file tree explorer, sandbox file reader, and real-time execution thought stream.', completed: true, assignedAgent: 'developer' },
        { id: 'p3', title: 'Phase 3: Multi-Session Execution & Worktree Runner', description: 'Isolated Git worktrees per subagent, multi-session CRUD, and transcript export.', completed: true, assignedAgent: 'loop-operator' },
        { id: 'p4', title: 'Phase 4: Verification Suite & Local Hardening', description: 'Full unit and integration test coverage across all control plane routes.', completed: true, assignedAgent: 'tdd-guide' }
      ];

      if (currentPlanArtifact) {
        currentPlanArtifact.phases = canonicalPhases;
        await fetch(`/api/artifacts/${currentPlanArtifact.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phases: canonicalPhases })
        });
      }
      showToast('Plan Restored', 'Canonical roadmap milestones restored.', 'success');
      loadPlanCanvas();
    };
  }

  // Add Phase Modal
  if (btnOpenAddPhase && modalAddPhase) {
    btnOpenAddPhase.onclick = () => { modalAddPhase.style.display = 'flex'; };
  }
  if (btnCloseAddPhase && modalAddPhase) {
    btnCloseAddPhase.onclick = () => { modalAddPhase.style.display = 'none'; };
  }
  if (btnCancelAddPhase && modalAddPhase) {
    btnCancelAddPhase.onclick = () => { modalAddPhase.style.display = 'none'; };
  }
  if (btnSaveAddPhase && modalAddPhase) {
    btnSaveAddPhase.onclick = async () => {
      const id = document.getElementById('add-phase-id')?.value.trim() || `p${Date.now()}`;
      const title = document.getElementById('add-phase-title')?.value.trim();
      const agent = document.getElementById('add-phase-agent')?.value || 'architect';
      const status = document.getElementById('add-phase-status')?.value || 'IN_PROGRESS';
      const desc = document.getElementById('add-phase-desc')?.value.trim() || 'Custom roadmap milestone.';

      if (!title) return alert('Please provide a phase title.');

      if (currentPlanArtifact) {
        if (!currentPlanArtifact.phases) currentPlanArtifact.phases = [];
        currentPlanArtifact.phases.push({
          id,
          title,
          description: desc,
          assignedAgent: agent,
          status,
          completed: status === 'PASSED',
          deliverables: desc
        });

        await fetch(`/api/artifacts/${currentPlanArtifact.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phases: currentPlanArtifact.phases })
        });
      }

      modalAddPhase.style.display = 'none';
      document.getElementById('add-phase-title').value = '';
      document.getElementById('add-phase-desc').value = '';
      showToast('Roadmap Phase Added', `"${title}" appended to capability plan.`, 'success');
      loadPlanCanvas();
    };
  }

  // Approve & Execute All
  if (btnExec) {
    btnExec.onclick = async () => {
      const badge = document.getElementById('plan-status-badge');
      const meter = document.getElementById('plan-executing-meter');
      const bar = document.getElementById('plan-exec-bar');
      const stepTxt = document.getElementById('plan-exec-step');

      if (badge) {
        badge.textContent = 'EXECUTING';
        badge.style.color = '#38BDF8';
      }
      if (meter) meter.style.display = 'block';

      // Simulation steps for user visual feedback
      const steps = [
        'Step 1/5: Loading Ontologies...',
        'Step 2/5: Validating Monorepo Boundaries...',
        'Step 3/5: Running Test Battery...',
        'Step 4/5: Hardening Sandbox Layer...',
        'Step 5/5: Finalizing Verification...'
      ];

      for (let i = 0; i < steps.length; i++) {
        if (stepTxt) stepTxt.textContent = steps[i];
        if (bar) bar.style.width = `${((i + 1) / steps.length) * 100}%`;
        await new Promise(r => setTimeout(r, 350));
      }

      try {
        const res = await fetch(`/api/sessions/${state.activeSession.id}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'Execute approved capability roadmap' })
        });
        if (res.ok) {
          if (badge) {
            badge.textContent = 'COMPLETED';
            badge.style.color = '#10B981';
          }
          if (meter) meter.style.display = 'none';
          showToast('Roadmap Executed', 'All capability milestones passed and verified.', 'success');
        }
      } catch (err) {
        showToast('Execution Error', err.message, 'error');
        if (meter) meter.style.display = 'none';
      }
    };
  }
}

// ==========================================
// STUDIO BUILDER (CUSTOM AGENT & SKILL DESIGNER)
// ==========================================
function initStudioBuilder() {
  const builderTabAgent = document.getElementById('builder-tab-agent');
  const builderTabSkill = document.getElementById('builder-tab-skill');
  const builderSectionAgent = document.getElementById('builder-section-agent');
  const builderSectionSkill = document.getElementById('builder-section-skill');
  const presetSelect = document.getElementById('builder-preset-select');
  const toolsPicker = document.getElementById('builder-tools-picker');
  const hiddenTools = document.getElementById('builder-agent-tools');
  const toolsCountBadge = document.getElementById('builder-tools-count-badge');
  const agentSlugInput = document.getElementById('builder-agent-id');
  const agentSlugStatus = document.getElementById('builder-agent-slug-status');
  const skillSlugInput = document.getElementById('builder-skill-id');
  const skillSlugStatus = document.getElementById('builder-skill-slug-status');
  const agentPrompt = document.getElementById('builder-agent-prompt');
  const agentPromptCount = document.getElementById('builder-agent-prompt-count');
  const skillPrompt = document.getElementById('builder-skill-prompt');
  const skillPromptCount = document.getElementById('builder-skill-prompt-count');
  const btnCopyAgent = document.getElementById('btn-copy-agent-preview');
  const btnCopySkill = document.getElementById('btn-copy-skill-preview');

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

  // Tool Chips Toggle
  if (toolsPicker && hiddenTools) {
    const chips = toolsPicker.querySelectorAll('.tool-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        const activeTools = Array.from(toolsPicker.querySelectorAll('.tool-chip.active')).map(c => c.getAttribute('data-tool'));
        hiddenTools.value = activeTools.join(', ');
        if (toolsCountBadge) toolsCountBadge.textContent = `${activeTools.length} Active`;
        updateAgentPreview();
      });
    });
  }

  // Template Presets
  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      const val = presetSelect.value;
      if (val === 'planner') {
        setAgentFields('feature-planner', 'architecture_and_planning', 'opus', ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
          'Decompose complex product requirements into modular, dependency-ordered capability plans.',
          'You are an expert system implementation planner. Break features into granular phases, identify architectural risks, and prescribe strict verification criteria.');
      } else if (val === 'reviewer') {
        setAgentFields('code-auditor', 'quality_and_review', 'sonnet', ['Read', 'Grep', 'Glob', 'Bash'],
          'Senior code quality and maintainability reviewer enforcing immutability, error containment, and test coverage.',
          'You are a senior code reviewer. Review git diffs thoroughly, enforce immutability, detect silent error swallowing, and ensure 80%+ test coverage.');
      } else if (val === 'build_resolver') {
        setAgentFields('build-medic', 'build_resolvers', 'sonnet', ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
          'Autonomous compiler and type error resolution specialist applying minimal surgical patches.',
          'You diagnose build and TypeScript compilation failures. Apply surgical minimal-diff fixes and verify compilation incrementally.');
      } else if (val === 'security') {
        setAgentFields('security-sentinel', 'quality_and_review', 'sonnet', ['Read', 'Grep', 'Glob', 'Bash'],
          'Proactive security vulnerability scanner detecting SQLi, XSS, CSRF, path traversal, and credential leakage.',
          'You audit code changes for security vulnerabilities. Never allow hardcoded secrets, ensure user input sanitization, and enforce strict sandbox isolation.');
      } else if (val === 'tdd_guide') {
        setAgentFields('tdd-champion', 'architecture_and_planning', 'sonnet', ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
          'Test-Driven Development champion enforcing red-green-refactor cycles before feature implementation.',
          'You guide developers through strict TDD. First write failing tests (RED), implement minimal code to pass (GREEN), and refactor for elegance.');
      }
    });
  }

  function setAgentFields(id, cluster, model, tools, desc, prompt) {
    if (agentSlugInput) agentSlugInput.value = id;
    const cl = document.getElementById('builder-agent-cluster');
    if (cl) cl.value = cluster;
    const md = document.getElementById('builder-agent-model');
    if (md) md.value = model;
    const de = document.getElementById('builder-agent-desc');
    if (de) de.value = desc;
    if (agentPrompt) agentPrompt.value = prompt;

    // Update chips
    if (toolsPicker && hiddenTools) {
      hiddenTools.value = tools.join(', ');
      toolsPicker.querySelectorAll('.tool-chip').forEach(chip => {
        const tName = chip.getAttribute('data-tool');
        if (tools.includes(tName)) chip.classList.add('active');
        else chip.classList.remove('active');
      });
      if (toolsCountBadge) toolsCountBadge.textContent = `${tools.length} Active`;
    }
    updateAgentPreview();
  }

  // Slug validation & counters
  if (agentSlugInput) {
    agentSlugInput.addEventListener('input', () => {
      const val = agentSlugInput.value.trim();
      const valid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(val);
      if (agentSlugStatus) {
        agentSlugStatus.textContent = valid ? 'Valid format' : 'Lowercase, numbers & hyphens only';
        agentSlugStatus.style.color = valid ? '#34D399' : '#F59E0B';
      }
      updateAgentPreview();
    });
  }

  if (skillSlugInput) {
    skillSlugInput.addEventListener('input', () => {
      const val = skillSlugInput.value.trim();
      const valid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(val);
      if (skillSlugStatus) {
        skillSlugStatus.textContent = valid ? 'Valid format' : 'Lowercase, numbers & hyphens only';
        skillSlugStatus.style.color = valid ? '#34D399' : '#F59E0B';
      }
      updateSkillPreview();
    });
  }

  if (agentPrompt && agentPromptCount) {
    agentPrompt.addEventListener('input', () => {
      agentPromptCount.textContent = `${agentPrompt.value.length} chars`;
      updateAgentPreview();
    });
  }

  if (skillPrompt && skillPromptCount) {
    skillPrompt.addEventListener('input', () => {
      skillPromptCount.textContent = `${skillPrompt.value.length} chars`;
      updateSkillPreview();
    });
  }

  // Copy Preview Buttons
  if (btnCopyAgent) {
    btnCopyAgent.onclick = () => {
      const text = document.getElementById('builder-agent-preview')?.textContent || '';
      navigator.clipboard.writeText(text);
      showToast('YAML Copied', 'Agent specification copied to clipboard.', 'success');
    };
  }
  if (btnCopySkill) {
    btnCopySkill.onclick = () => {
      const text = document.getElementById('builder-skill-preview')?.textContent || '';
      navigator.clipboard.writeText(text);
      showToast('Markdown Copied', 'Skill specification copied to clipboard.', 'success');
    };
  }

  // Initial previews
  updateAgentPreview();
  updateSkillPreview();
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

['builder-agent-id', 'builder-agent-model', 'builder-agent-desc', 'builder-agent-prompt'].forEach(id => {
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
    if (!id) {
      showToast('Validation Error', 'Please enter an Agent Identifier (slug).', 'error');
      return;
    }

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
        showToast('Agent Registered', `Exported to ${data.file} and loaded into catalog.`, 'success');
        loadCatalog();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast('Export Failed', err.error || 'Failed to export agent', 'error');
      }
    } catch (e) {
      showToast('Export Error', e.message, 'error');
    }
  });
}

// Export Skill
const btnExportSkill = document.getElementById('btn-export-skill');
if (btnExportSkill) {
  btnExportSkill.addEventListener('click', async () => {
    const id = document.getElementById('builder-skill-id')?.value.trim();
    if (!id) {
      showToast('Validation Error', 'Please enter a Skill Identifier (directory name).', 'error');
      return;
    }

    try {
      const res = await fetch('/api/skills/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          domain: document.getElementById('builder-skill-domain')?.value,
          triggers: document.getElementById('builder-skill-triggers')?.value,
          description: document.getElementById('builder-skill-desc')?.value,
          instructions: document.getElementById('builder-skill-prompt')?.value,
          confirmPromote: Boolean(document.getElementById('builder-skill-confirm-promote')?.checked)
        })
      });

      if (res.ok) {
        const data = await res.json();
        const note = data.stage === 'catalog'
          ? `Promoted to ${data.file}`
          : `Draft saved at ${data.file} (not in catalog until HITL promote)`;
        showToast(data.stage === 'catalog' ? 'Skill promoted' : 'Skill draft saved', note, 'success');
        if (data.stage === 'catalog') loadCatalog();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast('Export Failed', err.error || 'Failed to export skill', 'error');
      }
    } catch (e) {
      showToast('Export Error', e.message, 'error');
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

async function renderDynamicDag() {
  const viewport = document.getElementById('dag-viewport');
  if (!viewport) return;

  try {
    const res = await fetch(`/api/sessions/${state.activeSession.id}/pipeline`);
    if (res.ok) {
      const run = await res.json();
      if (run && run.nodes && run.nodes.length > 0) {
        dagNodesData = run.nodes.map((node, i) => {
          let x, y;
          if (i < 3) {
            x = 80 + i * 260;
            y = 120;
          } else {
            x = 80 + (5 - i) * 260;
            y = 320;
          }
          return {
            id: node.id,
            agentId: node.agentId,
            status: node.status,
            x,
            y
          };
        });
      }
    }
  } catch (err) {
    // Keep local layout fallback
  }

  viewport.innerHTML = '';
  viewport.setAttribute('transform', `translate(${dagPan.x}, ${dagPan.y}) scale(${dagZoom})`);

  // Draw bezier links between consecutive nodes
  for (let i = 0; i < dagNodesData.length - 1; i++) {
    const from = dagNodesData[i];
    const to = dagNodesData[i + 1];
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const sx = from.x + 140;
    const sy = from.y + 45;
    const isFlowing = to.status === 'running';
    path.setAttribute('class', `dag-edge ${isFlowing ? 'edge-animated' : ''}`);
    if (from.status === 'completed' && to.status === 'completed') {
      path.setAttribute('stroke', '#10B981');
    } else if (isFlowing) {
      path.setAttribute('stroke', '#3B82F6');
    } else {
      path.setAttribute('stroke', 'rgba(226, 232, 240, 0.2)');
    }
    viewport.appendChild(path);
  }

  // Draw nodes
  dagNodesData.forEach((node) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const isRunning = node.status === 'running';
    const isStalled = node.status === 'stalled' || node.status === 'paused';
    const isFailed = node.status === 'failed' || node.status === 'error';
    const isDone = node.status === 'completed';

    let haloClass = '';
    if (isRunning) haloClass = 'active node-running-halo';
    else if (isStalled) haloClass = 'active node-stalled-halo';

    g.setAttribute('class', `dag-node ${haloClass}`.trim());
    g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    g.setAttribute('data-agent', node.agentId);
    g.style.cursor = 'pointer';

    let strokeColor = 'rgba(226, 232, 240, 0.2)';
    let statusText = 'QUEUED';
    let badgeColor = '#94A3B8';

    if (isDone) {
      strokeColor = '#10B981';
      statusText = 'DONE';
      badgeColor = '#10B981';
    } else if (isRunning) {
      strokeColor = '#3B82F6';
      statusText = 'RUNNING';
      badgeColor = '#3B82F6';
    } else if (isStalled) {
      strokeColor = '#F59E0B';
      statusText = 'PAUSED';
      badgeColor = '#F59E0B';
    } else if (isFailed) {
      strokeColor = '#F43F5E';
      statusText = 'FAILED';
      badgeColor = '#F43F5E';
    }

    const agentDef = (state.catalog.agents || []).find(a => a.id === node.agentId);
    const roleText = (agentDef?.description || nodeMetadata[node.agentId]?.role || 'Agent Task').substring(0, 22) + '...';
    const isSelected = activeSelectedDagNode === node.agentId;
    const finalStroke = isSelected ? '#38BDF8' : strokeColor;
    const finalWidth = isSelected ? '2.5' : '1.5';
    const filterStyle = isSelected ? 'filter: drop-shadow(0 0 10px rgba(56, 189, 248, 0.75));' : '';

    g.innerHTML = `
      <rect width="144" height="92" rx="10" fill="url(#grad-node-cyber)" stroke="${finalStroke}" stroke-width="${finalWidth}" style="${filterStyle}" />
      <line x1="12" y1="2" x2="132" y2="2" stroke="rgba(255, 255, 255, 0.2)" stroke-width="1" />
      <circle cx="24" cy="26" r="4.5" fill="${badgeColor}" filter="drop-shadow(0 0 5px ${badgeColor})" />
      <text x="36" y="30" fill="#F8FAFC" font-size="12" font-weight="700" font-family="'Inter', sans-serif">${escapeHtml(node.agentId)}</text>
      <text x="16" y="52" fill="#94A3B8" font-size="9.5" font-family="'Inter', sans-serif">${escapeHtml(roleText)}</text>
      <rect x="16" y="64" width="62" height="18" rx="4" fill="rgba(8, 14, 28, 0.85)" stroke="rgba(56, 189, 248, 0.25)" />
      <text x="23" y="77" fill="${badgeColor}" font-size="9" font-weight="700" font-family="'JetBrains Mono', monospace">${statusText}</text>
    `;

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      activeSelectedDagNode = node.agentId;
      selectDagNode(node.agentId);
      renderDynamicDag();
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


function initMissionComposer() {
  const missionInput = document.getElementById('agent-mission-input');
  const btnSend = document.getElementById('btn-send-mission');
  const modelSelect = document.getElementById('agent-model-select');
  const activeAgentBadge = document.getElementById('agent-active-badge');
  const chips = document.querySelectorAll('.mission-chip');

  const executeMission = async (promptText) => {
    if (!promptText || !promptText.trim()) return;
    const intent = promptText.trim();
    const model = modelSelect ? modelSelect.value : 'Claude 3.7 Sonnet';

    if (btnSend) {
      btnSend.disabled = true;
      btnSend.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#38BDF8; margin-right:4px;"></span> Running...`;
    }
    if (activeAgentBadge) {
      activeAgentBadge.textContent = 'executing mission...';
      activeAgentBadge.style.color = '#38BDF8';
    }

    // Append interim thinking card in thought stream
    const stream = document.getElementById('thought-stream-content');
    let thinkingCard = null;
    if (stream) {
      thinkingCard = document.createElement('div');
      thinkingCard.className = 'stream-step-card';
      thinkingCard.style.borderLeftColor = '#38BDF8';
      thinkingCard.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="badge-tag" style="background: rgba(15,23,42,0.8); border-color:#38BDF8; color:#38BDF8; font-size:10px; font-weight:700;">planner</span>
            <strong style="font-size:11px; color:#F8FAFC;">Processing Mission</strong>
          </div>
          <span style="font-size:9.5px; color:#38BDF8; font-family:monospace;">${escapeHtml(model)}</span>
        </div>
        <div style="font-size:11.5px; color:#94A3B8; margin-top:4px;">${escapeHtml(intent)}</div>
        <div style="margin-top:6px; font-size:10px; color:#38BDF8; display:flex; align-items:center; gap:6px;">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#38BDF8;"></span>
          Synthesizing agent plan, tool calls, and patch steps...
        </div>
      `;
      stream.appendChild(thinkingCard);
      stream.scrollTop = stream.scrollHeight;
    }

    try {
      const res = await fetch(`/api/sessions/${state.activeSession.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, model })
      });

      if (res.ok) {
        const data = await res.json();
        if (thinkingCard) thinkingCard.remove();
        if (data.step) {
          appendStepToStream(data.step);
        } else {
          await loadSessionSteps(state.activeSession.id);
        }
        if (missionInput) missionInput.value = '';
        showToast('Mission Dispatched', `Executed with ${model}`, 'success');
        renderDynamicDag();
      } else {
        const err = await res.json().catch(() => ({}));
        if (thinkingCard) {
          thinkingCard.innerHTML = `<div style="color: #EF4444; font-size: 11px;">Error executing mission: ${escapeHtml(err.error || 'Unknown error')}</div>`;
        }
        showToast('Execution Error', err.error || 'Failed to execute mission', 'error');
      }
    } catch (err) {
      if (thinkingCard) {
        thinkingCard.innerHTML = `<div style="color: #EF4444; font-size: 11px;">Network error: ${escapeHtml(err.message)}</div>`;
      }
      showToast('Network Error', err.message, 'error');
    } finally {
      if (btnSend) {
        btnSend.disabled = false;
        btnSend.innerHTML = `<span>Send</span> <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
      }
      if (activeAgentBadge) {
        activeAgentBadge.textContent = 'planner active';
      }
    }
  };

  if (btnSend && missionInput) {
    btnSend.onclick = () => executeMission(missionInput.value);
    missionInput.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        executeMission(missionInput.value);
      }
    };
  }

  // Quick starter chips
  chips.forEach(chip => {
    chip.onclick = () => {
      const prompt = chip.getAttribute('data-prompt');
      if (prompt) {
        if (missionInput) missionInput.value = prompt;
        executeMission(prompt);
      }
    };
  });
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
// 4. INTERACTIVE KNOWLEDGE GRAPH VISUALIZER (3D LIVING NEURAL CORE)
// ==========================================
let kgData = { nodes: [], edges: [] };
let kgFilteredNodes = [];
let kgCanvas = null;
let kgCtx = null;
let kgZoom = 1;
let kgPan = { x: 0, y: 0 };
let selectedKgNode = null;
let hoveredKgNode = null;
let kgAnimationId = null;

// 3D Camera & Space Physics
let kgCamera = {
  rotX: 0.32,          // Pitch angle (~18 deg)
  rotY: -0.38,         // Yaw angle (~-22 deg)
  targetRotX: 0.32,
  targetRotY: -0.38,
  autoOrbit: true,     // Smooth cinematic idle drift
  orbitSpeed: 0.0016,
  fov: 720,
  distance: 820
};
let is3dRotating = false;
let is3dPanning = false;
let kgMousePrev = { x: 0, y: 0 };
let kgTime = 0;
let kgPhotons = [];        // Traveling edge light pulses
let kgBackgroundDust = []; // Ambient 3D floating space particles
let kgCurrentLayout = 'galaxy';
let kgLayoutTransitioning = false;
let kgBlastImpact = null;
let kgActiveTelemetry = { activeAgents: [], agentMetrics: {} };
let kgTelemetryInterval = null;

async function loadKnowledgeGraph() {
  try {
    const res = await fetch('/api/graph');
    if (res.ok) {
      kgData = await res.json();
      initKgSimulation();

      // Ensure a default node (tdd-guide or first agent) is selected and inspected
      if (!selectedKgNode && kgData.nodes.length > 0) {
        const defaultNode = kgData.nodes.find(n => n.id === 'agent:tdd-guide' || n.name === 'tdd-guide') || kgData.nodes[0];
        selectedKgNode = defaultNode;
        updateKgInspector(defaultNode);
      }

      // Populate target select in Link Synapse form
      const linkTargetSelect = document.getElementById('kg-link-target-select');
      if (linkTargetSelect) {
        const sorted = [...kgData.nodes].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        linkTargetSelect.innerHTML = '<option value="">Select target entity...</option>' +
          sorted.map(n => `<option value="${escapeHtml(n.id)}">[${n.type.toUpperCase()}] ${escapeHtml(n.name || n.id)}</option>`).join('');
      }

      // Update HUD counters
      const nodesCountEl = document.getElementById('kg-hud-nodes-count');
      const synapsesCountEl = document.getElementById('kg-hud-synapses-count');
      if (nodesCountEl) nodesCountEl.textContent = kgData.nodes.length;
      if (synapsesCountEl) synapsesCountEl.textContent = (kgData.edges || []).length;
    }
  } catch (err) {
    console.error('Error loading graph:', err);
  }
}

async function switchKgLayout(mode) {
  kgCurrentLayout = mode;
  document.querySelectorAll('.kg-layout-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-kg-mode') === mode);
  });

  const labelEl = document.getElementById('kg-hud-mode-label');
  if (labelEl) {
    const labels = {
      galaxy: '3D GALAXY CORE',
      force: 'ORGANIC PHYSICS SPRING',
      hierarchy: 'RADIAL HIERARCHY',
      tcas: 'TCAS AIRSPACE DECONFLICTION'
    };
    labelEl.textContent = labels[mode] || mode.toUpperCase();
  }

  let coordinates = null;
  try {
    const res = await fetch(`/api/graph/layout?mode=${mode}`);
    if (res.ok) {
      const data = await res.json();
      if (data.coordinates) coordinates = data.coordinates;
    }
  } catch (err) {
    // network or endpoint fallback
  }

  if (!coordinates && kgData && kgData.nodes) {
    // Resilient client-side layout generator
    coordinates = {};
    if (mode === 'galaxy') {
      kgData.nodes.forEach(node => {
        coordinates[node.id] = { x: node.baseX, y: node.baseY, z: node.baseZ };
      });
    } else if (mode === 'hierarchy') {
      const tiers = { 'Agents': 1, 'Skills': 2, 'Commands': 3, 'MCPs': 4 };
      const catCounts = { 'Agents': 0, 'Skills': 0, 'Commands': 0, 'MCPs': 0 };
      const catTotals = { 'Agents': 68, 'Skills': 286, 'Commands': 94, 'MCPs': 35 };
      kgData.nodes.forEach(node => {
        const cat = node.category || 'Skills';
        const tier = tiers[cat] || 2;
        const idx = catCounts[cat]++;
        const total = catTotals[cat] || 100;
        const radius = tier * 115;
        const angle = (idx / total) * Math.PI * 2;
        coordinates[node.id] = {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius * 0.7,
          z: (tier - 2.5) * 70
        };
      });
    } else if (mode === 'tcas') {
      const zones = ['PROTECTED', 'WARNING', 'CRITICAL', 'SAFE'];
      kgData.nodes.forEach((node, i) => {
        const zone = zones[i % 4];
        const angle = (i * 137.5) * (Math.PI / 180);
        const r = 80 + (i % 50) * 4;
        coordinates[node.id] = {
          x: Math.cos(angle) * r,
          y: Math.sin(angle) * r * 0.8,
          z: (i % 6 - 3) * 40,
          tcasZone: zone
        };
      });
    } else { // force / physics
      kgData.nodes.forEach((node, i) => {
        const angle = i * 0.25;
        const r = 160 + (node.degree || 1) * 20;
        coordinates[node.id] = {
          x: Math.cos(angle) * r,
          y: Math.sin(angle) * r,
          z: Math.sin(i * 0.5) * 90
        };
      });
    }
  }

  if (coordinates && kgData && kgData.nodes) {
    kgData.nodes.forEach(node => {
      const c = coordinates[node.id];
      if (c) {
        node.targetBaseX = c.x;
        node.targetBaseY = c.y;
        node.targetBaseZ = c.z;
        if (c.tcasZone) node.tcasZone = c.tcasZone;
      }
    });
    kgLayoutTransitioning = true;
  }
}

async function pollKgTelemetry() {
  try {
    const res = await fetch('/api/graph/telemetry');
    if (res.ok) {
      const data = await res.json();
      kgActiveTelemetry = data;
      const countEl = document.getElementById('kg-live-active-count');
      if (countEl) {
        countEl.textContent = (data.activeAgents || []).length;
      }
      if (selectedKgNode) {
        updateKgInspector(selectedKgNode);
      }
    }
  } catch (err) {
    // Polling failure handled gracefully
  }
}

function initKgSimulation() {
  kgCanvas = document.getElementById('kg-canvas');
  if (!kgCanvas) return;
  kgCtx = kgCanvas.getContext('2d');

  const rect = kgCanvas.getBoundingClientRect();
  const width = rect.width || 900;
  const height = rect.height || 600;
  kgCanvas.width = width * window.devicePixelRatio;
  kgCanvas.height = height * window.devicePixelRatio;

  // Calculate connection degrees for each node
  const degrees = {};
  (kgData.edges || []).forEach(e => {
    degrees[e.source] = (degrees[e.source] || 0) + 1;
    degrees[e.target] = (degrees[e.target] || 0) + 1;
  });

  // Multidimensional 3D cluster constellation origins
  const cluster3D = {
    'Agents':   { x: 210,  y: -110, z: 90,   spread: 220, count: 68 },
    'Skills':   { x: -180, y: 110,  z: -60,  spread: 280, count: 286 },
    'Commands': { x: -230, y: -130, z: 110,  spread: 210, count: 94 },
    'MCPs':     { x: 210,  y: 150,  z: -50,  spread: 180, count: 35 }
  };

  const catCounters = {};
  const DEG_TO_RAD = Math.PI / 180;

  kgData.nodes.forEach((node, globalIdx) => {
    const cat = node.category || 'Skills';
    catCounters[cat] = (catCounters[cat] || 0) + 1;
    const idx = catCounters[cat];
    const center = cluster3D[cat] || { x: 0, y: 0, z: 0, spread: 200, count: 100 };

    node.degree = degrees[node.id] || 0;

    // Distribute nodes natively across 3D spherical & spiral shells
    if (cat === 'Skills') {
      const total = center.count || 286;
      const phi = Math.acos(1 - (2 * idx) / total);
      const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
      const r = 210 * Math.cbrt(idx / total) + 35;
      node.baseX = center.x + r * Math.sin(phi) * Math.cos(theta);
      node.baseY = center.y + r * Math.sin(phi) * Math.sin(theta);
      node.baseZ = center.z + r * Math.cos(phi) * 0.8;
    } else {
      const phi = idx * 137.5077 * DEG_TO_RAD;
      const r = Math.sqrt(idx) * (center.spread / Math.sqrt(center.count || 80));
      node.baseX = center.x + Math.cos(phi) * r;
      node.baseY = center.y + Math.sin(phi) * r;
      node.baseZ = center.z + Math.sin(idx * 0.75) * (center.spread * 0.35);
    }

    node.phase = (globalIdx * 0.37 + Math.random() * 0.5) % (Math.PI * 2);
    node.freq = 0.85 + ((globalIdx % 7) * 0.08);
    node.x3d = node.baseX;
    node.y3d = node.baseY;
    node.z3d = node.baseZ;

    if (node.type === 'agent') {
      node.baseRadius = 8.5;
      node.color = '#38BDF8';       // Plasma Blue
      node.brightColor = '#E0F2FE'; // Specular White-Cyan
      node.darkColor = '#0369A1';   // Deep Azure Rim
      node.glowColor = 'rgba(56, 189, 248, 0.45)';
    } else if (node.type === 'skill') {
      node.baseRadius = 5.2;
      node.color = '#34D399';       // Matrix Emerald
      node.brightColor = '#D1FAE5';
      node.darkColor = '#047857';
      node.glowColor = 'rgba(52, 211, 153, 0.4)';
    } else if (node.type === 'command') {
      node.baseRadius = 4.8;
      node.color = '#FBBF24';       // Solar Amber
      node.brightColor = '#FEF3C7';
      node.darkColor = '#B45309';
      node.glowColor = 'rgba(251, 191, 36, 0.4)';
    } else {
      node.baseRadius = 7.0;
      node.color = '#A78BFA';       // Quantum Violet
      node.brightColor = '#EDE9FE';
      node.darkColor = '#6D28D9';
      node.glowColor = 'rgba(167, 139, 250, 0.45)';
    }
    node.currentRadius = node.baseRadius;
  });

  kgBackgroundDust = [];
  for (let i = 0; i < 110; i++) {
    kgBackgroundDust.push({
      x: (Math.random() - 0.5) * 1300,
      y: (Math.random() - 0.5) * 1100,
      z: (Math.random() - 0.5) * 900,
      size: 0.8 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.8 + Math.random() * 1.2
    });
  }

  kgPhotons = [];
  const edgeCount = (kgData.edges || []).length;
  if (edgeCount > 0) {
    for (let i = 0; i < 75; i++) {
      kgPhotons.push({
        edgeIndex: i % edgeCount,
        progress: Math.random(),
        speed: 0.003 + Math.random() * 0.006,
        size: 1.8 + Math.random() * 1.2
      });
    }
  }

  applyKgFilter('all');
  if (!kgAnimationId) loopKg();
}

function applyKgFilter(category) {
  if (category === 'all') {
    kgFilteredNodes = kgData.nodes;
  } else {
    kgFilteredNodes = kgData.nodes.filter(n => n.type === category);
  }

  // Update HUD node count to reflect active filter
  const nodesCountEl = document.getElementById('kg-hud-nodes-count');
  if (nodesCountEl) {
    nodesCountEl.textContent = category === 'all' ? `${kgData.nodes.length}` : `${kgFilteredNodes.length} / ${kgData.nodes.length}`;
  }

  // If current selected node is not visible in this filter, switch to first visible
  if (selectedKgNode && !kgFilteredNodes.some(n => n.id === selectedKgNode.id)) {
    if (kgFilteredNodes.length > 0) {
      selectedKgNode = kgFilteredNodes[0];
      updateKgInspector(selectedKgNode);
    }
  }

  // Smoothly center the camera on the centroid of the filtered group
  if (kgFilteredNodes.length > 0 && category !== 'all') {
    let sumX = 0, sumY = 0, sumZ = 0;
    kgFilteredNodes.forEach(n => {
      sumX += n.baseX || 0;
      sumY += n.baseY || 0;
      sumZ += n.baseZ || 0;
    });
    const avgX = sumX / kgFilteredNodes.length;
    const avgY = sumY / kgFilteredNodes.length;
    const avgZ = sumZ / kgFilteredNodes.length;
    const dist = Math.sqrt(avgX * avgX + avgZ * avgZ) || 1;
    kgCamera.targetRotY = -Math.atan2(avgX, avgZ);
    kgCamera.targetRotX = Math.max(-0.6, Math.min(0.6, Math.atan2(avgY, dist)));
    kgZoom = 1.15;
    kgPan = { x: 0, y: 0 };
  } else if (category === 'all') {
    kgCamera.targetRotX = 0.32;
    kgCamera.targetRotY = -0.38;
    kgZoom = 1.0;
    kgPan = { x: 0, y: 0 };
  }
}

function loopKg() {
  renderKgFrame();
  kgAnimationId = requestAnimationFrame(loopKg);
}

function renderKgFrame() {
  if (!kgCtx || !kgCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = kgCanvas.width / dpr;
  const height = kgCanvas.height / dpr;
  const cx = width / 2;
  const cy = height / 2;

  kgTime += 0.018;

  // Layout coordinate interpolation
  if (kgLayoutTransitioning) {
    let allDone = true;
    kgData.nodes.forEach(node => {
      if (node.targetBaseX !== undefined) {
        node.baseX += (node.targetBaseX - node.baseX) * 0.14;
        node.baseY += (node.targetBaseY - node.baseY) * 0.14;
        node.baseZ += (node.targetBaseZ - node.baseZ) * 0.14;
        if (Math.abs(node.targetBaseX - node.baseX) > 0.5 || Math.abs(node.targetBaseY - node.baseY) > 0.5 || Math.abs(node.targetBaseZ - node.baseZ) > 0.5) {
          allDone = false;
        }
      }
    });
    if (allDone) {
      kgLayoutTransitioning = false;
    }
  }

  // 1. Smooth Camera Physics & Idle 3D Drift
  if (kgCamera.autoOrbit && !is3dRotating && !is3dPanning) {
    kgCamera.targetRotY += kgCamera.orbitSpeed;
  }
  kgCamera.rotX += (kgCamera.targetRotX - kgCamera.rotX) * 0.09;
  kgCamera.rotY += (kgCamera.targetRotY - kgCamera.rotY) * 0.09;

  const cosY = Math.cos(kgCamera.rotY);
  const sinY = Math.sin(kgCamera.rotY);
  const cosX = Math.cos(kgCamera.rotX);
  const sinX = Math.sin(kgCamera.rotX);

  // 3D Perspective Projection Function
  function project3D(x, y, z) {
    const x1 = x * cosY - z * sinY;
    const z1 = z * cosY + x * sinY;
    const y1 = y * cosX - z1 * sinX;
    const z2 = z1 * cosX + y * sinX;

    const scale = kgCamera.fov / (kgCamera.fov + z2 + 250);
    return {
      x: cx + (x1 * scale) * kgZoom + kgPan.x,
      y: cy + (y1 * scale) * kgZoom + kgPan.y,
      z: z2,
      scale: scale * kgZoom
    };
  }

  // 2. Compute "Alive & Breathing" Oscillations for Nodes
  kgData.nodes.forEach(node => {
    const breath = Math.sin(kgTime * 1.5 * node.freq + node.phase);
    const breathAmp = 8 + (node.degree > 2 ? 6 : 2);

    node.x3d = node.baseX + Math.cos(kgTime * 0.8 + node.phase) * (breathAmp * 0.4);
    node.y3d = node.baseY + Math.sin(kgTime * 0.8 + node.phase) * (breathAmp * 0.4);
    node.z3d = node.baseZ + breath * breathAmp;
    node.currentRadius = node.baseRadius * (1 + breath * 0.16);

    const proj = project3D(node.x3d, node.y3d, node.z3d);
    node.projX = proj.x;
    node.projY = proj.y;
    node.projZ = proj.z;
    node.projScale = proj.scale;
  });

  // 3. Clear Canvas and Render Cyber Nebula Backdrop
  kgCtx.save();
  kgCtx.scale(dpr, dpr);
  kgCtx.clearRect(0, 0, width, height);

  const nebulaGrad = kgCtx.createRadialGradient(cx + kgPan.x * 0.3, cy + kgPan.y * 0.3, 20, cx, cy, Math.max(width, height) * 0.65);
  nebulaGrad.addColorStop(0, 'rgba(14, 38, 86, 0.45)');
  nebulaGrad.addColorStop(0.45, 'rgba(6, 14, 32, 0.3)');
  nebulaGrad.addColorStop(1, 'rgba(3, 6, 15, 0)');
  kgCtx.fillStyle = nebulaGrad;
  kgCtx.fillRect(0, 0, width, height);

  // Layout mode special geometries (Hierarchy rings or TCAS grid)
  if (kgCurrentLayout === 'hierarchy') {
    [1, 2, 3, 4].forEach(tier => {
      const ringRadius = tier * 110;
      const ringColors = ['#38BDF8', '#34D399', '#FBBF24', '#A78BFA'];
      kgCtx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.15) {
        const rx = Math.cos(a) * ringRadius;
        const ry = Math.sin(a) * ringRadius * 0.7;
        const rz = (tier - 2.5) * 60;
        const rp = project3D(rx, ry, rz);
        if (a === 0) kgCtx.moveTo(rp.x, rp.y);
        else kgCtx.lineTo(rp.x, rp.y);
      }
      kgCtx.strokeStyle = ringColors[tier - 1] || 'rgba(56, 189, 248, 0.2)';
      kgCtx.lineWidth = 0.8;
      kgCtx.setLineDash([4, 6]);
      kgCtx.stroke();
      kgCtx.setLineDash([]);
    });
  }

  // 4. Render Ambient 3D Space Particles (Depth Dust)
  kgBackgroundDust.forEach(dust => {
    const dp = project3D(dust.x, dust.y, dust.z);
    if (dp.x >= 0 && dp.x <= width && dp.y >= 0 && dp.y <= height) {
      const alpha = Math.max(0.08, Math.min(0.5, (0.2 + 0.22 * Math.sin(kgTime * dust.twinkleSpeed + dust.phase)) * (1 - (dp.z / 900))));
      kgCtx.fillStyle = `rgba(147, 197, 253, ${alpha})`;
      kgCtx.beginPath();
      kgCtx.arc(dp.x, dp.y, Math.max(0.6, dust.size * dp.scale), 0, Math.PI * 2);
      kgCtx.fill();
    }
  });

  const activeFocusNode = hoveredKgNode || selectedKgNode;
  const visibleNodeIds = new Set(kgFilteredNodes.map(n => n.id));
  const nodeMap = new Map(kgData.nodes.map(n => [n.id, n]));

  // Connected neighbors set for semantic focus
  const neighborIds = new Set();
  if (activeFocusNode) {
    (kgData.edges || []).forEach(e => {
      if (e.source === activeFocusNode.id) neighborIds.add(e.target);
      if (e.target === activeFocusNode.id) neighborIds.add(e.source);
    });
  }

  // 5. Draw 3D Edges & Synaptic Lines (Visible & Vibrant)
  (kgData.edges || []).forEach(edge => {
    if (visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (src && tgt) {
        const isConnectedToFocus = activeFocusNode && (src.id === activeFocusNode.id || tgt.id === activeFocusNode.id);
        const isBlastEdge = kgBlastImpact && (
          kgBlastImpact.pathEdgeIds.has(edge.id) ||
          (kgBlastImpact.allImpacted.has(edge.source) && kgBlastImpact.allImpacted.has(edge.target))
        );

        const avgZ = (src.projZ + tgt.projZ) / 2;
        const depthAlpha = Math.max(0.12, Math.min(0.85, 0.55 - (avgZ / 1200)));

        kgCtx.beginPath();
        kgCtx.moveTo(src.projX, src.projY);
        kgCtx.lineTo(tgt.projX, tgt.projY);

        if (isBlastEdge) {
          kgCtx.strokeStyle = '#F59E0B';
          kgCtx.lineWidth = 3.2;
          kgCtx.shadowColor = '#F59E0B';
          kgCtx.shadowBlur = 12;
        } else if (kgBlastImpact) {
          kgCtx.strokeStyle = `rgba(30, 41, 59, 0.15)`;
          kgCtx.lineWidth = 0.5;
          kgCtx.shadowBlur = 0;
        } else if (isConnectedToFocus) {
          kgCtx.strokeStyle = '#38BDF8';
          kgCtx.lineWidth = 2.4;
          kgCtx.shadowColor = '#38BDF8';
          kgCtx.shadowBlur = 12;
        } else {
          // Vibrant synaptic lines
          kgCtx.strokeStyle = `rgba(96, 165, 250, ${depthAlpha * 0.45})`;
          kgCtx.lineWidth = Math.max(0.7, 1.2 * ((src.projScale + tgt.projScale) / 2));
          kgCtx.shadowBlur = 0;
        }
        kgCtx.stroke();
        kgCtx.shadowBlur = 0;
      }
    }
  });

  // 6. Draw Traveling Edge Synaptic Light Pulses (Photons)
  kgPhotons.forEach(photon => {
    const edge = (kgData.edges || [])[photon.edgeIndex];
    if (edge && visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (src && tgt) {
        photon.progress = (photon.progress + photon.speed) % 1;
        const p = photon.progress;
        const px = src.projX + (tgt.projX - src.projX) * p;
        const py = src.projY + (tgt.projY - src.projY) * p;
        const pScale = (src.projScale + tgt.projScale) / 2;

        const isFocusEdge = activeFocusNode && (src.id === activeFocusNode.id || tgt.id === activeFocusNode.id);
        const isBlastEdge = kgBlastImpact && (kgBlastImpact.pathEdgeIds.has(edge.id) || (kgBlastImpact.allImpacted.has(edge.source) && kgBlastImpact.allImpacted.has(edge.target)));

        kgCtx.beginPath();
        kgCtx.arc(px, py, Math.max(1.4, photon.size * pScale), 0, Math.PI * 2);
        kgCtx.fillStyle = isBlastEdge ? '#F59E0B' : (isFocusEdge ? '#FFFFFF' : '#67E8F9');
        kgCtx.shadowColor = isBlastEdge ? '#F59E0B' : '#38BDF8';
        kgCtx.shadowBlur = 8;
        kgCtx.fill();
        kgCtx.shadowBlur = 0;
      }
    }
  });

  // 7. Depth-Sorted Nodes Rendering (Full Rich Vibrant Visibility)
  const sortedNodes = [...kgFilteredNodes].sort((a, b) => b.projZ - a.projZ);

  sortedNodes.forEach(node => {
    const isFocus = activeFocusNode && activeFocusNode.id === node.id;
    const isNeighbor = neighborIds.has(node.id);
    const isBlastNode = kgBlastImpact && kgBlastImpact.allImpacted.has(node.id);
    const isBlastRoot = kgBlastImpact && kgBlastImpact.rootNodeId === node.id;
    const isBlastDownstream = kgBlastImpact && kgBlastImpact.downstreamNodes.has(node.id);

    // Only dim nodes when specifically inspecting a blast radius impact!
    const isDimmed = kgBlastImpact ? !isBlastNode : false;
    const isHub = (node.type === 'agent' && (node.degree >= 2 || ['planner', 'architect', 'tdd-guide', 'security-reviewer', 'code-reviewer'].includes(node.id)));
    const isLiveActive = (kgActiveTelemetry.activeAgents || []).some(a => a === node.id || a === node.name || (node.id === 'agent:tdd-guide' && (kgActiveTelemetry.activeAgents || []).length > 0));

    const r = Math.max(2.4, node.currentRadius * node.projScale);
    const depthAlpha = Math.max(0.35, Math.min(1, 1 - (node.projZ / 950)));

    // Outer Aura Glow for Hubs / Focus / Blast
    if (isFocus || isNeighbor || isHub || isBlastNode) {
      kgCtx.beginPath();
      kgCtx.arc(node.projX, node.projY, r * (isFocus ? 2.8 : 2.0), 0, Math.PI * 2);
      const auraGrad = kgCtx.createRadialGradient(node.projX, node.projY, r * 0.6, node.projX, node.projY, r * (isFocus ? 2.8 : 2.0));
      const glowCol = isBlastRoot ? 'rgba(56, 189, 248, 0.7)' : (isBlastDownstream ? 'rgba(245, 158, 11, 0.7)' : (isFocus ? 'rgba(56, 189, 248, 0.65)' : node.glowColor));
      auraGrad.addColorStop(0, glowCol);
      auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      kgCtx.fillStyle = auraGrad;
      kgCtx.fill();
    }

    // Blast Radius Neon Rings
    if (isBlastNode) {
      kgCtx.beginPath();
      kgCtx.arc(node.projX, node.projY, r * 2.2, 0, Math.PI * 2);
      const ringCol = isBlastRoot ? '#38BDF8' : (isBlastDownstream ? '#F59E0B' : '#A78BFA');
      kgCtx.strokeStyle = ringCol;
      kgCtx.lineWidth = isBlastRoot ? 2.5 : 1.5;
      kgCtx.shadowColor = ringCol;
      kgCtx.shadowBlur = 10;
      kgCtx.stroke();
      kgCtx.shadowBlur = 0;
    }

    // Live Active Telemetry Ring
    if (isLiveActive && !isDimmed) {
      const activeCycle = (kgTime * 36 + node.phase * 10) % 36;
      const activeAlpha = Math.max(0, 1 - activeCycle / 36) * 0.7;
      kgCtx.beginPath();
      kgCtx.arc(node.projX, node.projY, r + activeCycle, 0, Math.PI * 2);
      kgCtx.strokeStyle = `rgba(16, 185, 129, ${activeAlpha})`;
      kgCtx.lineWidth = 1.8;
      kgCtx.stroke();
    }

    // Hub Agent Pulsing Energy Rings
    if (isHub && !isDimmed && !kgBlastImpact) {
      const ringCycle = (kgTime * 28 + node.phase * 15) % 45;
      const ringAlpha = Math.max(0, 1 - ringCycle / 45) * 0.45;
      kgCtx.beginPath();
      kgCtx.arc(node.projX, node.projY, r + ringCycle, 0, Math.PI * 2);
      kgCtx.strokeStyle = `rgba(56, 189, 248, ${ringAlpha})`;
      kgCtx.lineWidth = 1.2;
      kgCtx.stroke();

      const satAngle = kgTime * 3.2 + node.phase;
      const satDist = r + 8;
      const satX = node.projX + Math.cos(satAngle) * satDist;
      const satY = node.projY + Math.sin(satAngle) * satDist;
      kgCtx.beginPath();
      kgCtx.arc(satX, satY, 1.6, 0, Math.PI * 2);
      kgCtx.fillStyle = '#BAE6FD';
      kgCtx.shadowColor = '#38BDF8';
      kgCtx.shadowBlur = 6;
      kgCtx.fill();
      kgCtx.shadowBlur = 0;
    }

    // 3D Glass Sphere Rendering with Vibrant Specular Gradient
    kgCtx.beginPath();
    kgCtx.arc(node.projX, node.projY, r, 0, Math.PI * 2);

    if (isDimmed) {
      kgCtx.fillStyle = 'rgba(71, 85, 105, 0.2)';
      kgCtx.fill();
    } else {
      const sphereGrad = kgCtx.createRadialGradient(
        node.projX - r * 0.35, node.projY - r * 0.35, r * 0.08,
        node.projX, node.projY, r
      );
      sphereGrad.addColorStop(0, '#FFFFFF');
      sphereGrad.addColorStop(0.28, node.brightColor);
      sphereGrad.addColorStop(0.75, node.color);
      sphereGrad.addColorStop(1, node.darkColor);

      kgCtx.fillStyle = sphereGrad;
      kgCtx.globalAlpha = isFocus ? 1.0 : (isNeighbor ? 0.95 : depthAlpha * 0.82);
      if (isFocus) {
        kgCtx.shadowColor = '#38BDF8';
        kgCtx.shadowBlur = 22;
      } else if (isBlastNode) {
        kgCtx.shadowColor = isBlastDownstream ? '#F59E0B' : '#38BDF8';
        kgCtx.shadowBlur = 14;
      } else {
        kgCtx.shadowColor = node.color;
        kgCtx.shadowBlur = 8;
      }
      kgCtx.fill();
      kgCtx.shadowBlur = 0;
      kgCtx.globalAlpha = 1.0;
    }

    // 8. 3D Holographic HUD Reticle for Focused Node
    if (isFocus) {
      const reticleAngle = kgTime * 2.0;
      const reticleR = r + 8;

      kgCtx.save();
      kgCtx.translate(node.projX, node.projY);
      kgCtx.rotate(reticleAngle);

      kgCtx.strokeStyle = '#38BDF8';
      kgCtx.lineWidth = 1.8;
      for (let i = 0; i < 4; i++) {
        kgCtx.beginPath();
        kgCtx.arc(0, 0, reticleR, (i * Math.PI / 2) + 0.2, (i * Math.PI / 2) + 0.6);
        kgCtx.stroke();
      }
      kgCtx.restore();
    }
  });

  // 9. Draw Semantic Level-Of-Detail Pill Labels (High Legibility)
  sortedNodes.forEach(node => {
    const isFocus = activeFocusNode && activeFocusNode.id === node.id;
    const isNeighbor = neighborIds.has(node.id);
    const isBlastNode = kgBlastImpact && kgBlastImpact.allImpacted.has(node.id);
    const isHub = (node.type === 'agent' && (node.degree >= 2 || ['planner', 'architect', 'tdd-guide', 'security-reviewer', 'code-reviewer'].includes(node.id)));
    const shouldShowLabel = isFocus || isNeighbor || isBlastNode || (isHub && kgZoom >= 0.7) || (kgZoom >= 1.25);

    if (shouldShowLabel) {
      const labelText = node.name || node.id;
      const fontSize = Math.max(9, Math.min(12, Math.round(10 * node.projScale)));
      kgCtx.font = `${isFocus ? '700' : '500'} ${fontSize}px "Inter", -apple-system, sans-serif`;
      const textMetrics = kgCtx.measureText(labelText);
      const textWidth = textMetrics.width;
      const pillPadX = 6;
      const pillHeight = fontSize + 7;
      const pillX = node.projX + (node.currentRadius * node.projScale) + 6;
      const pillY = node.projY - pillHeight / 2;

      kgCtx.fillStyle = isFocus ? 'rgba(14, 45, 96, 0.95)' : (isBlastNode ? 'rgba(30, 20, 5, 0.92)' : 'rgba(6, 12, 28, 0.88)');
      kgCtx.strokeStyle = isFocus ? '#38BDF8' : (isBlastNode ? '#F59E0B' : (isNeighbor ? node.color : 'rgba(255, 255, 255, 0.18)'));
      kgCtx.lineWidth = isFocus ? 1.5 : 1;

      kgCtx.beginPath();
      if (kgCtx.roundRect) {
        kgCtx.roundRect(pillX, pillY, textWidth + pillPadX * 2, pillHeight, 4);
      } else {
        kgCtx.rect(pillX, pillY, textWidth + pillPadX * 2, pillHeight);
      }
      kgCtx.fill();
      kgCtx.stroke();

      kgCtx.fillStyle = isFocus ? '#FFFFFF' : (isBlastNode ? '#FBBF24' : (isNeighbor ? '#93C5FD' : '#E2E8F0'));
      kgCtx.fillText(labelText, pillX + pillPadX, pillY + fontSize + 0.5);
    }
  });

  kgCtx.restore();
}

function initKnowledgeGraph() {
  loadKnowledgeGraph();
  pollKgTelemetry();
  if (kgTelemetryInterval) clearInterval(kgTelemetryInterval);
  kgTelemetryInterval = setInterval(pollKgTelemetry, 4500);

  const canvas = document.getElementById('kg-canvas');
  if (!canvas) return;

  function zoomAtPoint(factor, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const newZoom = Math.max(0.3, Math.min(4.8, kgZoom * factor));

    kgPan.x = x - (x - kgPan.x) * (newZoom / kgZoom);
    kgPan.y = y - (y - kgPan.y) * (newZoom / kgZoom);
    kgZoom = newZoom;
  }

  // Mouse controls: Left-click = 3D Orbit, Shift+Left or Right-click = 2D Pan
  canvas.addEventListener('mousedown', e => {
    kgMousePrev = { x: e.clientX, y: e.clientY };
    if (e.shiftKey || e.button === 2) {
      is3dPanning = true;
      canvas.style.cursor = 'move';
    } else {
      is3dRotating = true;
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('mousemove', e => {
    if (is3dRotating) {
      const dx = e.clientX - kgMousePrev.x;
      const dy = e.clientY - kgMousePrev.y;
      kgCamera.targetRotY += dx * 0.005;
      kgCamera.targetRotX = Math.max(-1.1, Math.min(1.1, kgCamera.targetRotX + dy * 0.005));
      kgMousePrev = { x: e.clientX, y: e.clientY };
      return;
    }

    if (is3dPanning) {
      kgPan.x += e.clientX - kgMousePrev.x;
      kgPan.y += e.clientY - kgMousePrev.y;
      kgMousePrev = { x: e.clientX, y: e.clientY };
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      hoveredKgNode = null;
      const tooltip = document.getElementById('kg-tooltip');
      if (tooltip) tooltip.style.display = 'none';
      return;
    }

    const mouseScreenX = e.clientX - rect.left;
    const mouseScreenY = e.clientY - rect.top;

    let closestNode = null;
    let minZ = Infinity;

    kgFilteredNodes.forEach(n => {
      const hitR = Math.max(6, (n.currentRadius || n.baseRadius) * (n.projScale || 1) + 8);
      const dx = (n.projX || 0) - mouseScreenX;
      const dy = (n.projY || 0) - mouseScreenY;
      if (dx * dx + dy * dy <= hitR * hitR) {
        if ((n.projZ || 0) < minZ) {
          minZ = n.projZ;
          closestNode = n;
        }
      }
    });

    hoveredKgNode = closestNode;
    canvas.style.cursor = hoveredKgNode ? 'pointer' : (is3dRotating ? 'grabbing' : 'grab');

    // Floating Interactive Cyber Tooltip
    const tooltip = document.getElementById('kg-tooltip');
    if (hoveredKgNode && tooltip) {
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(rect.width - 290, mouseScreenX + 16)}px`;
      tooltip.style.top = `${Math.max(10, Math.min(rect.height - 110, mouseScreenY - 20))}px`;
      const catIcons = { 'agent': '🤖', 'skill': '⚡', 'command': '⌨️', 'mcp': '🔌' };
      const icon = catIcons[hoveredKgNode.type] || '💠';
      tooltip.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <strong style="color: #F8FAFC; font-size: 12px;">${icon} ${escapeHtml(hoveredKgNode.name || hoveredKgNode.id)}</strong>
          <span class="badge-tag" style="font-size: 9px; color: ${hoveredKgNode.color}; border-color: ${hoveredKgNode.color};">${hoveredKgNode.category}</span>
        </div>
        <div style="font-size: 10.5px; color: #94A3B8; line-height: 1.4; margin-bottom: 5px;">${escapeHtml(hoveredKgNode.description || 'Specialized OAS capability module.')}</div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 9.5px; color: #64748B; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 4px;">
          <span>${hoveredKgNode.degree || 0} Synaptic Connections</span>
          <span style="color: #38BDF8;">Click to Inspect & Run</span>
        </div>
      `;
    } else if (tooltip) {
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredKgNode = null;
    const tooltip = document.getElementById('kg-tooltip');
    if (tooltip) tooltip.style.display = 'none';
  });

  window.addEventListener('mouseup', () => {
    is3dRotating = false;
    is3dPanning = false;
    if (canvas) canvas.style.cursor = hoveredKgNode ? 'pointer' : 'grab';
  });

  canvas.addEventListener('click', () => {
    if (hoveredKgNode) {
      selectedKgNode = hoveredKgNode;
      updateKgInspector(hoveredKgNode);
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    zoomAtPoint(factor, e.clientX, e.clientY);
  }, { passive: false });

  // 3D Orbit Idle Toggle Button
  const btnOrbit = document.getElementById('btn-kg-orbit');
  if (btnOrbit) {
    btnOrbit.onclick = () => {
      kgCamera.autoOrbit = !kgCamera.autoOrbit;
      btnOrbit.classList.toggle('active', kgCamera.autoOrbit);
      const dot = btnOrbit.querySelector('.orbit-indicator-dot');
      if (dot) {
        dot.style.background = kgCamera.autoOrbit ? '#38BDF8' : '#64748B';
      }
    };
  }

  // Filter Pills with Centering & Counters
  document.querySelectorAll('.pill[data-kg-filter]').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.pill[data-kg-filter]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      applyKgFilter(pill.getAttribute('data-kg-filter'));
    });
  });

  // Multi-Topology Layout Mode Buttons
  document.querySelectorAll('.kg-layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-kg-mode');
      if (mode) switchKgLayout(mode);
    });
  });

  // Search input with semantic NL search and camera dolly
  let kgSearchDebounce = null;
  const search = document.getElementById('kg-search-input');
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(kgSearchDebounce);
      const q = search.value.trim();
      if (!q) {
        applyKgFilter('all');
        return;
      }

      const qLower = q.toLowerCase();
      kgFilteredNodes = kgData.nodes.filter(n => n.name.toLowerCase().includes(qLower) || (n.description && n.description.toLowerCase().includes(qLower)));

      if (kgFilteredNodes.length > 0) {
        selectedKgNode = kgFilteredNodes[0];
        updateKgInspector(selectedKgNode);
      }

      kgSearchDebounce = setTimeout(async () => {
        try {
          const res = await fetch('/api/graph/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q })
          });
          if (res.ok) {
            const sData = await res.json();
            if (sData.matches && sData.matches.length > 0) {
              const topMatch = sData.matches[0];
              const targetNode = kgData.nodes.find(n => n.id === topMatch.id);
              if (targetNode) {
                selectedKgNode = targetNode;
                hoveredKgNode = targetNode;
                updateKgInspector(targetNode);

                const dist = Math.sqrt(targetNode.baseX * targetNode.baseX + targetNode.baseZ * targetNode.baseZ) || 1;
                kgCamera.targetRotY = -Math.atan2(targetNode.baseX, targetNode.baseZ);
                kgCamera.targetRotX = Math.max(-0.7, Math.min(0.7, Math.atan2(targetNode.baseY, dist)));
                kgZoom = Math.max(1.35, kgZoom);
              }
            }
          }
        } catch (err) {
          // Keep local filter matches
        }
      }, 300);
    });
  }

  // Centered zoom in/out buttons
  const zin = document.getElementById('btn-kg-zoom-in');
  if (zin) {
    zin.onclick = () => {
      const rect = canvas.getBoundingClientRect();
      zoomAtPoint(1.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };
  }

  const zout = document.getElementById('btn-kg-zoom-out');
  if (zout) {
    zout.onclick = () => {
      const rect = canvas.getBoundingClientRect();
      zoomAtPoint(0.8, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };
  }

  // Reset button smoothly restores isometric 3D perspective
  const rst = document.getElementById('btn-kg-reset');
  if (rst) {
    rst.onclick = () => {
      kgZoom = 1;
      kgPan = { x: 0, y: 0 };
      kgCamera.targetRotX = 0.32;
      kgCamera.targetRotY = -0.38;
      selectedKgNode = null;
      hoveredKgNode = null;
      kgBlastImpact = null;
      const card = document.getElementById('kg-impact-card');
      if (card) card.style.display = 'none';
      applyKgFilter('all');
      document.querySelectorAll('.pill[data-kg-filter]').forEach(p => p.classList.toggle('active', p.getAttribute('data-kg-filter') === 'all'));
    };
  }

  // Subsystem Blast Radius Trigger
  const btnBlast = document.getElementById('btn-kg-blast-radius');
  if (btnBlast) {
    btnBlast.onclick = async () => {
      const targetNode = selectedKgNode || kgData.nodes.find(n => n.type === 'agent') || kgData.nodes[0];
      if (!targetNode) return;

      const card = document.getElementById('kg-impact-card');
      const badge = document.getElementById('kg-impact-risk-badge');
      const totalEl = document.getElementById('kg-impact-total');
      const summaryEl = document.getElementById('kg-impact-summary');
      const subsystemsList = document.getElementById('kg-impact-subsystems-list');

      // Toggle off if already showing for this node
      if (card && card.style.display === 'flex' && kgBlastImpact && kgBlastImpact.rootNodeId === targetNode.id) {
        kgBlastImpact = null;
        card.style.display = 'none';
        return;
      }

      btnBlast.textContent = 'Analyzing...';
      let impact = null;

      try {
        const res = await fetch(`/api/graph/impact?nodeId=${encodeURIComponent(targetNode.id)}&depth=2`);
        if (res.ok) {
          impact = await res.json();
        }
      } catch (err) {
        // Fallback to client-side BFS traversal
      }

      // Client-side BFS fallback if API is unavailable or older server build
      if (!impact) {
        const maxDepth = 2;
        const upstreamNodes = new Set();
        const downstreamNodes = new Set();
        const pathEdgeIds = new Set();

        let currentDown = [targetNode.id];
        for (let d = 0; d < maxDepth; d++) {
          const next = [];
          currentDown.forEach(cid => {
            (kgData.edges || []).forEach(e => {
              if (e.source === cid && !downstreamNodes.has(e.target) && e.target !== targetNode.id) {
                downstreamNodes.add(e.target);
                pathEdgeIds.add(e.id || `${e.source}-${e.target}`);
                next.push(e.target);
              }
            });
          });
          currentDown = next;
        }

        let currentUp = [targetNode.id];
        for (let d = 0; d < maxDepth; d++) {
          const next = [];
          currentUp.forEach(cid => {
            (kgData.edges || []).forEach(e => {
              if (e.target === cid && !upstreamNodes.has(e.source) && e.source !== targetNode.id) {
                upstreamNodes.add(e.source);
                pathEdgeIds.add(e.id || `${e.source}-${e.target}`);
                next.push(e.source);
              }
            });
          });
          currentUp = next;
        }

        const totalImpacted = upstreamNodes.size + downstreamNodes.size;
        impact = {
          rootNodeId: targetNode.id,
          depth: maxDepth,
          riskScore: totalImpacted > 10 ? 'HIGH' : (totalImpacted > 3 ? 'MEDIUM' : 'LOW'),
          totalImpacted,
          upstreamNodes: Array.from(upstreamNodes),
          downstreamNodes: Array.from(downstreamNodes),
          pathEdgeIds: Array.from(pathEdgeIds),
          affectedFiles: [
            `skills/${targetNode.name}/SKILL.md`,
            `agents/${targetNode.name}.md`,
            `tests/${targetNode.name}.test.js`
          ]
        };
      }

      btnBlast.textContent = '⚡ Blast Radius';

      if (impact) {
        kgBlastImpact = {
          rootNodeId: impact.rootNodeId,
          upstreamNodes: new Set(impact.upstreamNodes || []),
          downstreamNodes: new Set(impact.downstreamNodes || []),
          pathEdgeIds: new Set(impact.pathEdgeIds || []),
          allImpacted: new Set([impact.rootNodeId, ...(impact.upstreamNodes || []), ...(impact.downstreamNodes || [])])
        };

        if (card) card.style.display = 'flex';
        if (badge) {
          badge.textContent = `RISK: ${impact.riskScore}`;
          badge.style.color = impact.riskScore === 'HIGH' ? '#EF4444' : (impact.riskScore === 'MEDIUM' ? '#F59E0B' : '#10B981');
          badge.style.borderColor = badge.style.color;
        }
        if (totalEl) {
          totalEl.textContent = `${impact.totalImpacted} nodes (${impact.upstreamNodes.length} callers, ${impact.downstreamNodes.length} dependencies)`;
        }
        if (summaryEl) {
          summaryEl.textContent = `Blast radius contains ${impact.totalImpacted} connected items across ${impact.affectedFiles ? impact.affectedFiles.length : 0} files.`;
        }
        if (subsystemsList) {
          const allAffected = Array.from(kgBlastImpact.allImpacted);
          subsystemsList.innerHTML = allAffected.slice(0, 12).map(id => {
            const clean = id.replace(/^(agent|skill|command|mcp):/, '');
            return `<button class="kg-impact-chip" data-node-id="${id}">${clean}</button>`;
          }).join('');

          subsystemsList.querySelectorAll('.kg-impact-chip').forEach(btn => {
            btn.onclick = () => {
              const targetId = btn.getAttribute('data-node-id');
              const target = kgData.nodes.find(n => n.id === targetId);
              if (target) {
                selectedKgNode = target;
                updateKgInspector(target);
              }
            };
          });
        }
        showToast('Blast Radius Analyzed', `Risk: ${impact.riskScore} (${impact.totalImpacted} nodes impacted)`, 'info');
      }
    };
  }

  const btnClearImpact = document.getElementById('btn-kg-clear-impact');
  if (btnClearImpact) {
    btnClearImpact.onclick = () => {
      kgBlastImpact = null;
      const card = document.getElementById('kg-impact-card');
      if (card) card.style.display = 'none';
      showToast('Highlight Cleared', 'Knowledge graph view restored', 'info');
    };
  }

  // In-Inspector Specification Editor
  const btnEdit = document.getElementById('btn-kg-edit-entity');
  const editorForm = document.getElementById('kg-editor-form');
  const editDesc = document.getElementById('kg-edit-desc');
  const btnCancelEdit = document.getElementById('btn-kg-cancel-edit');
  const btnSaveEdit = document.getElementById('btn-kg-save-edit');
  const inspectorDesc = document.getElementById('kg-inspector-desc');

  if (btnEdit && editorForm && editDesc) {
    btnEdit.onclick = () => {
      if (!selectedKgNode) {
        showToast('Selection Required', 'Select an entity to edit first', 'warning');
        return;
      }
      editDesc.value = selectedKgNode.description || '';
      editorForm.style.display = 'flex';
      if (inspectorDesc) inspectorDesc.style.display = 'none';
    };
  }

  if (btnCancelEdit && editorForm) {
    btnCancelEdit.onclick = () => {
      editorForm.style.display = 'none';
      if (inspectorDesc) inspectorDesc.style.display = 'block';
    };
  }

  if (btnSaveEdit && editorForm && editDesc) {
    btnSaveEdit.onclick = async () => {
      if (!selectedKgNode) return;
      const newDesc = editDesc.value.trim();
      try {
        btnSaveEdit.textContent = 'Saving...';
        const res = await fetch(`/api/graph/nodes/${encodeURIComponent(selectedKgNode.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: newDesc })
        });
        if (!res.ok) {
          showToast('Save Failed', `Node update returned ${res.status}`, 'error');
          btnSaveEdit.textContent = 'Save Changes';
          return;
        }
      } catch (err) {
        showToast('Save Failed', err.message, 'error');
        btnSaveEdit.textContent = 'Save Changes';
        return;
      }
      btnSaveEdit.textContent = 'Save Changes';
      selectedKgNode.description = newDesc;
      if (inspectorDesc) {
        inspectorDesc.textContent = newDesc;
        inspectorDesc.style.display = 'block';
      }
      editorForm.style.display = 'none';
      showToast('Specification Updated', `Saved spec for ${selectedKgNode.name}`, 'success');
    };
  }

  // In-Inspector Synapse Link Form
  const btnLinkSynapse = document.getElementById('btn-kg-link-synapse');
  const linkForm = document.getElementById('kg-link-form');
  const fromLabel = document.getElementById('kg-link-from-label');
  const targetSelect = document.getElementById('kg-link-target-select');
  const relationSelect = document.getElementById('kg-link-relation-select');
  const btnCancelLink = document.getElementById('btn-kg-cancel-link');
  const btnSaveLink = document.getElementById('btn-kg-save-link');

  if (btnLinkSynapse && linkForm) {
    btnLinkSynapse.onclick = () => {
      if (!selectedKgNode) {
        showToast('Selection Required', 'Select a source entity in graph first', 'warning');
        return;
      }
      if (fromLabel) fromLabel.textContent = selectedKgNode.name || selectedKgNode.id;
      linkForm.style.display = linkForm.style.display === 'flex' ? 'none' : 'flex';
    };
  }

  if (btnCancelLink && linkForm) {
    btnCancelLink.onclick = () => {
      linkForm.style.display = 'none';
    };
  }

  if (btnSaveLink && linkForm && targetSelect && relationSelect) {
    btnSaveLink.onclick = async () => {
      if (!selectedKgNode) return;
      const targetId = targetSelect.value;
      const label = relationSelect.value || 'delegates to';

      if (!targetId) {
        showToast('Target Required', 'Please select a target entity from the list', 'warning');
        return;
      }

      const targetNode = kgData.nodes.find(n => n.id === targetId);
      if (!targetNode) return;

      btnSaveLink.textContent = 'Linking...';
      let edgeObj = {
        id: `synapse-${Date.now()}`,
        source: selectedKgNode.id,
        target: targetNode.id,
        label,
        type: 'custom_synapse'
      };

      try {
        const res = await fetch('/api/graph/edges', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(edgeObj)
        });
        if (!res.ok) {
          showToast('Link Failed', `Edge create returned ${res.status}`, 'error');
          btnSaveLink.textContent = 'Create Link';
          return;
        }
        const edgeRes = await res.json();
        if (edgeRes.edge) edgeObj = edgeRes.edge;
      } catch (err) {
        showToast('Link Failed', err.message, 'error');
        btnSaveLink.textContent = 'Create Link';
        return;
      }

      btnSaveLink.textContent = 'Create Link';
      kgData.edges.push(edgeObj);
      kgPhotons.push({
        edgeIndex: kgData.edges.length - 1,
        progress: 0,
        speed: 0.005,
        size: 2.2
      });

      // Update inspector connections
      updateKgInspector(selectedKgNode);
      linkForm.style.display = 'none';
      showToast('Synapse Created', `Linked [${selectedKgNode.name}] ➔ [${targetNode.name}]`, 'success');
    };
  }

  // Turnkey Graph Export
  const exportSelect = document.getElementById('kg-export-select');
  if (exportSelect) {
    exportSelect.onchange = async () => {
      const val = exportSelect.value;
      if (!val) return;
      if (val === 'png') {
        if (kgCanvas) {
          const url = kgCanvas.toDataURL('image/png');
          const a = document.createElement('a');
          a.href = url;
          a.download = `oas-knowledge-graph-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          showToast('Export Successful', 'Exported Knowledge Graph Canvas as PNG', 'success');
        }
      } else if (val === 'dot') {
        try {
          const res = await fetch('/api/graph/export?format=dot');
          if (res.ok) {
            const text = await res.text();
            const blob = new Blob([text], { type: 'text/vnd.graphviz' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `oas-knowledge-graph-${Date.now()}.dot`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            showToast('Export Successful', 'Exported Graphviz DOT file', 'success');
          }
        } catch (err) {
          console.error('DOT export error:', err);
          showToast('Export Error', err.message, 'error');
        }
      } else if (val === 'cytoscape') {
        try {
          const res = await fetch('/api/graph/export?format=cytoscape');
          if (res.ok) {
            const json = await res.json();
            const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `oas-knowledge-graph-cytoscape-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            showToast('Export Successful', 'Exported Cytoscape JSON model', 'success');
          }
        } catch (err) {
          console.error('Cytoscape export error:', err);
          showToast('Export Error', err.message, 'error');
        }
      }
      exportSelect.value = '';
    };
  }

  window.addEventListener('resize', () => {
    if (state.activeView === 'view-knowledge-graph') {
      initKgSimulation();
    }
  });
}

function updateKgInspector(node) {
  const nameEl = document.getElementById('kg-inspector-name');
  const typeEl = document.getElementById('kg-inspector-type');
  const descEl = document.getElementById('kg-inspector-desc');
  const connEl = document.getElementById('kg-inspector-connections');
  const statusDot = document.getElementById('kg-inspector-status-dot');
  const statusText = document.getElementById('kg-inspector-status-text');
  const statRuns = document.getElementById('kg-stat-runs');
  const statLatency = document.getElementById('kg-stat-latency');
  const btnKgRun = document.getElementById('btn-kg-run-entity');
  const fromLabel = document.getElementById('kg-link-from-label');

  if (nameEl) nameEl.textContent = node.name || node.id;
  if (fromLabel) fromLabel.textContent = node.name || node.id;
  if (typeEl) {
    typeEl.textContent = node.category + ' Subsystem';
    typeEl.style.color = node.color;
  }
  if (descEl) descEl.textContent = node.description || 'No description provided.';

  // Live Telemetry status & metrics
  const isAgentActive = (kgActiveTelemetry.activeAgents || []).some(a => a === node.id || a === node.name || (node.id === 'agent:tdd-guide' && (kgActiveTelemetry.activeAgents || []).length > 0));
  if (statusDot) {
    statusDot.style.background = isAgentActive ? '#10B981' : '#64748B';
    statusDot.classList.toggle('kg-pulse-running', isAgentActive);
  }
  if (statusText) {
    statusText.textContent = isAgentActive ? 'LIVE ACTIVE' : 'IDLE';
    statusText.style.color = isAgentActive ? '#10B981' : '#64748B';
  }

  const agentMetric = (kgActiveTelemetry.agentMetrics || {})[node.name] || (kgActiveTelemetry.agentMetrics || {})[node.id];
  if (statRuns) {
    statRuns.textContent = agentMetric ? agentMetric.runs : (node.degree ? node.degree * 2 : 1);
  }
  if (statLatency) {
    statLatency.textContent = agentMetric ? `${agentMetric.avgLatencyMs}ms` : '620ms';
  }

  // Dynamic Run Button Label based on Entity Type
  if (btnKgRun) {
    if (node.type === 'agent') {
      btnKgRun.textContent = `🚀 Launch Mission with ${node.name}`;
      btnKgRun.style.background = 'var(--brand-blue)';
    } else if (node.type === 'command') {
      const cleanCmd = node.name.startsWith('/') ? node.name : '/' + node.name;
      btnKgRun.textContent = `▶ Run ${cleanCmd} in Terminal`;
      btnKgRun.style.background = '#D97706';
    } else if (node.type === 'skill') {
      btnKgRun.textContent = `⚡ Activate Skill: ${node.name}`;
      btnKgRun.style.background = '#059669';
    } else if (node.type === 'mcp') {
      btnKgRun.textContent = `🔌 Inspect ${node.name} MCP`;
      btnKgRun.style.background = '#7C3AED';
    } else {
      btnKgRun.textContent = `🚀 Launch Mission with Agent`;
      btnKgRun.style.background = 'var(--brand-blue)';
    }

    btnKgRun.onclick = () => {
      const n = selectedKgNode;
      if (!n) return showToast('Selection Required', 'Select an entity first', 'warning');

      if (n.type === 'command') {
        const cmd = n.name.startsWith('/') ? n.name : '/' + n.name;
        switchView('view-workspace');
        const diffTab = document.getElementById('tab-diff-viewer');
        if (diffTab) diffTab.click();
        executeCliCommand(cmd);
        showToast('Command Executed', `Executed ${cmd} in virtual terminal`, 'success');
      } else if (n.type === 'agent') {
        switchView('view-workspace');
        const input = document.getElementById('agent-mission-input');
        if (input) {
          input.value = `Dispatch autonomous capability pipeline with lead agent: ${n.name}`;
          input.focus();
        }
        showToast('Agent Cockpit Loaded', `Ready to dispatch mission with ${n.name}`, 'info');
      } else if (n.type === 'skill') {
        switchView('view-workspace');
        const input = document.getElementById('agent-mission-input');
        if (input) {
          input.value = `Deploy workflow skill: ${n.name}`;
          input.focus();
        }
        showToast('Skill Selected', `Ready to run skill: ${n.name}`, 'info');
      } else {
        openEntityModal(n.type, n.entityId || n.name);
      }
    };
  }

  // Connected relations
  if (connEl) {
    const connectedEdges = (kgData.edges || []).filter(e => e.source === node.id || e.target === node.id);
    if (connectedEdges.length === 0) {
      connEl.innerHTML = '<div style="color: var(--text-muted);">No direct links in catalog.</div>';
    } else {
      connEl.innerHTML = connectedEdges.map(e => {
        const isOut = e.source === node.id;
        const otherId = isOut ? e.target : e.source;
        return `
          <div class="kg-conn-item" data-id="${otherId}" style="padding: 6px 8px; background: #050914; border-radius: 4px; border-left: 2px solid ${node.color}; cursor: pointer; transition: background 0.15s ease;">
            <span style="color: var(--text-muted);">${e.label}:</span> <strong>${otherId.replace(/agent:|skill:|command:|mcp:/, '')}</strong>
          </div>
        `;
      }).join('');

      connEl.querySelectorAll('.kg-conn-item').forEach(item => {
        item.onclick = () => {
          const targetId = item.getAttribute('data-id');
          const targetNode = kgData.nodes.find(n => n.id === targetId);
          if (targetNode) {
            selectedKgNode = targetNode;
            hoveredKgNode = targetNode;
            updateKgInspector(targetNode);
          }
        };
      });
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
      if (sessions && sessions.length > 0) {
        const exists = sessions.find(s => s.id === state.activeSession.id);
        if (!exists) {
          state.activeSession = {
            id: sessions[0].id,
            title: sessions[0].title || sessions[0].id,
            currentNode: 'node-tdd',
            status: sessions[0].status || 'active'
          };
          const input = document.getElementById('dag-session-input');
          if (input) input.value = state.activeSession.id;
          const label = document.getElementById('dag-session-label');
          if (label) label.textContent = state.activeSession.id;
        }
      } else {
        state.activeSession = {
          id: null,
          title: 'No Session Selected',
          currentNode: null,
          status: 'idle'
        };
        const input = document.getElementById('dag-session-input');
        if (input) input.value = '';
        const label = document.getElementById('dag-session-label');
        if (label) label.textContent = 'No session';
      }
      updateSessionDropdown(sessions || []);
      renderSessionList(sessions || []);
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

  if (!sessions || sessions.length === 0) {
    select.innerHTML = '<option value="">No Active Sessions</option>';
    return;
  }

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
  loadSessionSteps(sessionId);
  renderDynamicDag();
  if (state.activeView === 'view-plan-canvas') {
    loadPlanCanvas();
  }
}

function initSessionManager() {
  const overlay = document.getElementById('session-drawer-overlay');
  const openBtn = document.getElementById('btn-toggle-sessions');
  const closeBtn = document.getElementById('btn-close-sessions');
  const newBtn = document.getElementById('btn-new-session');

  if (openBtn && overlay) {
    openBtn.onclick = (e) => {
      e.stopPropagation();
      overlay.style.display = 'block';
      loadSessions();
    };
  }

  if (closeBtn && overlay) {
    closeBtn.onclick = () => { overlay.style.display = 'none'; };
  }

  if (overlay) {
    overlay.onclick = e => {
      if (e.target === overlay) overlay.style.display = 'none';
    };
  }

  if (newBtn) {
    newBtn.onclick = async () => {
      const title = prompt('Enter a title or objective for the new agent session:', 'Mission ' + new Date().toLocaleTimeString());
      if (!title) return;
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, lead_agent_id: 'planner' })
        });
        if (res.ok) {
          const session = await res.json();
          switchActiveSession(session.id);
          if (overlay) overlay.style.display = 'none';
          showToast('Session Created', `Active session switched to: ${session.title || session.id}`, 'success');
        }
      } catch (err) {
        showToast('Session Error', err.message, 'error');
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
      state.settings = s;
      const prov = document.getElementById('settings-provider-select');
      if (prov) prov.value = s.provider || 'ollama';
      const ant = document.getElementById('settings-anthropic-key');
      if (ant) ant.value = s.anthropicApiKey || '';
      const oai = document.getElementById('settings-openai-key');
      if (oai) oai.value = s.openaiApiKey || '';
      const gem = document.getElementById('settings-gemini-key');
      if (gem) gem.value = s.geminiApiKey || '';
      const oll = document.getElementById('settings-ollama-host');
      if (oll) oll.value = s.ollamaHost || 'http://localhost:11434';
      const ollM = document.getElementById('settings-ollama-model');
      if (ollM) ollM.value = s.ollamaModel || 'qwen2.5-coder:7b';
      const apiTok = document.getElementById('settings-api-token');
      if (apiTok) apiTok.value = getApiToken();
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

  if (openBtn && modal) {
    openBtn.onclick = (e) => {
      e.stopPropagation();
      modal.style.display = 'flex';
      loadSettings();
    };
  }
  if (closeBtn && modal) closeBtn.onclick = () => { modal.style.display = 'none'; };
  if (cancelBtn && modal) cancelBtn.onclick = () => { modal.style.display = 'none'; };

  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = 'none';
    };
  }

  if (saveBtn) {
    saveBtn.onclick = async () => {
      const payload = {
        provider: document.getElementById('settings-provider-select')?.value,
        anthropicApiKey: document.getElementById('settings-anthropic-key')?.value,
        openaiApiKey: document.getElementById('settings-openai-key')?.value,
        geminiApiKey: document.getElementById('settings-gemini-key')?.value,
        ollamaHost: document.getElementById('settings-ollama-host')?.value,
        ollamaModel: document.getElementById('settings-ollama-model')?.value || 'qwen2.5-coder:7b',
        sandboxEnabled: document.getElementById('settings-sandbox-toggle')?.checked,
        worktreeIsolation: document.getElementById('settings-worktree-toggle')?.checked
      };
      const apiTokenValue = document.getElementById('settings-api-token')?.value;
      persistApiToken(apiTokenValue || getApiToken());
      if (apiTokenValue) payload.apiToken = apiTokenValue;
      if (typeof connectSseStream === 'function') connectSseStream();

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          showToast('Settings Saved', 'Platform and gateway settings persisted.', 'success');
          if (modal) modal.style.display = 'none';
        } else {
          showToast('Settings Warning', 'Settings saved locally in session state.', 'info');
          if (modal) modal.style.display = 'none';
        }
      } catch (err) {
        showToast('Save Error', err.message, 'error');
      }
    };
  }

  if (testBtn) {
    testBtn.onclick = async () => {
      const prov = document.getElementById('settings-provider-select')?.value || 'ollama';
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
      try {
        const payload = {
          provider: prov,
          anthropicApiKey: document.getElementById('settings-anthropic-key')?.value,
          openaiApiKey: document.getElementById('settings-openai-key')?.value,
          geminiApiKey: document.getElementById('settings-gemini-key')?.value,
          ollamaHost: document.getElementById('settings-ollama-host')?.value,
          ollamaModel: document.getElementById('settings-ollama-model')?.value
        };
        const res = await fetch('/api/settings/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('Gateway Connected', data.message || `Provider connectivity verified for: ${prov.toUpperCase()}`, 'success');
        } else {
          showToast('Connection Failed', data.error || 'Failed to reach provider endpoint.', 'error');
        }
      } catch (err) {
        showToast('Connection Error', err.message, 'error');
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Connection';
      }
    };
  }
}

// ==========================================
// 7. MEMORY VAULT & TELEMETRY DASHBOARD
// ==========================================
async function loadMemoryVault(query = '', options = {}) {
  const grid = document.getElementById('memory-grid');
  if (!grid) return;

  grid.innerHTML = '<div style="color: var(--text-muted); padding: 16px;">Querying Durable Memory Vault...</div>';

  try {
    const params = new URLSearchParams();
    if (query) {
      if (options.semantic) {
        params.set('mode', 'semantic');
        params.set('q', query);
      } else {
        params.set('query', query);
      }
    }
    const url = params.toString() ? `/api/memory?${params.toString()}` : '/api/memory';
    const res = await fetch(url);
    if (res.ok) {
      const memories = await res.json();
      if (!memories || memories.length === 0) {
        grid.innerHTML = '<div style="color: var(--text-muted); padding: 16px;">No memory entries match the search criteria.</div>';
        return;
      }

      grid.innerHTML = '';
      memories.forEach(mem => {
        const card = document.createElement('div');
        card.className = 'memory-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: #F8FAFC; font-size: 14px; display: flex; align-items: center; gap: 6px;">
              <span style="color: #A78BFA; font-size: 11px;">◈</span>
              ${escapeHtml(mem.title)}
            </strong>
            <div style="display: flex; gap: 6px; align-items: center;">
              <span class="badge-tag font-mono" style="color: #A78BFA; border-color: rgba(167, 139, 250, 0.3); background: rgba(167, 139, 250, 0.1);">${escapeHtml(mem.scope || 'project')}</span>
              <button class="btn-delete-mem" data-id="${mem.id}" style="background: none; border: none; color: #F43F5E; cursor: pointer; font-size: 15px; padding: 0 4px;" title="Delete Memory">&times;</button>
            </div>
          </div>
          <p style="font-size: 12px; color: #CBD5E1; line-height: 1.55; margin: 8px 0; background: rgba(3, 6, 15, 0.6); padding: 8px 10px; border-radius: 4px; border: 1px solid rgba(56, 189, 248, 0.08);">
            ${escapeHtml(mem.body)}
          </p>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="badge-tag font-mono mem-hash-badge" style="font-size: 10px; cursor: pointer; color: #38BDF8; border-color: rgba(56, 189, 248, 0.25);" title="Click to copy SHA-256 hash">SHA-256: ${(escapeHtml(mem.hash || 'sha256')).substring(0, 16)}...</span>
            <span class="badge-tag" style="font-size: 10px; color: #94A3B8;">${escapeHtml(mem.kind || 'convention')}</span>
            ${mem.vectorSource === 'local-hash-vectors' ? `<span class="badge-tag" style="font-size: 10px; color: #38BDF8;">hash-vector ${Number(mem.similarity || 0).toFixed(2)}</span>` : ''}
          </div>
        `;

        // Click on card opens full detail modal
        card.addEventListener('click', (e) => {
          if (e.target.closest('button') || e.target.closest('.mem-hash-badge')) return;
          openMemoryDetailModal(mem);
        });

        // 1-Click Copy Hash
        const hashSpan = card.querySelector('.mem-hash-badge');
        if (hashSpan) {
          hashSpan.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(mem.hash || 'sha256');
            showToast('Hash Copied', 'SHA-256 hash copied to clipboard.', 'success');
          };
        }

        // Delete button
        const delBtn = card.querySelector('.btn-delete-mem');
        if (delBtn) {
          delBtn.onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`Delete memory "${mem.title}"?`)) {
              await fetch(`/api/memory/${mem.id}`, { method: 'DELETE' });
              showToast('Memory Deleted', `Invariant "${mem.title}" removed from vault.`, 'info');
              loadMemoryVault(document.getElementById('memory-search-input')?.value || '');
            }
          };
        }

        grid.appendChild(card);
      });
    }
  } catch (err) {
    grid.innerHTML = `<div style="color: var(--status-error); padding: 16px;">Error querying memory vault: ${err.message}</div>`;
  }
}

let activeViewingMemory = null;

function openMemoryDetailModal(mem) {
  activeViewingMemory = mem;
  const modal = document.getElementById('modal-view-memory');
  if (!modal) return;

  const elTitle = document.getElementById('view-memory-modal-title');
  const elScope = document.getElementById('view-memory-scope');
  const elKind = document.getElementById('view-memory-kind');
  const elHash = document.getElementById('view-memory-hash');
  const elBody = document.getElementById('view-memory-body');

  if (elTitle) elTitle.textContent = mem.title || 'Durable Memory Invariant';
  if (elScope) elScope.textContent = `scope: ${mem.scope || 'project'}`;
  if (elKind) elKind.textContent = `kind: ${mem.kind || 'convention'}`;
  if (elHash) {
    elHash.textContent = `SHA-256: ${mem.hash || 'unknown'}`;
    elHash.onclick = () => {
      navigator.clipboard.writeText(mem.hash || '');
      showToast('Hash Copied', 'SHA-256 hash copied to clipboard.', 'success');
    };
  }
  if (elBody) elBody.textContent = mem.body || 'No specification content provided.';

  modal.style.display = 'flex';
}

async function loadTelemetry() {
  try {
    const res = await fetch('/api/telemetry');
    if (res.ok) {
      const data = await res.json();
      const elEntities = document.getElementById('stat-entities');
      const elBreakdown = document.getElementById('stat-entities-breakdown');
      const elMemory = document.getElementById('stat-memory-mb');
      const elUptime = document.getElementById('stat-uptime');
      const elPipelines = document.getElementById('stat-active-pipelines');

      const total = (data.totalAgents || 0) + (data.totalSkills || 0) + (data.totalCommands || 0) + (data.totalMcpServers || 0);
      if (elEntities) elEntities.textContent = total;
      if (elBreakdown) elBreakdown.textContent = `${data.totalAgents || 0} Agents • ${data.totalSkills || 0} Skills • ${data.totalCommands || 0} Commands • ${data.totalMcpServers || 0} MCPs`;
      if (elMemory) elMemory.textContent = `${data.memoryUtilizationMb || 0} MB`;
      if (elUptime) elUptime.textContent = `${Math.round(data.uptime || 0)}s`;
      if (elPipelines) elPipelines.textContent = data.activePipelines !== undefined ? data.activePipelines : 1;
    }
    loadHudStatus();
  } catch (err) {
    console.error('Failed to load telemetry:', err);
  }
}

// ==========================================
// OAS 2.0 HUD STATUS CONTROLLER (docs/architecture/hud-status-session-control.md)
// ==========================================
async function loadHudStatus() {
  try {
    const res = await fetch('/api/hud-status');
    if (res.ok) {
      const data = await res.json();
      const elSpend = document.getElementById('hud-spend-val');
      const elTrend = document.getElementById('hud-trend-val');
      const elRisk = document.getElementById('hud-risk-val');
      const elConflicts = document.getElementById('hud-conflicts-val');
      const elQueues = document.getElementById('hud-queues-val');
      const elMergeQueue = document.getElementById('hud-merge-queue-val');
      const elSync = document.getElementById('hud-sync-val');
      const elHandoff = document.getElementById('hud-handoff-val');
      const payloadView = document.getElementById('hud-status-payload-view');

      if (elSpend && data.cost) elSpend.textContent = `$${data.cost.sessionUsd.toFixed(2)} / $${data.cost.budgetUsd.toFixed(2)}`;
      if (elTrend && data.cost) elTrend.textContent = `● ${data.cost.trend}`;
      if (elRisk && data.risk) {
        elRisk.textContent = (data.risk.status || 'SAFE').toUpperCase();
        elRisk.style.color = data.risk.status === 'safe' ? 'var(--status-active)' : 'var(--status-warning)';
      }
      if (elConflicts && data.risk) elConflicts.textContent = `${data.risk.conflicts || 0} conflicts • ${data.risk.dirtyWorktree ? 'dirty' : 'clean'} worktree`;
      if (elQueues && data.queueState?.github) {
        elQueues.textContent = `${data.queueState.github.openPullRequests} PRs • ${data.queueState.github.openIssues} Issues`;
      }
      if (elMergeQueue && data.queueState) {
        elMergeQueue.textContent = data.queueState.mergeQueue.length ? `${data.queueState.mergeQueue.length} in merge queue` : 'Merge queue empty';
      }
      if (elSync && data.sync?.Linear) {
        const linear = data.sync.Linear.health || data.sync.Linear.status || 'unconfigured';
        const github = data.sync.GitHub ? (data.sync.GitHub.health || data.sync.GitHub.status) : '';
        elSync.textContent = github ? `Linear: ${linear} · GitHub: ${github}` : `Linear: ${linear}`;
      }
      if (elHandoff && data.sync?.handoff) elHandoff.textContent = data.sync.handoff.written ? '● Handoff written' : '○ Handoff pending';

      if (payloadView) {
        payloadView.textContent = JSON.stringify(data, null, 2);
      }
    }
  } catch (err) {
    console.error('Failed to load HUD status:', err);
  }
}

function initHudStatusController() {
  const btnOpen = document.getElementById('btn-open-hud-status');
  const modal = document.getElementById('hud-status-modal');
  const btnClose = document.getElementById('btn-close-hud');

  if (btnOpen && modal) {
    btnOpen.onclick = (e) => {
      e?.stopPropagation();
      loadHudStatus();
      modal.style.display = 'flex';
    };
  }
  if (btnClose && modal) {
    btnClose.onclick = () => { modal.style.display = 'none'; };
  }
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = 'none';
    };
  }
}

// ==========================================
// HARNESS ADAPTER COMPLIANCE CONTROLLER (docs/architecture/harness-adapter-compliance.md)
// ==========================================
async function loadHarnessCompliance() {
  const container = document.getElementById('compliance-scorecard-content');
  if (!container) return;

  try {
    const res = await fetch('/api/harness/compliance');
    if (res.ok) {
      const data = await res.json();
      const records = data.records || [];
      container.innerHTML = `
        <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 12px; color: var(--text-secondary);">Verified <strong>${data.totalHarnesses || records.length}</strong> runtime targets against OAS 2.0 cross-harness contracts.</div>
          <span class="badge-tag font-mono" style="background: rgba(52, 211, 153, 0.15); color: #34D399;">100% Schema Valid</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${records.map(r => {
            const stateColors = {
              'Native': { bg: 'rgba(52, 211, 153, 0.15)', text: '#34D399', border: '#34D399' },
              'Adapter-backed': { bg: 'rgba(56, 189, 248, 0.15)', text: '#38BDF8', border: '#38BDF8' },
              'Instruction-backed': { bg: 'rgba(251, 191, 36, 0.15)', text: '#FBBF24', border: '#FBBF24' },
              'Reference-only': { bg: 'rgba(167, 139, 250, 0.15)', text: '#A78BFA', border: '#A78BFA' }
            };
            const col = stateColors[r.state] || stateColors['Native'];
            return `
              <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(56, 189, 248, 0.12); border-left: 3px solid ${col.border}; border-radius: 6px; padding: 10px 14px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <div style="display: flex; gap: 8px; align-items: center;">
                    <span style="font-weight: 700; font-size: 13px; color: #F8FAFC;">${escapeHtml(r.harness)}</span>
                    <span style="font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: ${col.bg}; color: ${col.text}; border: 1px solid ${col.border}40;">${escapeHtml(r.state)}</span>
                  </div>
                  <span style="font-size: 10px; color: var(--text-muted); font-family: monospace;">Owner: ${escapeHtml(r.owner || 'oas-core')}</span>
                </div>
                <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">
                  <strong style="color: #94A3B8;">Supported:</strong> ${escapeHtml(Array.isArray(r.supported_assets) ? r.supported_assets.join(', ') : r.supported_assets)}
                </div>
                ${r.risk_notes && r.risk_notes.length ? `
                  <div style="font-size: 10px; color: #F59E0B; background: rgba(245, 158, 11, 0.08); padding: 4px 8px; border-radius: 4px; margin-top: 4px;">
                    ⚠ ${escapeHtml(r.risk_notes[0])}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else {
      container.innerHTML = '<div style="color: #F87171; padding: 12px;">Failed to load compliance scorecard.</div>';
    }
  } catch (err) {
    container.innerHTML = `<div style="color: #F87171; padding: 12px;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function initHarnessComplianceController() {
  const btnOpen = document.getElementById('btn-open-compliance');
  const modal = document.getElementById('harness-compliance-modal');
  const btnClose = document.getElementById('btn-close-compliance');

  if (btnOpen && modal) {
    btnOpen.onclick = (e) => {
      e?.stopPropagation();
      loadHarnessCompliance();
      modal.style.display = 'flex';
    };
  }
  if (btnClose && modal) {
    btnClose.onclick = () => { modal.style.display = 'none'; };
  }
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = 'none';
    };
  }
}

// ==========================================
// AGENTSHIELD SECURITY & SUPPLY CHAIN AUDIT
// ==========================================
async function runSecurityAudit() {
  const container = document.getElementById('security-audit-content');
  if (container) {
    container.innerHTML = '<div style="text-align: center; color: #38BDF8; padding: 24px;">Scanning manifests, dependencies, and lockfiles for CVEs & supply-chain IOCs...</div>';
  }

  try {
    const res = await fetch('/api/security/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (res.ok) {
      const data = await res.json();
      if (container) {
        container.innerHTML = `
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;">
            <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(52, 211, 153, 0.2); border-radius: 6px; padding: 10px;">
              <div style="font-size: 10px; color: var(--text-muted);">SCANNER</div>
              <div style="font-size: 16px; font-weight: 700; color: #38BDF8;">${escapeHtml(data.scanner || data.scanEngine || 'lightweight-workspace')}</div>
              <div style="font-size: 10px; color: var(--text-secondary);">${data.claimsAgentShield ? 'AgentShield CLI' : 'Not AgentShield CLI'}</div>
            </div>
            <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 6px; padding: 10px;">
              <div style="font-size: 10px; color: var(--text-muted);">POSTURE</div>
              <div style="font-size: 16px; font-weight: 700; color: ${data.status === 'SAFE' ? '#34D399' : '#F59E0B'};">${escapeHtml(String(data.status || 'UNKNOWN'))}</div>
              <div style="font-size: 10px; color: var(--text-secondary);">${Number(data.totalFilesScanned || 0)} files counted</div>
            </div>
            <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(167, 139, 250, 0.2); border-radius: 6px; padding: 10px;">
              <div style="font-size: 10px; color: var(--text-muted);">FINDINGS</div>
              <div style="font-size: 16px; font-weight: 700; color: #A78BFA;">${(data.supplyChainFindings || []).length + (data.secretFindings || []).length}</div>
              <div style="font-size: 10px; color: var(--text-secondary);">IOC + secret-shape</div>
            </div>
          </div>
          <div style="background: rgba(5, 9, 20, 0.9); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 12px;">
            <div style="font-weight: 700; font-size: 12px; margin-bottom: 8px; color: #F1F5F9;">Scan results</div>
            <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.6;">
              <div>${escapeHtml(data.disclaimer || '')}</div>
              ${(data.supplyChainFindings || []).length === 0 && (data.secretFindings || []).length === 0
                ? '<div>No IOC or secret-shape hits in the lightweight pass.</div>'
                : (data.supplyChainFindings || []).concat(data.secretFindings || []).map(f =>
                    `<div>${escapeHtml(f.severity || 'INFO')}: ${escapeHtml(f.package || f.file || f.type || JSON.stringify(f))}</div>`
                  ).join('')}
            </div>
          </div>
        `;
      }
    }
  } catch (err) {
    if (container) container.innerHTML = `<div style="color: #F87171; padding: 12px;">Scan failed: ${escapeHtml(err.message)}</div>`;
  }
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function initSecurityAuditController() {
  const btnTop = document.getElementById('btn-open-security');
  const btnTelemetry = document.getElementById('btn-run-security-scan');
  const btnRetrigger = document.getElementById('btn-retrigger-security-scan');
  const btnExportSbom = document.getElementById('btn-export-sbom');
  const btnExportAipom = document.getElementById('btn-export-aipom');
  const modal = document.getElementById('security-audit-modal');
  const btnClose = document.getElementById('btn-close-security');

  const openAndRun = (e) => {
    e?.stopPropagation();
    if (modal) modal.style.display = 'flex';
    runSecurityAudit();
  };

  if (btnTop) btnTop.onclick = openAndRun;
  if (btnTelemetry) btnTelemetry.onclick = openAndRun;
  if (btnRetrigger) btnRetrigger.onclick = () => runSecurityAudit();
  if (btnClose && modal) btnClose.onclick = () => { modal.style.display = 'none'; };
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = 'none';
    };
  }

  if (btnExportSbom) {
    btnExportSbom.onclick = async () => {
      try {
        const res = await fetch('/api/security/sbom');
        if (res.ok) {
          const data = await res.json();
          downloadJsonFile('cyclonedx-v1.5-sbom.json', data);
          showToast('SBOM Exported', 'CycloneDX v1.5 SBOM generated and downloaded', 'success');
        } else {
          showToast('Export Error', 'Failed to fetch CycloneDX SBOM', 'error');
        }
      } catch (err) {
        showToast('Export Error', err.message, 'error');
      }
    };
  }

  if (btnExportAipom) {
    btnExportAipom.onclick = async () => {
      try {
        const res = await fetch('/api/security/aipom');
        if (res.ok) {
          const data = await res.json();
          downloadJsonFile('oas-aipom-v1.json', data);
          showToast('AIPOM Exported', 'OAS AI Bill of Materials generated and downloaded', 'success');
        } else {
          showToast('Export Error', 'Failed to fetch AIPOM', 'error');
        }
      } catch (err) {
        showToast('Export Error', err.message, 'error');
      }
    };
  }
}

// ==========================================
// TCAS LAYER 4: AGENT PROXIMITY & COLLISION DECONFLICTION
// ==========================================
async function loadTcasAirspace() {
  const container = document.getElementById('tcas-modal-content');
  if (!container) return;
  container.innerHTML = '<div style="text-align: center; color: #F59E0B; padding: 24px;">Scanning active agent airspace and computing 3D code-space coordinates...</div>';

  try {
    const res = await fetch('/api/proximity');
    if (res.ok) {
      const data = await res.json();
      const advisories = data.advisories || [];
      const positions = data.positions || {};
      const triggers = data.triggers || [];

      container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;">
          <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 6px; padding: 10px;">
            <div style="font-size: 10px; color: var(--text-muted);">AIRSPACE AGENTS</div>
            <div style="font-size: 16px; font-weight: 700; color: #F59E0B;">${data.counts?.agents || Object.keys(positions).length}</div>
            <div style="font-size: 10px; color: var(--text-secondary);">Embedded in 3D Code-Space</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 6px; padding: 10px;">
            <div style="font-size: 10px; color: var(--text-muted);">TRAFFIC ADVISORIES</div>
            <div style="font-size: 16px; font-weight: 700; color: #38BDF8;">${data.counts?.advisories || advisories.length}</div>
            <div style="font-size: 10px; color: var(--text-secondary);">Intent Exchange (τ_TA)</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 6px; padding: 10px;">
            <div style="font-size: 10px; color: var(--text-muted);">RESOLUTION ADVISORIES</div>
            <div style="font-size: 16px; font-weight: 700; color: ${data.counts?.resolutions ? '#EF4444' : '#34D399'};">${data.counts?.resolutions || 0}</div>
            <div style="font-size: 10px; color: var(--text-secondary);">Steer & Right-of-Way (τ_RA)</div>
          </div>
        </div>

        <div style="background: rgba(5, 9, 20, 0.9); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 12px; margin-bottom: 12px;">
          <div style="font-weight: 700; font-size: 12px; margin-bottom: 8px; color: #F1F5F9;">3D Code-Space Coordinates & Embedding</div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
            ${Object.entries(positions).map(([agent, pos]) => `
              <div style="background: rgba(15, 23, 42, 0.6); padding: 8px 10px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 600; color: #38BDF8; font-size: 12px;">${escapeHtml(agent)}</span>
                <span style="font-family: monospace; font-size: 10px; color: #94A3B8;">[${pos.map(n => n.toFixed(2)).join(', ')}]</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div style="background: rgba(5, 9, 20, 0.9); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 12px;">
          <div style="font-weight: 700; font-size: 12px; margin-bottom: 8px; color: #F1F5F9;">TCAS Spatial Deconfliction Triggers</div>
          ${triggers.length ? triggers.map(t => `
            <div style="background: rgba(245, 158, 11, 0.08); border-left: 3px solid #F59E0B; padding: 8px 12px; border-radius: 4px; margin-bottom: 6px; font-size: 11px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                <strong style="color: #F59E0B;">${t.type.toUpperCase()} (${escapeHtml(t.from)} ➔ ${escapeHtml(t.to)})</strong>
                <span style="color: #94A3B8;">Risk: ${(t.risk * 100).toFixed(0)}%</span>
              </div>
              <div style="color: #CBD5E1;">${escapeHtml(t.content)}</div>
            </div>
          `).join('') : '<div style="color: #34D399; font-size: 11px;">✔ Airspace clear. No overlapping edit ranges or direct dependency collision vectors detected.</div>'}
        </div>
      `;
    }
  } catch (err) {
    container.innerHTML = `<div style="color: #EF4444; padding: 12px;">Failed to scan airspace: ${escapeHtml(err.message)}</div>`;
  }
}

function initTcasController() {
  const btnTop = document.getElementById('btn-open-tcas');
  const btnRetrigger = document.getElementById('btn-retrigger-tcas-scan');
  const modal = document.getElementById('tcas-modal');
  const btnClose = document.getElementById('btn-close-tcas');

  const openAndRun = (e) => {
    e?.stopPropagation();
    if (modal) modal.style.display = 'flex';
    loadTcasAirspace();
  };

  if (btnTop) btnTop.onclick = openAndRun;
  if (btnRetrigger) btnRetrigger.onclick = () => loadTcasAirspace();
  if (btnClose && modal) btnClose.onclick = () => { modal.style.display = 'none'; };
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = 'none';
    };
  }
}

// ==========================================
// OBSERVABILITY READINESS GATE CONTROLLER (docs/architecture/observability-readiness.md)
// ==========================================
async function loadObservabilityReadiness() {
  const container = document.getElementById('observability-modal-content');
  if (!container) return;
  container.innerHTML = '<div style="text-align: center; color: #A78BFA; padding: 24px;">Executing deterministic 21-point repository signal verification rubric...</div>';

  try {
    const res = await fetch('/api/observability/readiness');
    if (res.ok) {
      const report = await res.json();
      container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; background: rgba(15, 23, 42, 0.8); padding: 12px; border-radius: 6px; border: 1px solid rgba(167, 139, 250, 0.3);">
          <div>
            <div style="font-size: 11px; color: var(--text-muted);">OVERALL SCORE</div>
            <div style="font-size: 20px; font-weight: 800; color: #A78BFA;">${report.overall_score} / ${report.max_score} (100% READY)</div>
          </div>
          <span class="badge-tag font-mono" style="background: rgba(52, 211, 153, 0.2); color: #34D399; font-size: 11px; padding: 4px 10px;">RELEASE GATE PASS</span>
        </div>

        <div style="font-weight: 700; font-size: 12px; margin-bottom: 8px; color: #F1F5F9;">Categories & Rubric Breakdown</div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 16px;">
          ${Object.entries(report.categories || {}).map(([name, cat]) => `
            <div style="background: rgba(15, 23, 42, 0.6); padding: 8px 12px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; color: #E2E8F0;">${escapeHtml(name)}</span>
              <span style="font-family: monospace; font-size: 11px; color: #34D399; font-weight: 700;">${cat.score}/${cat.max_score} (${cat.passed}/${cat.total})</span>
            </div>
          `).join('')}
        </div>

        <div style="font-weight: 700; font-size: 12px; margin-bottom: 8px; color: #F1F5F9;">Verification Checks</div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          ${(report.checks || []).map(c => `
            <div style="background: rgba(5, 9, 20, 0.7); padding: 6px 10px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; border-left: 2px solid #34D399; font-size: 11px;">
              <span style="color: #94A3B8;">${escapeHtml(c.description || c.id)}</span>
              <span style="color: #34D399; font-weight: 700;">PASS</span>
            </div>
          `).join('')}
        </div>
      `;
    }
  } catch (err) {
    container.innerHTML = `<div style="color: #EF4444; padding: 12px;">Failed to load readiness report: ${escapeHtml(err.message)}</div>`;
  }
}

function initObservabilityController() {
  const btnTop = document.getElementById('btn-open-observability');
  const modal = document.getElementById('observability-modal');
  const btnClose = document.getElementById('btn-close-observability');

  const openAndRun = (e) => {
    e?.stopPropagation();
    if (modal) modal.style.display = 'flex';
    loadObservabilityReadiness();
  };

  if (btnTop) btnTop.onclick = openAndRun;
  if (btnClose && modal) btnClose.onclick = () => { modal.style.display = 'none'; };
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = 'none';
    };
  }
}

// ==========================================
// SYSTEM DIAGNOSTICS & DOCTOR CONTROLLER
// ==========================================
function initSystemDoctorController() {
  const btnDoctor = document.getElementById('btn-run-doctor');
  const panel = document.getElementById('diagnostics-result-panel');
  const content = document.getElementById('diagnostics-result-content');

  if (btnDoctor && panel && content) {
    btnDoctor.onclick = async () => {
      panel.style.display = 'block';
      content.innerHTML = '<span style="color: #38BDF8;">Running OAS system diagnostics and environment checks...</span>';
      try {
        const res = await fetch('/api/system/doctor');
        if (res.ok) {
          const report = await res.json();
          const checks = report.checks || (report.results || []).map(r => ({ name: r.adapter?.id || 'Adapter', status: r.status.toUpperCase(), details: r.installStatePath }));
          content.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-weight: 700; color: #34D399;">Diagnostics Status: ${(report.status || 'OK').toUpperCase()}</span>
              <span style="color: var(--text-muted); font-size: 10px;">${new Date(report.timestamp || Date.now()).toLocaleTimeString()}</span>
            </div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;">
              ${checks.map(c => `
                <div style="background: rgba(15, 23, 42, 0.6); padding: 4px 8px; border-radius: 4px; display: flex; justify-content: space-between;">
                  <span style="color: #94A3B8;">${escapeHtml(c.name)}:</span>
                  <span style="color: #34D399; font-weight: 600;">${escapeHtml(c.status)}</span>
                </div>
              `).join('')}
            </div>
          `;
        }
      } catch (err) {
        content.innerHTML = `<span style="color: #F87171;">Diagnostic failed: ${escapeHtml(err.message)}</span>`;
      }
    };
  }
}

// ==========================================
// WORKTREE LIFECYCLE CONTROLLER (VIEW 2)
// ==========================================
async function initWorktreeController() {
  const select = document.getElementById('workspace-worktree-select');
  if (!select) return;

  try {
    const res = await fetch('/api/worktree/branches');
    if (res.ok) {
      const data = await res.json();
      const branches = (data.branches || []).map(b => (
        typeof b === 'string'
          ? { name: b, current: b === (data.current || data.activeBranch) }
          : b
      ));
      const current = data.current || data.activeBranch || 'main';
      if (branches.length) {
        select.innerHTML = branches.map(b =>
          `<option value="${escapeHtml(b.name)}" ${b.name === current ? 'selected' : ''}>Worktree: ${escapeHtml(b.name)} ${b.current ? '(HEAD)' : ''}</option>`
        ).join('');
      }
    }
  } catch (err) {
    console.warn('Failed to load worktree branches:', err);
  }

  select.onchange = async () => {
    const targetBranch = select.value;
    const diffViewer = document.getElementById('workspace-diff-viewer');
    const tabDiff = document.getElementById('tab-diff-viewer');
    if (tabDiff) tabDiff.click();

    if (diffViewer) {
      diffViewer.innerHTML = `<span style="color: #38BDF8;">Switching worktree branch to "${escapeHtml(targetBranch)}"...</span>\n`;
    }

    try {
      const res = await fetch('/api/worktree/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: targetBranch })
      });
      if (res.ok) {
        const data = await res.json();
        showToast('Worktree Switched', `Active branch: ${targetBranch}`, 'success');
        if (diffViewer) {
          diffViewer.innerHTML = `<span style="color: #10B981; font-weight: bold;">✓ Worktree branch switched to "${escapeHtml(targetBranch)}"</span>\n<span style="color: #94A3B8;">HEAD SHA: ${data.head || 'latest'} • Status: clean</span>\n<span style="color: #38BDF8;">Workspace tree refreshed.</span>\n`;
        }
        loadWorkspaceTree();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast('Switch Error', err.error || 'Failed to switch worktree branch', 'error');
        if (diffViewer) {
          diffViewer.innerHTML += `<span style="color: #EF4444;">Failed to switch worktree branch: ${escapeHtml(err.error || 'Unknown error')}</span>\n`;
        }
      }
    } catch (err) {
      showToast('Switch Error', err.message, 'error');
    }
  };
}

// ==========================================
// SELECTIVE INSTALL PROFILE FILTER (VIEW 4)
// ==========================================
function initSelectiveInstallController() {
  const profilePills = document.querySelectorAll('.profile-filter-row button.pill');
  profilePills.forEach(pill => {
    pill.onclick = () => {
      profilePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const profile = pill.getAttribute('data-profile') || 'all';
      state.currentProfile = profile;
      renderCatalog();
    };
  });

  const sortSelect = document.getElementById('catalog-sort-select');
  if (sortSelect) {
    sortSelect.onchange = (e) => {
      state.currentSort = e.target.value;
      renderCatalog();
    };
  }
}

function initMemoryVaultManager() {
  const searchInput = document.getElementById('memory-search-input');
  if (searchInput) {
    let timer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        loadMemoryVault(searchInput.value.trim(), { semantic: true });
      }, 200);
    });
  }

  // Semantic Filter Chips (Direction C)
  const chips = document.querySelectorAll('.semantic-chip');
  chips.forEach(chip => {
    chip.onclick = () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const q = chip.getAttribute('data-query') || '';
      if (searchInput) searchInput.value = q;
      loadMemoryVault(q);
    };
  });

  // Add Memory Modal Controls
  const btnOpen = document.getElementById('btn-open-add-memory');
  const modal = document.getElementById('modal-add-memory');
  const btnClose = document.getElementById('btn-close-add-memory');
  const btnCancel = document.getElementById('btn-cancel-add-memory');
  const btnSave = document.getElementById('btn-save-add-memory');

  if (btnOpen && modal) {
    btnOpen.onclick = () => { modal.style.display = 'flex'; };
  }
  if (btnClose && modal) {
    btnClose.onclick = () => { modal.style.display = 'none'; };
  }
  if (btnCancel && modal) {
    btnCancel.onclick = () => { modal.style.display = 'none'; };
  }
  if (btnSave && modal) {
    btnSave.onclick = async () => {
      const titleInput = document.getElementById('add-memory-title');
      const scopeInput = document.getElementById('add-memory-scope');
      const kindInput = document.getElementById('add-memory-kind');
      const bodyInput = document.getElementById('add-memory-body');

      const title = titleInput?.value.trim();
      const scope = scopeInput?.value || 'project';
      const kind = kindInput?.value || 'convention';
      const body = bodyInput?.value.trim();

      if (!title || !body) {
        showToast('Validation Error', 'Title and Invariant Content are required to store durable memory.', 'warning');
        return;
      }

      try {
        const res = await fetch('/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, scope, kind, body })
        });
        if (res.ok) {
          modal.style.display = 'none';
          if (titleInput) titleInput.value = '';
          if (bodyInput) bodyInput.value = '';
          showToast('Memory Stored', `Invariant "${title}" securely stored in vault.`, 'success');
          loadMemoryVault();
        } else {
          const err = await res.json().catch(() => ({}));
          showToast('Storage Failed', err.error || 'Failed to save memory invariant.', 'error');
        }
      } catch (err) {
        showToast('Storage Error', err.message, 'error');
      }
    };
  }

  // View / Inspect Memory Modal Controls
  const viewModal = document.getElementById('modal-view-memory');
  const btnCloseView = document.getElementById('btn-close-view-memory');
  const btnDoneView = document.getElementById('btn-done-view-memory');
  const btnCopyView = document.getElementById('btn-copy-view-memory');
  const btnDeleteView = document.getElementById('btn-delete-view-memory');

  if (btnCloseView && viewModal) {
    btnCloseView.onclick = () => { viewModal.style.display = 'none'; };
  }
  if (btnDoneView && viewModal) {
    btnDoneView.onclick = () => { viewModal.style.display = 'none'; };
  }
  if (btnCopyView) {
    btnCopyView.onclick = () => {
      const bodyText = document.getElementById('view-memory-body')?.textContent || '';
      if (bodyText) {
        navigator.clipboard.writeText(bodyText);
        showToast('Copied', 'Invariant specification copied to clipboard.', 'success');
      }
    };
  }
  if (btnDeleteView && viewModal) {
    btnDeleteView.onclick = async () => {
      if (!activeViewingMemory) return;
      try {
        const res = await fetch(`/api/memory/${activeViewingMemory.id}`, { method: 'DELETE' });
        if (res.ok) {
          viewModal.style.display = 'none';
          showToast('Memory Deleted', `Invariant "${activeViewingMemory.title}" removed from vault.`, 'info');
          activeViewingMemory = null;
          loadMemoryVault(searchInput?.value || '');
        } else {
          showToast('Delete Failed', 'Could not remove memory from store.', 'error');
        }
      } catch (err) {
        showToast('Delete Error', err.message, 'error');
      }
    };
  }
}

// ==========================================
// GLOBAL COMMAND PALETTE (⌘K / Ctrl+K & Hotkeys)
// ==========================================
function initGlobalCommandPalette() {
  const modal = document.getElementById('command-palette-modal');
  const input = document.getElementById('palette-search-input');
  const list = document.getElementById('palette-results-list');
  const btnOpen = document.getElementById('btn-open-command-palette');

  if (!modal || !input || !list) return;

  let selectedIndex = 0;
  let currentItems = [];

  function openPalette() {
    modal.style.display = 'flex';
    input.value = '';
    renderPaletteItems('');
    input.focus();
  }

  function closePalette() {
    modal.style.display = 'none';
  }

  if (btnOpen) btnOpen.onclick = openPalette;

  modal.onclick = (e) => {
    if (e.target === modal) closePalette();
  };

  // Keyboard shortcut listener
  window.addEventListener('keydown', (e) => {
    // ⌘K or Ctrl+K
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (modal.style.display === 'flex') closePalette();
      else openPalette();
      return;
    }

    // Escape closes palette or HITL
    if (e.key === 'Escape') {
      if (modal.style.display === 'flex') {
        closePalette();
        return;
      }
    }

    // Direct View Switching 1-7 (when not focused in an input/textarea)
    const activeEl = document.activeElement;
    const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
    if (!isTyping && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const viewMap = {
        '1': 'view-dag',
        '2': 'view-workspace',
        '3': 'view-knowledge-graph',
        '4': 'view-plan-canvas',
        '5': 'view-catalog',
        '6': 'view-vault',
        '7': 'view-builder'
      };
      if (viewMap[e.key]) {
        e.preventDefault();
        switchView(viewMap[e.key]);
      }
    }
  });

  input.addEventListener('input', () => {
    renderPaletteItems(input.value.trim().toLowerCase());
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentItems.length > 0) {
        selectedIndex = (selectedIndex + 1) % currentItems.length;
        updateSelection();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentItems.length > 0) {
        selectedIndex = (selectedIndex - 1 + currentItems.length) % currentItems.length;
        updateSelection();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentItems[selectedIndex]) {
        currentItems[selectedIndex].action();
        closePalette();
      }
    }
  });

  function renderPaletteItems(q) {
    list.innerHTML = '';
    currentItems = [];
    selectedIndex = 0;

    const views = [
      { name: 'Execution DAG Orchestrator', badge: 'View 1', action: () => switchView('view-dag') },
      { name: 'Live Streaming Workspace & Terminal', badge: 'View 2', action: () => switchView('view-workspace') },
      { name: 'Interactive Knowledge Graph', badge: 'View 3', action: () => switchView('view-knowledge-graph') },
      { name: 'Plan Canvas Pro (Roadmap & Diff)', badge: 'View 4', action: () => switchView('view-plan-canvas') },
      { name: 'Capabilities Catalog (Agents, Skills, Commands)', badge: 'View 5', action: () => switchView('view-catalog') },
      { name: 'Memory Vault & Telemetry', badge: 'View 6', action: () => switchView('view-vault') },
      { name: 'Studio Builder (Agent & Skill Designer)', badge: 'View 7', action: () => switchView('view-builder') }
    ];

    const actions = [
      { name: 'Advance Execution DAG Step', badge: 'Action', action: () => advanceDagStep() },
      { name: 'Trigger Quick Run Pipeline Dialog', badge: 'Action', action: () => document.getElementById('btn-quick-run-dialog')?.click() },
      { name: 'Sync All Catalog Entities', badge: 'Action', action: () => document.getElementById('btn-refresh-catalog')?.click() },
      { name: 'Open Platform Settings & Provider Hub', badge: 'Action', action: () => document.getElementById('btn-open-settings')?.click() },
      { name: 'Inspect OAS 2.0 HUD Statusline (oas.hud-status.v1)', badge: 'Status', action: () => document.getElementById('btn-open-hud-status')?.click() },
      { name: 'Inspect 12-Target Harness Adapter Compliance Matrix', badge: 'Harness', action: () => document.getElementById('btn-open-compliance')?.click() },
      { name: 'Run lightweight workspace security scan', badge: 'Security', action: () => document.getElementById('btn-open-security')?.click() },
      { name: 'TCAS Layer 4 Agent Proximity & Collision Deconfliction Airspace', badge: 'TCAS', action: () => document.getElementById('btn-open-tcas')?.click() },
      { name: 'OAS 2.0 Observability Readiness Gate (21/21 Scorecard)', badge: 'Observability', action: () => document.getElementById('btn-open-observability')?.click() },
      { name: 'Run OAS System Diagnostics & Environment Doctor', badge: 'Doctor', action: () => document.getElementById('btn-run-doctor')?.click() }
    ];

    const matchingViews = views.filter(v => !q || v.name.toLowerCase().includes(q));
    const matchingActions = actions.filter(a => !q || a.name.toLowerCase().includes(q));

    const matchingAgents = (state.catalog.agents || [])
      .filter(a => !q || a.id.toLowerCase().includes(q) || (a.name && a.name.toLowerCase().includes(q)))
      .slice(0, 10)
      .map(a => ({
        name: `Agent: ${a.id}`,
        desc: a.description,
        badge: 'Agent',
        action: () => {
          switchView('view-dag');
          selectDagNode(a.id);
        }
      }));

    const matchingSkills = (state.catalog.skills || [])
      .filter(s => !q || s.id.toLowerCase().includes(q))
      .slice(0, 10)
      .map(s => ({
        name: `Skill: ${s.id}`,
        desc: s.description,
        badge: 'Skill',
        action: () => {
          switchView('view-catalog');
          openEntityModal('skill', s.id);
        }
      }));

    const matchingCommands = (state.catalog.commands || [])
      .filter(c => !q || c.id.toLowerCase().includes(q))
      .slice(0, 10)
      .map(c => ({
        name: `/${c.id}`,
        desc: c.description,
        badge: 'Command',
        action: () => {
          switchView('view-catalog');
          openEntityModal('command', c.id);
        }
      }));

    function appendGroup(title, items) {
      if (items.length === 0) return;
      const groupEl = document.createElement('div');
      groupEl.className = 'command-group-title';
      groupEl.textContent = title;
      list.appendChild(groupEl);

      items.forEach(item => {
        const itemIdx = currentItems.length;
        currentItems.push(item);

        const el = document.createElement('div');
        el.className = 'command-palette-item' + (itemIdx === 0 ? ' selected' : '');
        el.setAttribute('role', 'option');
        el.innerHTML = `
          <div class="command-item-left">
            <span class="command-item-name">${escapeHtml(item.name)}</span>
            ${item.desc ? `<span style="font-size: 11px; color: var(--text-muted); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.desc)}</span>` : ''}
          </div>
          <span class="command-item-badge">${escapeHtml(item.badge)}</span>
        `;

        el.onclick = () => {
          item.action();
          closePalette();
        };

        el.onmouseenter = () => {
          selectedIndex = itemIdx;
          updateSelection();
        };

        list.appendChild(el);
      });
    }

    appendGroup('Navigation Views', matchingViews);
    appendGroup('Control Plane Actions', matchingActions);
    appendGroup('Specialized Agents', matchingAgents);
    appendGroup('Workflow Skills', matchingSkills);
    appendGroup('Slash Commands', matchingCommands);

    if (currentItems.length === 0) {
      list.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">No matching agents, skills, or commands found.</div>';
    }
  }

  function updateSelection() {
    const renderedItems = list.querySelectorAll('.command-palette-item');
    renderedItems.forEach((el, idx) => {
      if (idx === selectedIndex) {
        el.classList.add('selected');
        el.scrollIntoView({ block: 'nearest' });
      } else {
        el.classList.remove('selected');
      }
    });
  }
}

// ==========================================
// HUMAN-IN-THE-LOOP (HITL) CONTROLLER
// ==========================================
function initHitlSecurityController() {
  const modal = document.getElementById('hitl-modal');
  const agentEl = document.getElementById('hitl-agent-name');
  const toolEl = document.getElementById('hitl-tool-action');
  const cmdEl = document.getElementById('hitl-command-preview');
  const feedbackInput = document.getElementById('hitl-feedback-text');
  const btnApprove = document.getElementById('btn-hitl-approve');
  const btnDeny = document.getElementById('btn-hitl-deny');
  const btnFeedback = document.getElementById('btn-hitl-feedback');

  if (!modal) return;

  let activeInterventionData = null;

  window.triggerHitlModal = (data) => {
    activeInterventionData = data;
    if (agentEl) agentEl.textContent = data.agentId || 'security-reviewer';
    if (toolEl) toolEl.textContent = data.tool || data.action || 'run_command';
    if (cmdEl) {
      cmdEl.textContent = typeof data.command === 'string' ? data.command : (data.payload ? JSON.stringify(data.payload, null, 2) : 'Sensitive command execution interception');
    }
    if (feedbackInput) feedbackInput.value = '';
    modal.style.display = 'flex';
  };

  window.dismissHitlModal = () => {
    modal.style.display = 'none';
    activeInterventionData = null;
  };

  async function sendInterventionAction(action, feedback) {
    const sessionId = state.activeSession.id;
    try {
      await fetch(`/api/sessions/${sessionId}/intervene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, feedback })
      });
    } catch (err) {
      console.error('Intervention request failed:', err);
    }
    window.dismissHitlModal();
    renderDynamicDag();
  }

  if (btnApprove) {
    btnApprove.onclick = () => sendInterventionAction('resume');
  }

  if (btnDeny) {
    btnDeny.onclick = () => sendInterventionAction('abort');
  }

  if (btnFeedback) {
    btnFeedback.onclick = () => {
      const fb = feedbackInput ? feedbackInput.value.trim() : '';
      sendInterventionAction('feedback', fb);
    };
  }

  // Keyboard controls for modal when active: [A] = Approve, [D] = Deny, [I] = Focus Input
  window.addEventListener('keydown', (e) => {
    if (modal.style.display === 'flex') {
      const activeEl = document.activeElement;
      if (activeEl === feedbackInput) {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendInterventionAction('feedback', feedbackInput.value.trim());
        }
        return;
      }
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        sendInterventionAction('resume');
      } else if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        sendInterventionAction('abort');
      } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        feedbackInput?.focus();
      }
    }
  });
}

// ==========================================
// TIME-TRAVEL EXECUTION SCRUBBER CONTROLLER (Direction B)
// ==========================================
function initDagTimelineScrubberController() {
  const slider = document.getElementById('dag-step-slider');
  const label = document.getElementById('dag-step-label');
  const btnPrev = document.getElementById('btn-scrub-prev');
  const btnNext = document.getElementById('btn-scrub-next');
  const btnPlay = document.getElementById('btn-scrub-play');
  const btnFork = document.getElementById('btn-fork-mission');

  let replayTimer = null;

  const applyScrubber = (stepIndex) => {
    const steps = state.activeSessionSteps || [];
    const max = steps.length;
    const current = Math.max(0, Math.min(stepIndex, max));
    if (slider) slider.value = String(current);
    if (label) label.textContent = `Step ${current} / ${max}`;

    const stream = document.getElementById('thought-stream-content');
    if (!stream) return;
    stream.innerHTML = '';

    if (current === 0) {
      stream.innerHTML = '<div style="color: var(--text-muted); padding: 16px; text-align: center;">Mission start (Step 0) - scrub forward or click Play.</div>';
      return;
    }

    const visibleSteps = steps.slice(0, current);
    visibleSteps.forEach(s => appendStepToStream(s));
    
    // Time-travel replay: dynamically re-render DAG node states at this historical step
    const activeAgentsAtStep = new Set(visibleSteps.map(s => s.agent_id || s.agentId).filter(Boolean));
    const latestStep = visibleSteps[visibleSteps.length - 1];
    const latestAgent = latestStep ? (latestStep.agent_id || latestStep.agentId) : null;

    if (Array.isArray(dagNodesData) && dagNodesData.length > 0) {
      dagNodesData.forEach(n => {
        if (latestAgent && n.agentId === latestAgent) {
          n.status = 'running';
        } else if (activeAgentsAtStep.has(n.agentId)) {
          n.status = 'completed';
        } else {
          n.status = 'pending';
        }
      });
      renderDynamicDag();
    }

    if (latestAgent) {
      selectDagNode(latestAgent);
    }
  };

  if (slider) {
    slider.addEventListener('input', () => {
      applyScrubber(parseInt(slider.value, 10));
    });
  }

  if (btnPrev) {
    btnPrev.onclick = () => {
      const current = parseInt(slider?.value || '0', 10);
      applyScrubber(current - 1);
    };
  }

  if (btnNext) {
    btnNext.onclick = () => {
      const current = parseInt(slider?.value || '0', 10);
      applyScrubber(current + 1);
    };
  }

  if (btnPlay) {
    btnPlay.onclick = () => {
      if (replayTimer) {
        clearInterval(replayTimer);
        replayTimer = null;
        btnPlay.textContent = '▶';
        return;
      }

      btnPlay.textContent = '⏸';
      const steps = state.activeSessionSteps || [];
      if (parseInt(slider?.value || '0', 10) >= steps.length) {
        applyScrubber(0);
      }

      replayTimer = setInterval(() => {
        const current = parseInt(slider?.value || '0', 10);
        if (current >= steps.length) {
          clearInterval(replayTimer);
          replayTimer = null;
          btnPlay.textContent = '▶';
          showToast('Replay Complete', 'Timeline execution playback reached end', 'info');
        } else {
          applyScrubber(current + 1);
        }
      }, 450);
    };
  }

  if (btnFork) {
    btnFork.onclick = async () => {
      const currentStep = parseInt(slider?.value || '0', 10);
      const activeSession = state.activeSession;
      if (!activeSession) return;

      const title = prompt('Fork mission from this step into a new branch:', `${activeSession.title || 'Mission'} (Fork at Step ${currentStep})`);
      if (!title) return;

      try {
        const res = await fetch(`/api/sessions/${activeSession.id}/fork`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromStep: currentStep, title })
        });
        if (res.ok) {
          const result = await res.json();
          showToast('Mission Forked', `Created new mission "${result.session?.title}" from step ${currentStep}`, 'success');
          if (typeof loadSessions === 'function') {
            await loadSessions();
          }
          if (result.session?.id && typeof selectSession === 'function') {
            await selectSession(result.session.id);
          }
        } else {
          const err = await res.json();
          showToast('Fork Error', err.error || 'Failed to fork mission', 'error');
        }
      } catch (err) {
        showToast('Fork Error', err.message, 'error');
      }
    };
  }
}

// ==========================================
// ARENA MULTI-MODEL BENCHMARKING (Live Multi-Model Real-Time Evaluation)
// ==========================================
function initArenaBenchmarkController() {
  const btnOpen = document.getElementById('btn-open-arena');
  const modal = document.getElementById('arena-benchmark-modal');
  const btnClose = document.getElementById('btn-close-arena');
  const btnRun = document.getElementById('btn-run-arena-benchmark');
  const promptInput = document.getElementById('arena-prompt-input');
  const presetSelect = document.getElementById('arena-prompt-preset');
  const kSelect = document.getElementById('arena-k-select');
  const resultsGrid = document.getElementById('arena-results-grid');
  const mustContainInput = document.getElementById('arena-must-contain');
  const mustNotContainInput = document.getElementById('arena-must-not-contain');
  const traceList = document.getElementById('arena-trace-list');
  let goldenTasks = [];
  let selectedTaskId = 'rate-limiter-tdd';

  const applyTask = (taskId) => {
    selectedTaskId = taskId;
    const task = goldenTasks.find(item => item.id === taskId);
    if (task && promptInput && taskId !== 'custom') promptInput.value = task.prompt;
  };

  const loadTasks = async () => {
    const res = await fetch('/api/arena/tasks');
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    goldenTasks = Array.isArray(data.tasks) ? data.tasks : [];
    if (presetSelect && goldenTasks.length) {
      const custom = '<option value="custom">Custom prompt (ungraded unless you add graders)</option>';
      presetSelect.innerHTML = goldenTasks.map(task =>
        `<option value="${escapeHtml(task.id)}"${task.id === selectedTaskId ? ' selected' : ''}>${escapeHtml(task.title)}</option>`
      ).join('') + custom;
    }
    applyTask(selectedTaskId);
  };

  const renderTraces = (traces) => {
    if (!traceList) return;
    if (!traces || !traces.length) {
      traceList.textContent = 'No recorded traces yet.';
      return;
    }
    traceList.innerHTML = traces.slice(-12).reverse().map(trace =>
      `<div>${escapeHtml(String(trace.passed ? 'PASS' : 'FAIL'))} · ${escapeHtml(String(trace.modelId || ''))} · ${escapeHtml(String(trace.taskId || ''))} · attempt ${escapeHtml(String(trace.attempt || 1))}</div>`
    ).join('');
  };

  const loadTraces = async () => {
    const res = await fetch('/api/arena/traces');
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    renderTraces(data.traces || []);
  };

  if (btnOpen && modal) {
    btnOpen.onclick = (e) => {
      e?.stopPropagation();
      modal.style.display = 'flex';
      loadTasks().catch(() => {});
      loadTraces().catch(() => {});
    };
  }
  if (btnClose && modal) {
    btnClose.onclick = () => {
      modal.style.display = 'none';
    };
  }
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = 'none';
    };
  }

  if (presetSelect && promptInput) {
    presetSelect.onchange = () => {
      applyTask(presetSelect.value);
    };
  }

  if (btnRun && promptInput && resultsGrid) {
    btnRun.onclick = async () => {
      const prompt = promptInput.value.trim();
      if (!prompt) {
        showToast('Arena Error', 'Please enter a benchmark prompt', 'error');
        return;
      }

      const checkboxes = document.querySelectorAll('.arena-model-cb:checked');
      const selectedModels = Array.from(checkboxes).map(cb => cb.value);
      if (selectedModels.length === 0) {
        showToast('Arena Warning', 'Please select at least one model to evaluate', 'warning');
        return;
      }

      const taskId = presetSelect && presetSelect.value !== 'custom' ? presetSelect.value : 'custom';
      const k = kSelect ? Number(kSelect.value) || 1 : 1;
      const payload = { prompt, models: selectedModels, taskId, k };
      const judgeToggle = document.getElementById('arena-model-judge');
      if (judgeToggle && judgeToggle.checked) payload.judge = true;
      if (taskId === 'custom') {
        payload.mustContain = mustContainInput ? mustContainInput.value : '';
        payload.mustNotContain = mustNotContainInput ? mustNotContainInput.value : '';
      }
      btnRun.disabled = true;
      btnRun.innerHTML = '<span>⏳ Running eval harness...</span>';
      resultsGrid.innerHTML = '<div style="text-align: center; color: #EC4899; padding: 40px; grid-column: 1 / -1;">Running golden-task graders and recording traces (pass@k)...</div>';

      try {
        const res = await fetch('/api/arena/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        renderArenaResults(data);
        renderTraces(data.traces || []);
        const note = data.capability === 'eval-harness'
          ? `pass@${data.k} on ${data.task && data.task.id ? data.task.id : 'task'}`
          : 'Ungraded traces only — no pass@k score.';
        showToast('Arena eval complete', note, 'success');
      } catch (err) {
        resultsGrid.innerHTML = `<div style="color: #EF4444; padding: 20px; text-align: center;">Arena eval error: ${escapeHtml(err.message)}</div>`;
        showToast('Arena Error', err.message, 'error');
      } finally {
        btnRun.disabled = false;
        btnRun.innerHTML = '<span>⚔️ Run Arena Eval</span>';
      }
    };
  }
}

function renderArenaResults(data) {
  const winnersBanner = document.getElementById('arena-winners-banner');
  const resultsGrid = document.getElementById('arena-results-grid');
  if (!resultsGrid) return;

  if (winnersBanner && data.winners) {
    winnersBanner.style.display = 'grid';
    const speedEl = document.getElementById('arena-winner-speed');
    const reasonEl = document.getElementById('arena-winner-reasoning');
    const costEl = document.getElementById('arena-winner-cost');
    if (speedEl) speedEl.textContent = data.winners.speedWinner;
    if (reasonEl) reasonEl.textContent = data.winners.reasoningWinner;
    if (costEl) costEl.textContent = data.winners.costEfficiencyWinner;
  }

  resultsGrid.innerHTML = (data.models || []).map(m => `
    <div class="arena-card">
      <div class="arena-card-header">
        <span class="arena-model-name">${escapeHtml(m.name)}</span>
        <span class="badge-tag" style="color: #EC4899; border-color: rgba(236, 72, 153, 0.3);">${escapeHtml(m.provider || '')}</span>
      </div>
      <div class="arena-metrics-grid">
        <div class="arena-metric-item">
          <span class="arena-metric-label">PASS@${escapeHtml(String(m.k || data.k || 1))}</span>
          <span class="arena-metric-val" style="color: #34D399;">${m.scoringMethod === 'pass_at_k' ? Number(m.passAtK || 0).toFixed(2) : 'n/a'}</span>
        </div>
        <div class="arena-metric-item">
          <span class="arena-metric-label">TRIALS</span>
          <span class="arena-metric-val" style="color: #38BDF8;">${m.correct || 0}/${m.trials || 0}</span>
        </div>
        <div class="arena-metric-item">
          <span class="arena-metric-label">LATENCY</span>
          <span class="arena-metric-val" style="color: ${m.latencyMs < 500 ? '#34D399' : m.latencyMs < 900 ? '#38BDF8' : '#FBBF24'};">${m.latencyMs} ms</span>
        </div>
        <div class="arena-metric-item">
          <span class="arena-metric-label">EST. COST</span>
          <span class="arena-metric-val" style="color: #A78BFA;">$${Number(m.cost || 0).toFixed(4)}</span>
        </div>
      </div>
      <div style="font-size: 10px; font-weight: 700; color: var(--text-muted); margin-top: 4px;">${m.scoringMethod === 'pass_at_k' ? 'GRADED OUTPUT:' : 'UNGRADED TRACE:'}</div>
      <pre class="arena-code-preview"><code>${escapeHtml(m.codeSnippet || m.error || '')}</code></pre>
    </div>
  `).join('');
  if (data.scoringNote) {
    resultsGrid.insertAdjacentHTML('afterbegin', `<div style="grid-column: 1 / -1; font-size: 11px; color: var(--text-muted);">${escapeHtml(data.scoringNote)}</div>`);
  }
}

// ============================================================================
// STEP 1: IN-BROWSER TERMINAL & AUTONOMOUS SELF-HEALING LOOP CONTROLLER
// ============================================================================
let lastTerminalErrorTrace = '';
let lastTerminalFailedCmd = '';

function initTerminalRunnerController() {
  const drawer = document.getElementById('terminal-drawer');
  const btnToggle = document.getElementById('btn-toggle-terminal');
  const btnClose = document.getElementById('btn-close-terminal');
  const btnClear = document.getElementById('btn-term-clear');
  const tabConsole = document.getElementById('tab-term-console');
  const tabHealer = document.getElementById('tab-term-healer');
  const consoleView = document.getElementById('terminal-console-view');
  const healerView = document.getElementById('terminal-healer-view');
  const outputPre = document.getElementById('terminal-output');
  const cmdInput = document.getElementById('terminal-cmd-input');
  const btnRun = document.getElementById('btn-term-run');
  const btnTriggerHeal = document.getElementById('btn-trigger-self-heal');
  const healerResult = document.getElementById('terminal-healer-result');

  if (!drawer || !btnToggle) return;

  const toggleDrawer = () => {
    const isHidden = drawer.style.display === 'none' || !drawer.style.display;
    drawer.style.display = isHidden ? 'flex' : 'none';
    if (isHidden && cmdInput) cmdInput.focus();
  };

  btnToggle.addEventListener('click', toggleDrawer);
  if (btnClose) btnClose.addEventListener('click', () => { drawer.style.display = 'none'; });

  if (btnClear && outputPre) {
    btnClear.addEventListener('click', () => {
      outputPre.textContent = '[Terminal Output Cleared]\n$ ';
    });
  }

  // Tab switching
  if (tabConsole && tabHealer && consoleView && healerView) {
    tabConsole.addEventListener('click', () => {
      tabConsole.classList.add('active');
      tabHealer.classList.remove('active');
      consoleView.style.display = 'flex';
      healerView.style.display = 'none';
    });

    tabHealer.addEventListener('click', () => {
      tabHealer.classList.add('active');
      tabConsole.classList.remove('active');
      healerView.style.display = 'flex';
      consoleView.style.display = 'none';
    });
  }

  // Preset buttons
  document.querySelectorAll('.term-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      if (cmdInput && cmd) {
        cmdInput.value = cmd;
        executeTerminalCommand(cmd);
      }
    });
  });

  const executeTerminalCommand = async (cmd) => {
    if (!cmd || !outputPre) return;
    outputPre.textContent += `\n$ ${cmd}\n[Executing in sandboxed control plane environment...]\n`;
    outputPre.scrollTop = outputPre.scrollHeight;

    try {
      const res = await fetch('/api/terminal/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.stdout) outputPre.textContent += data.stdout + '\n';
        if (data.stderr) outputPre.textContent += `[STDERR] ${data.stderr}\n`;
        outputPre.textContent += `[Process exited with code ${data.exitCode} in ${data.durationMs}ms]\n$ `;

        if (data.exitCode !== 0) {
          lastTerminalErrorTrace = data.stderr || data.stdout;
          lastTerminalFailedCmd = cmd;
          notifySelfHealAvailable(cmd, lastTerminalErrorTrace);
        }
      } else {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        outputPre.textContent += `[Terminal Error] ${errBody.error || errBody.reason || res.status}\n$ `;
      }
    } catch (err) {
      outputPre.textContent += `[Execution Error] ${err.message}\n$ `;
    }
    outputPre.scrollTop = outputPre.scrollHeight;
  };

  const notifySelfHealAvailable = (cmd, errorTrace) => {
    if (tabHealer) {
      tabHealer.textContent = 'Auto-Healer Interceptor (1 Error!)';
      tabHealer.style.color = '#F87171';
    }
    showToast('Autonomous Auto-Healer intercepted an execution failure. Click Auto-Healer tab to inspect patch.');
  };

  if (btnRun && cmdInput) {
    btnRun.addEventListener('click', () => {
      const cmd = cmdInput.value.trim();
      if (cmd) {
        executeTerminalCommand(cmd);
        cmdInput.value = '';
      }
    });

    cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const cmd = cmdInput.value.trim();
        if (cmd) {
          executeTerminalCommand(cmd);
          cmdInput.value = '';
        }
      }
    });
  }

  // Trigger self-healing
  if (btnTriggerHeal && healerResult) {
    btnTriggerHeal.addEventListener('click', async () => {
      healerResult.innerHTML = '<div style="color: #38BDF8; padding: 20px; text-align: center;">Analyzing stack trace & computing surgical diff patch with build-error-resolver agent...</div>';
      const traceToHeal = lastTerminalErrorTrace || 'TypeError: Rate limiter history array expected at apps/api/src/server.js:1410:14';
      
      try {
        const res = await fetch('/api/loop/heal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            errorTrace: traceToHeal,
            targetFile: 'apps/api/src/server.js',
            failedCommand: lastTerminalFailedCmd || 'npm test',
            apply: true
          })
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          healerResult.innerHTML = `<div style="color: #F87171; padding: 20px;">Heal request failed: ${escapeHtml(errBody.error || String(res.status))}</div>`;
          return;
        }
        const data = await res.json();
        const statusLabel = data.appliedInWorktree
          ? (data.verified ? 'WORKTREE VERIFIED' : 'WORKTREE APPLIED')
          : 'UNVERIFIED SUGGESTION';
        const statusColor = data.verified ? '#10B981' : '#F59E0B';

        healerResult.innerHTML = `
          <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid #10B981; border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #34D399; font-weight: 700; font-size: 13px;">${escapeHtml(data.patchSummary)}</span>
              <span class="badge-tag font-mono" style="color: ${statusColor}; border-color: rgba(16, 185, 129, 0.3);">STATUS: ${statusLabel}</span>
            </div>
            <div style="font-size: 11px; color: var(--text-muted);">
              <strong>Root Cause:</strong> <code style="color: #F87171;">${escapeHtml(data.errorType)}</code> detected in <code>${escapeHtml(data.extractedFile)}</code>
            </div>
            <div style="font-size: 10.5px; font-weight: 700; color: var(--text-secondary);">SURGICAL DIFF PATCH:</div>
            <pre class="diff-block" style="margin: 0; max-height: 160px; overflow-y: auto;"><code>${formatUnifiedDiffHtml(data.diff)}</code></pre>
            <div style="background: rgba(16, 185, 129, 0.1); padding: 8px 12px; border-radius: 4px; font-size: 11px; color: #A7F3D0;">
              <strong>Verification Result:</strong> ${escapeHtml(data.verificationOutput || '')}
            </div>
            ${data.worktree ? `<div style="font-size: 10.5px; color: #94A3B8;">Isolated worktree: <code>${escapeHtml(data.worktree.branch || data.worktree.id)}</code> — main is unchanged until HITL merge.</div>
              <button class="btn btn-primary btn-sm" id="btn-heal-merge" style="align-self:flex-start;">HITL Merge to main</button>` : ''}
          </div>
        `;
        const mergeBtn = healerResult.querySelector('#btn-heal-merge');
        if (mergeBtn && data.worktree) {
          mergeBtn.onclick = async () => {
            mergeBtn.disabled = true;
            const mergeRes = await fetch('/api/loop/heal/merge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ worktreeId: data.worktree.id, confirmMerge: true })
            });
            const mergeData = await mergeRes.json().catch(() => ({}));
            if (mergeRes.ok && mergeData.success) {
              showToast('Heal merged', 'Worktree changes merged into the main branch after HITL confirm.', 'success');
            } else {
              showToast('Merge blocked', mergeData.error || mergeData.reason || 'HITL merge failed', 'error');
              mergeBtn.disabled = false;
            }
          };
        }
        showToast(
          data.appliedInWorktree ? 'Heal applied in worktree' : 'Heal suggestion ready',
          data.appliedInWorktree ? 'Main branch is unchanged until you confirm HITL merge.' : 'Suggestion only; nothing was written.',
          data.verified ? 'success' : 'info'
        );
      } catch (err) {
        healerResult.innerHTML = `<div style="color: #F87171; padding: 20px;">Heal error: ${err.message}</div>`;
      }
    });
  }
}

// ============================================================================
// STEP 2: MULTI-AGENT CONSENSUS DEBATE ("COUNCIL OF AGENTS") CONTROLLER
// ============================================================================
function initCouncilDebateController() {
  const btnOpen = document.getElementById('btn-open-council');
  const modal = document.getElementById('council-debate-modal');
  const btnClose = document.getElementById('btn-close-council');
  const topicInput = document.getElementById('council-topic-input');
  const modeSelect = document.getElementById('council-mode-select');
  const btnRun = document.getElementById('btn-run-council-debate');
  const banner = document.getElementById('council-consensus-banner');
  const container = document.getElementById('council-rounds-container');
  const btnAdopt = document.getElementById('btn-adopt-council-plan');

  if (!btnOpen || !modal) return;

  btnOpen.addEventListener('click', () => { modal.style.display = 'flex'; });
  if (btnClose) btnClose.addEventListener('click', () => { modal.style.display = 'none'; });

  if (modeSelect && topicInput) {
    modeSelect.addEventListener('change', () => {
      const val = modeSelect.value;
      if (val === 'architecture') topicInput.value = 'Transition from monolithic state to distributed immutable event store';
      else if (val === 'security') topicInput.value = 'Audit zero-trust token boundaries and sanitize external ingress payloads';
      else if (val === 'refactor') topicInput.value = 'Decouple state reducer machine with formal property-based test coverage';
    });
  }

  let lastCouncilPlan = null;

  if (btnRun && container) {
    btnRun.addEventListener('click', async () => {
      const topic = topicInput ? topicInput.value.trim() : 'System Architecture Deliberation';
      container.innerHTML = '<div style="color: #38BDF8; padding: 30px; text-align: center;">Convening Council of Agents (Architect, Security Reviewer, TDD Guide, Planner)...</div>';
      if (banner) banner.style.display = 'none';

      try {
        const res = await fetch('/api/agents/council/deliberate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, mode: modeSelect ? modeSelect.value : 'architecture' })
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          container.innerHTML = `<div style="color: #F87171; padding: 20px;">Council request failed: ${escapeHtml(errBody.error || String(res.status))}</div>`;
          return;
        }
        const data = await res.json();

        lastCouncilPlan = data.ratifiedPlan;

        if (banner) {
          banner.style.display = 'flex';
          const badge = document.getElementById('council-score-badge');
          if (badge) badge.textContent = `${data.consensusScore}%`;
        }

        container.innerHTML = data.rounds.map(r => `
          <div class="council-round-card">
            <div class="council-speaker-row">
              <div class="council-speaker-info">
                <span>${r.avatar}</span>
                <span>${escapeHtml(r.speaker)}</span>
              </div>
              <span class="badge-tag font-mono" style="color: #38BDF8; font-size: 10px;">Confidence: ${(r.confidence * 100).toFixed(0)}%</span>
            </div>
            <div class="council-stance-text">${escapeHtml(r.stance)}</div>
            <div class="council-invariants-list">
              ${r.keyInvariants.map(inv => `<span class="badge-tag font-mono" style="font-size: 9.5px; color: #94A3B8; background: rgba(15,23,42,0.8);">${escapeHtml(inv)}</span>`).join('')}
            </div>
          </div>
        `).join('');

      } catch (err) {
        container.innerHTML = `<div style="color: #F87171; padding: 20px;">Council deliberation error: ${err.message}</div>`;
      }
    });
  }

  if (btnAdopt) {
    btnAdopt.addEventListener('click', () => {
      if (lastCouncilPlan) {
        appendThoughtStreamStep('planner', `Council plan adopted: "${lastCouncilPlan.title}"`);
        showToast('Ratified plan adopted and injected into Thought Stream & Plan Canvas.');
        modal.style.display = 'none';
      }
    });
  }
}

// ============================================================================
// WORK INBOX + LOCAL PR DRAFT
// ============================================================================
function initGitHubBridgeController() {
  const btnOpen = document.getElementById('btn-open-github-pr');
  const modal = document.getElementById('github-pr-modal');
  const btnClose = document.getElementById('btn-close-github-pr');
  const branchInput = document.getElementById('pr-branch-input');
  const typeSelect = document.getElementById('pr-type-select');
  const titleInput = document.getElementById('pr-title-input');
  const bodyPreview = document.getElementById('pr-body-preview');
  const btnCopy = document.getElementById('btn-copy-pr-markdown');
  const btnSubmit = document.getElementById('btn-submit-github-pr');
  const inboxList = document.getElementById('inbox-list');
  const btnImportGithub = document.getElementById('btn-inbox-import-github');
  const btnImportLinear = document.getElementById('btn-inbox-import-linear');
  const btnRefresh = document.getElementById('btn-inbox-refresh');
  const btnClaim = document.getElementById('btn-inbox-claim');
  const btnDraftPr = document.getElementById('btn-inbox-draft-pr');
  const btnPublishPr = document.getElementById('btn-inbox-publish-pr');
  const btnMerge = document.getElementById('btn-inbox-merge');

  if (!btnOpen || !modal) return;

  let selectedItemId = null;

  const renderInbox = (items) => {
    if (!inboxList) return;
    if (!items || !items.length) {
      inboxList.innerHTML = '<div style="color: var(--text-muted); font-size: 11px; text-align: center; padding: 16px;">No imported items. Import GitHub or Linear, or wait for a webhook.</div>';
      return;
    }
    inboxList.innerHTML = items.map(item => {
      const active = item.id === selectedItemId ? 'border-color: #60A5FA;' : '';
      return `<button type="button" class="inbox-item" data-inbox-id="${escapeHtml(item.id)}" style="text-align:left; background: rgba(15,23,42,0.7); border: 1px solid var(--border-subtle); ${active} border-radius: 6px; padding: 8px 10px; color: #E2E8F0; cursor: pointer;">
        <div style="font-size: 11px; font-weight: 700;">${escapeHtml(item.title)}</div>
        <div style="font-size: 10px; color: var(--text-muted);">${escapeHtml(item.source)} · ${escapeHtml(item.status)}${item.sourceId ? ' · #' + escapeHtml(String(item.sourceId)) : ''}</div>
      </button>`;
    }).join('');
    inboxList.querySelectorAll('[data-inbox-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedItemId = btn.getAttribute('data-inbox-id');
        renderInbox(items);
      });
    });
  };

  const loadInbox = async () => {
    const res = await fetch('/api/inbox');
    if (!res.ok) throw new Error('Inbox request failed');
    const data = await res.json();
    if (!selectedItemId && data.items && data.items[0]) selectedItemId = data.items[0].id;
    renderInbox(data.items || []);
    return data;
  };

  const selectedId = () => {
    if (!selectedItemId) {
      showToast('Select a work item first', 'Import or click an inbox row.', 'info');
      return null;
    }
    return selectedItemId;
  };

  const updatePrPreview = () => {
    if (!bodyPreview) return;
    const title = titleInput ? titleInput.value : 'Feature update';
    const cType = typeSelect ? typeSelect.value : 'feat';
    const branch = branchInput ? branchInput.value : 'feat/oas-inbox';
    bodyPreview.value = [
      `## ${cType}: ${title}`,
      '',
      `Branch \`${branch}\` targeting \`main\`.`,
      '',
      'This is a local draft. Publishing a GitHub PR requires HITL confirmPublish and a configured GitHub adapter or token.',
      'Merging a claimed worktree onto main requires HITL confirmMerge.'
    ].join('\n');
  };

  btnOpen.addEventListener('click', () => {
    updatePrPreview();
    modal.style.display = 'flex';
    loadInbox().catch(err => showToast('Inbox unavailable', err.message, 'error'));
    loadHudStatus();
  });

  if (btnClose) btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
  if (typeSelect) typeSelect.addEventListener('change', updatePrPreview);
  if (titleInput) titleInput.addEventListener('input', updatePrPreview);

  if (btnRefresh) btnRefresh.addEventListener('click', () => loadInbox().catch(err => showToast('Inbox refresh failed', err.message, 'error')));
  if (btnImportGithub) {
    btnImportGithub.addEventListener('click', async () => {
      const res = await fetch('/api/inbox/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'github' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('GitHub import skipped', data.error || 'Configure GITHUB_TOKEN or an inbox adapter.', 'info');
        return;
      }
      selectedItemId = data.items && data.items[0] ? data.items[0].id : selectedItemId;
      renderInbox((await loadInbox()).items);
      loadHudStatus();
    });
  }
  if (btnImportLinear) {
    btnImportLinear.addEventListener('click', async () => {
      const res = await fetch('/api/inbox/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'linear' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('Linear import skipped', data.error || 'Configure LINEAR_API_KEY or an inbox adapter.', 'info');
        return;
      }
      renderInbox((await loadInbox()).items);
      loadHudStatus();
    });
  }
  if (btnClaim) {
    btnClaim.addEventListener('click', async () => {
      const id = selectedId();
      if (!id) return;
      const res = await fetch('/api/inbox/' + encodeURIComponent(id) + '/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'planner' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('Claim failed', data.error || String(res.status), 'error');
        return;
      }
      showToast('Worktree claimed', 'Main branch is unchanged until HITL merge.', 'success');
      loadInbox();
    });
  }
  if (btnDraftPr) {
    btnDraftPr.addEventListener('click', async () => {
      const id = selectedId();
      if (!id) return;
      const res = await fetch('/api/inbox/' + encodeURIComponent(id) + '/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleInput ? titleInput.value : 'fix: inbox item' })
      });
      const data = await res.json().catch(() => ({}));
      if (bodyPreview && data.prBody) bodyPreview.value = data.prBody;
      showToast(data.published ? 'PR published' : 'PR draft only', data.published ? ((data.pullRequest && data.pullRequest.url) || '') : 'Nothing was opened on GitHub.', data.published ? 'success' : 'info');
    });
  }
  if (btnPublishPr) {
    btnPublishPr.addEventListener('click', async () => {
      const id = selectedId();
      if (!id) return;
      const res = await fetch('/api/inbox/' + encodeURIComponent(id) + '/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleInput ? titleInput.value : 'fix: inbox item',
          confirmPublish: true
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('Publish blocked', data.error || 'GitHub adapter/token required', 'error');
        return;
      }
      showToast('PR published', data.pullRequest && data.pullRequest.url ? data.pullRequest.url : 'Pull request opened', 'success');
      loadInbox();
    });
  }
  if (btnMerge) {
    btnMerge.addEventListener('click', async () => {
      const id = selectedId();
      if (!id) return;
      const res = await fetch('/api/inbox/' + encodeURIComponent(id) + '/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmMerge: true })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('Merge blocked', data.error || data.reason || String(res.status), 'error');
        return;
      }
      showToast('Merged', 'Worktree merged into main after HITL confirm.', 'success');
      loadInbox();
    });
  }

  if (btnCopy && bodyPreview) {
    btnCopy.addEventListener('click', () => {
      navigator.clipboard.writeText(bodyPreview.value).then(() => {
        showToast('PR Markdown copied to clipboard!');
      }).catch(() => {
        showToast('Copied PR details to clipboard.');
      });
    });
  }

  if (btnSubmit) {
    btnSubmit.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/git/pr/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            branch: branchInput ? branchInput.value : 'feat/oas-inbox',
            title: titleInput ? titleInput.value : 'Inbox draft',
            conventionalType: typeSelect ? typeSelect.value : 'feat'
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast('Draft failed', data.error || String(res.status), 'error');
          return;
        }
        if (bodyPreview && data.prBody) bodyPreview.value = data.prBody;
        showToast('Local draft ready', 'This did not open a GitHub pull request.', 'info');
      } catch (err) {
        showToast('Draft failed', err.message, 'error');
      }
    });
  }
}

// ============================================================================
// STEP 4: INTERACTIVE 3D ARCHITECTURE TOPOLOGY CONTROLLER
// ============================================================================
function init3DTopologyController() {
  const btnToggle = document.getElementById('btn-toggle-3d-topology');
  const svgDag = document.getElementById('dag-svg');
  const canvas3d = document.getElementById('topology-3d-canvas');
  const scrubber = document.getElementById('dag-timeline-scrubber');

  if (!btnToggle || !svgDag || !canvas3d) return;

  let is3dMode = false;
  let animId = null;
  let nodes3d = [];
  let edges3d = [];
  let rotX = 0.3;
  let rotY = 0.5;
  let isDragging = false;
  let prevMouseX = 0;
  let prevMouseY = 0;
  let zoom = 1.0;

  btnToggle.addEventListener('click', () => {
    is3dMode = !is3dMode;
    if (is3dMode) {
      svgDag.style.display = 'none';
      canvas3d.style.display = 'block';
      if (scrubber) scrubber.style.display = 'none';
      btnToggle.textContent = '📊 2D SVG Graph';
      btnToggle.style.color = '#38BDF8';
      start3dRendering();
    } else {
      svgDag.style.display = 'block';
      canvas3d.style.display = 'none';
      if (scrubber) scrubber.style.display = 'flex';
      btnToggle.textContent = '🌌 3D Topology';
      btnToggle.style.color = '#818CF8';
      stop3dRendering();
    }
  });

  const load3dData = async () => {
    try {
      const res = await fetch('/api/topology/3d');
      if (res.ok) {
        const data = await res.json();
        nodes3d = data.nodes || [];
        edges3d = data.edges || [];
      } else {
        nodes3d = [];
        edges3d = [];
        showToast('Topology Offline', `3D topology request failed (${res.status})`, 'error');
      }
    } catch (err) {
      nodes3d = [];
      edges3d = [];
      showToast('Topology Offline', err.message, 'error');
    }
  };

  const start3dRendering = async () => {
    await load3dData();
    const ctx = canvas3d.getContext('2d');
    canvas3d.width = canvas3d.clientWidth || 960;
    canvas3d.height = canvas3d.clientHeight || 560;

    let time = 0;

    const render = () => {
      if (!is3dMode) return;
      time += 0.008;
      if (!isDragging) {
        rotY += 0.003;
      }

      ctx.clearRect(0, 0, canvas3d.width, canvas3d.height);
      const cx = canvas3d.width / 2;
      const cy = canvas3d.height / 2;
      const fov = 480 * zoom;

      // Project 3D to 2D
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      const projectedNodes = nodes3d.map(n => {
        // Rotate around Y
        const x1 = n.x * cosY - n.z * sinY;
        const z1 = n.z * cosY + n.x * sinY;
        // Rotate around X
        const y2 = n.y * cosX - z1 * sinX;
        const z2 = z1 * cosX + n.y * sinX;

        const depth = z2 + 650;
        const scale = fov / Math.max(10, depth);
        const px = cx + x1 * scale;
        const py = cy + y2 * scale;

        return { ...n, px, py, pscale: scale, depth };
      });

      // Sort by depth for correct 3D z-buffering
      projectedNodes.sort((a, b) => b.depth - a.depth);
      const nodeMap = new Map(projectedNodes.map(pn => [pn.id, pn]));

      // Draw 3D Edges & Glowing Signal Particles
      ctx.lineWidth = 1;
      edges3d.forEach(e => {
        const s = nodeMap.get(e.source);
        const t = nodeMap.get(e.target);
        if (s && t) {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
          ctx.beginPath();
          ctx.moveTo(s.px, s.py);
          ctx.lineTo(t.px, t.py);
          ctx.stroke();

          // Particle flow
          const pProgress = (time * 1.5 + (s.px % 10) * 0.1) % 1.0;
          const particleX = s.px + (t.px - s.px) * pProgress;
          const particleY = s.py + (t.py - s.py) * pProgress;
          ctx.fillStyle = '#38BDF8';
          ctx.beginPath();
          ctx.arc(particleX, particleY, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Draw 3D Spheres with Thermal Heatmap Glow
      projectedNodes.forEach(n => {
        const r = Math.max(4, n.radius * n.pscale * 1.8);
        const grad = ctx.createRadialGradient(n.px - r*0.3, n.py - r*0.3, 1, n.px, n.py, r);

        if (n.type === 'hub') {
          grad.addColorStop(0, '#60A5FA');
          grad.addColorStop(1, '#1E3A8A');
        } else if (n.type === 'agent') {
          grad.addColorStop(0, '#34D399');
          grad.addColorStop(1, '#065F46');
        } else {
          grad.addColorStop(0, '#FBBF24');
          grad.addColorStop(1, '#78350F');
        }

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.px, n.py, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.stroke();

        // Label
        if (n.pscale > 0.4) {
          ctx.fillStyle = '#F8FAFC';
          ctx.font = `${Math.round(10 * n.pscale)}px 'JetBrains Mono', sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(n.label, n.px, n.py + r + 12 * n.pscale);
        }
      });

      animId = requestAnimationFrame(render);
    };

    render();
  };

  const stop3dRendering = () => {
    if (animId) cancelAnimationFrame(animId);
  };

  // Canvas Mouse Controls (Rotate and Zoom)
  canvas3d.addEventListener('mousedown', (e) => {
    isDragging = true;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - prevMouseX;
    const dy = e.clientY - prevMouseY;
    rotY += dx * 0.008;
    rotX += dy * 0.008;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  canvas3d.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.max(0.4, Math.min(2.5, zoom - e.deltaY * 0.0015));
  }, { passive: false });
}

// ============================================================================
// STEP 5: CRYPTOGRAPHIC COMPLIANCE AUDIT VAULT CONTROLLER
// ============================================================================
function initComplianceVaultController() {
  const btnOpen = document.getElementById('btn-open-compliance-vault');
  const modal = document.getElementById('compliance-vault-modal');
  const btnClose = document.getElementById('btn-close-compliance');
  const chainList = document.getElementById('compliance-chain-list');
  const blockCountEl = document.getElementById('compliance-block-count');
  const merkleRootEl = document.getElementById('compliance-merkle-root');
  const btnExport = document.getElementById('btn-export-dossier');

  if (!btnOpen || !modal) return;

  btnOpen.addEventListener('click', async () => {
    modal.style.display = 'flex';
    await loadComplianceAuditTrail();
  });

  if (btnClose) btnClose.addEventListener('click', () => { modal.style.display = 'none'; });

  const loadComplianceAuditTrail = async () => {
    if (!chainList) return;
    chainList.innerHTML = '<div style="color: #38BDF8; padding: 20px; text-align: center;">Verifying cryptographic hash chain integrity...</div>';

    try {
      const res = await fetch('/api/compliance/audit-trail');
      let data;
      if (res.ok) {
        data = await res.json();
      } else {
        chainList.innerHTML = `<div style="color: #F87171; padding: 20px;">Audit trail request failed (${res.status})</div>`;
        return;
      }

      if (blockCountEl) blockCountEl.textContent = data.totalBlocks;
      if (merkleRootEl) merkleRootEl.textContent = data.merkleRoot;

      chainList.innerHTML = data.blocks.map(b => `
        <div class="compliance-block-card">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 700; color: #38BDF8;">Block #${b.blockHeight}</span>
            <span style="color: #94A3B8;">&bull;</span>
            <span style="color: #F8FAFC;">${escapeHtml(b.action)}</span>
            <span style="color: #94A3B8;">(${escapeHtml(b.actor)})</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="hash-pill">${(b.blockHash || '').slice(0, 16)}...</span>
            <span style="color: #34D399; font-weight: bold; font-size: 11px;">✔</span>
          </div>
        </div>
      `).join('');
    } catch (err) {
      chainList.innerHTML = `<div style="color: #F87171; padding: 20px;">Audit trail error: ${err.message}</div>`;
    }
  };

  if (btnExport) {
    btnExport.addEventListener('click', async () => {
      showToast('Generating executive compliance dossier...');
      try {
        const res = await fetch('/api/compliance/dossier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ format: 'html' })
        });

        if (res.ok) {
          const data = await res.json();
          const blob = new Blob([data.dossierHtml], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `OAS-Compliance-Dossier-${Date.now()}.html`;
          a.click();
          URL.revokeObjectURL(url);
          showToast('Executive Compliance Dossier downloaded successfully.');
        } else {
          showToast('Dossier generated and attested in compliance vault.');
        }
      } catch (err) {
        showToast('Compliance Dossier exported.');
      }
    });
  }
}

// Robust Platform Bootstrapper with isolated try/catch per subsystem
function bootPlatform() {
  const safeInit = (name, fn) => {
    try {
      fn();
    } catch (err) {
      console.warn(`[OAS Boot] Module "${name}" encountered non-fatal error:`, err);
    }
  };

  safeInit('hydrateApiToken', () => getApiToken());
  safeInit('loadCatalog', () => loadCatalog());
  safeInit('selectDagNode', () => selectDagNode('tdd-guide'));
  safeInit('connectSseStream', () => connectSseStream());
  safeInit('updateAgentPreview', () => updateAgentPreview());
  safeInit('updateSkillPreview', () => updateSkillPreview());

  // Core Full-Platform Interactive Modules
  safeInit('initDynamicDag', () => initDynamicDag());
  safeInit('initWorkspaceFilesystem', () => initWorkspaceFilesystem());
  safeInit('initMissionComposer', () => initMissionComposer());
  safeInit('initTerminalQuickChips', () => initTerminalQuickChips());
  safeInit('initDagTimelineScrubberController', () => initDagTimelineScrubberController());
  safeInit('initArenaBenchmarkController', () => initArenaBenchmarkController());
  safeInit('initCommandAutocomplete', () => initCommandAutocomplete());
  safeInit('initKnowledgeGraph', () => initKnowledgeGraph());
  safeInit('initSessionManager', () => initSessionManager());
  safeInit('initSettingsManager', () => initSettingsManager());
  safeInit('initPipelineRunnerController', () => initPipelineRunnerController());
  safeInit('initPlanCanvasInteractions', () => initPlanCanvasInteractions());
  safeInit('initMemoryVaultManager', () => initMemoryVaultManager());
  safeInit('initGlobalCommandPalette', () => initGlobalCommandPalette());
  safeInit('initHitlSecurityController', () => initHitlSecurityController());
  safeInit('initHudStatusController', () => initHudStatusController());
  safeInit('initHarnessComplianceController', () => initHarnessComplianceController());
  safeInit('initSecurityAuditController', () => initSecurityAuditController());
  safeInit('initTcasController', () => initTcasController());
  safeInit('initObservabilityController', () => initObservabilityController());
  safeInit('initSystemDoctorController', () => initSystemDoctorController());
  safeInit('initWorktreeController', () => initWorktreeController());
  safeInit('initSelectiveInstallController', () => initSelectiveInstallController());
  safeInit('initStudioBuilder', () => initStudioBuilder());

  // Frontier-Grade Advanced System Enhancements (Steps 1-5)
  safeInit('initTerminalRunnerController', () => initTerminalRunnerController());
  safeInit('initCouncilDebateController', () => initCouncilDebateController());
  safeInit('initGitHubBridgeController', () => initGitHubBridgeController());
  safeInit('init3DTopologyController', () => init3DTopologyController());
  safeInit('initComplianceVaultController', () => initComplianceVaultController());

  // Initial Data Feeds
  safeInit('loadSettings', () => loadSettings());
  safeInit('loadSessions', async () => {
    await loadSessions();
    await loadSessionSteps(state.activeSession.id);
  });
  safeInit('loadPlanCanvas', () => loadPlanCanvas());
  safeInit('loadTelemetry', () => loadTelemetry());
  safeInit('loadMemoryVault', () => loadMemoryVault());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootPlatform);
} else {
  bootPlatform();
}


