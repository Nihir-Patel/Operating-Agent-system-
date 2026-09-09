/**
 * @file packages/engine/src/index.js
 * OAS Enterprise Engine Entrypoint
 */

const { AgentDagScheduler } = require('./scheduler');
const { ExecutionSandbox } = require('./sandbox');
const { StrategicCompactor } = require('./compactor');
const { UniversalModelGateway, extractGeminiText } = require('./llm-gateway');
const { AgentRunner } = require('./agent-runner');
const { WorktreeRunner } = require('./worktree-runner');
const { CommandRunner } = require('./command-runner');
const { isInsideWorkspace, resolveInsideWorkspace } = require('./path-guard');
const { inferProvider, getContextWindow, resolveDefaultModel } = require('./model-registry');
const { buildCycloneDxSbom, buildAipom } = require('./bill-of-materials');

module.exports = {
  AgentDagScheduler,
  ExecutionSandbox,
  StrategicCompactor,
  UniversalModelGateway,
  extractGeminiText,
  AgentRunner,
  WorktreeRunner,
  CommandRunner,
  isInsideWorkspace,
  resolveInsideWorkspace,
  inferProvider,
  getContextWindow,
  resolveDefaultModel,
  buildCycloneDxSbom,
  buildAipom
};
