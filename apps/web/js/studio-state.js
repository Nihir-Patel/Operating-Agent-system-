/**
 * Shared Studio client state. Mutate fields in place so every module
 * sees the same session, catalog, and workspace file pointers.
 */

export const state = {
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
    id: null,
    title: 'No Session Selected',
    currentNode: null,
    status: 'idle'
  }
};

export const nodeMetadata = {};

export const viewTitles = {
  'view-dag': 'Execution DAG Orchestrator',
  'view-workspace': 'Live Streaming Workspace & Virtual Terminal',
  'view-knowledge-graph': 'Interactive Knowledge Graph Visualizer',
  'view-plan-canvas': 'Plan Canvas (Interactive Roadmap)',
  'view-catalog': 'Capabilities Catalog & Studio (68 Agents • 286 Skills • 94 Commands)',
  'view-vault': 'Memory Vault & Telemetry Dashboard',
  'view-builder': 'Studio Builder (Visual Agent & Skill Designer)'
};
