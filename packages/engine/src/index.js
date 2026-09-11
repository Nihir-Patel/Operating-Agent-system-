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
const { wrapUntrustedContent } = require('./prompt-guard');
const { OAS_AGENT_TOOLS, extractMarkdownToolCall, normalizeNativeToolCalls, toAnthropicTools } = require('./agent-tools');
const { buildCycloneDxSbom, buildAipom } = require('./bill-of-materials');
const { estimateCostUsd, summarizeCostLedger, recordInferenceCost } = require('./cost-ledger');
const { resolveRoute, assertWithinBudget } = require('./model-router');
const { PathLeaseRegistry, pathsOverlap, normalizeLeasePath } = require('./path-leases');
const { applyHealInWorktree, verifyHealWorktree } = require('./heal-apply');
const { buildSeatbeltProfile, resolveSandboxedSpawn } = require('./os-sandbox');
const { READ_TOOLS, handleReadTool, listSessions, getDiff, worktreeStatus } = require('./mcp-read-plane');
const {
  parseGithubRepo,
  normalizeWorkItem,
  summarizeInbox,
  fromGithubIssue,
  fromLinearIssue,
  fromGithubWebhook,
  listGithubIssues,
  listLinearIssues,
  createGithubPullRequest
} = require('./work-inbox');
const {
  formatGithubSessionTitle,
  formatStudioWorkLabel,
  isSampleGithubWork,
} = require('./studio-labels');
const {
  passAtK,
  gradeOutput,
  listGoldenTasks,
  resolveArenaTask,
  summarizeModelEval,
  pickArenaWinners,
  parseCustomGraders,
  gradeWithModelJudge
} = require('./eval-harness');
const { evaluateSkillPromotion, writeSkillPromotion } = require('./skill-promotion');
const { planDesktopControlPlane } = require('./desktop-control-plane');
const {
  ALLOWED_CURSOR_MCP_SERVERS,
  assertProviderReady,
  evaluateFirstRun,
  memoryCliCommand,
  readCursorMcpConfig,
} = require('./studio-first-run');
const { listOas2Sessions } = require('./oas2-read-bridge');
const { encodeMcpMessage, feedMcpBuffer } = require('./mcp-framing');
const { buildConsentGatedOtlp } = require('./otlp-consent');

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
  wrapUntrustedContent,
  OAS_AGENT_TOOLS,
  extractMarkdownToolCall,
  normalizeNativeToolCalls,
  toAnthropicTools,
  buildCycloneDxSbom,
  buildAipom,
  estimateCostUsd,
  summarizeCostLedger,
  recordInferenceCost,
  resolveRoute,
  assertWithinBudget,
  PathLeaseRegistry,
  pathsOverlap,
  normalizeLeasePath,
  applyHealInWorktree,
  verifyHealWorktree,
  parseGithubRepo,
  normalizeWorkItem,
  summarizeInbox,
  fromGithubIssue,
  fromLinearIssue,
  fromGithubWebhook,
  listGithubIssues,
  listLinearIssues,
  createGithubPullRequest,
  formatGithubSessionTitle,
  formatStudioWorkLabel,
  isSampleGithubWork,
  passAtK,
  gradeOutput,
  listGoldenTasks,
  resolveArenaTask,
  summarizeModelEval,
  pickArenaWinners,
  parseCustomGraders,
  gradeWithModelJudge,
  evaluateSkillPromotion,
  writeSkillPromotion,
  planDesktopControlPlane,
  ALLOWED_CURSOR_MCP_SERVERS,
  assertProviderReady,
  evaluateFirstRun,
  memoryCliCommand,
  readCursorMcpConfig,
  listOas2Sessions,
  encodeMcpMessage,
  feedMcpBuffer,
  buildConsentGatedOtlp,
  buildSeatbeltProfile,
  resolveSandboxedSpawn,
  READ_TOOLS,
  handleReadTool,
  listSessions,
  getDiff,
  worktreeStatus
};
