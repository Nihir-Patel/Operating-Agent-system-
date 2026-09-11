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
  'view-dag': 'Execution DAG',
  'view-workspace': 'Live Workspace',
  'view-knowledge-graph': 'Knowledge Graph',
  'view-plan-canvas': 'Plan Canvas',
  'view-catalog': 'Capabilities Catalog',
  'view-vault': 'Memory & Telemetry',
  'view-builder': 'Studio Builder'
};

export const viewKickers = {
  'view-dag': 'DAG',
  'view-workspace': 'WORKSPACE',
  'view-knowledge-graph': 'GRAPH',
  'view-plan-canvas': 'PLAN',
  'view-catalog': 'CATALOG',
  'view-vault': 'VAULT',
  'view-builder': 'BUILDER'
};
