/**
 * @file packages/engine/src/studio-first-run.js
 * First-run readiness for Local Studio and the project Cursor MCP file.
 */

const fs = require('fs');
const path = require('path');

const ALLOWED_CURSOR_MCP_SERVERS = new Set([
  'chrome-devtools',
  'oas-memory-vault',
  'oas-studio-read',
]);

const PROVIDER_KEYS = {
  anthropic: { settingsKey: 'anthropicApiKey', envKey: 'ANTHROPIC_API_KEY' },
  openai: { settingsKey: 'openaiApiKey', envKey: 'OPENAI_API_KEY' },
  gemini: { settingsKey: 'geminiApiKey', envKey: 'GEMINI_API_KEY' },
};

function memoryCliCommand(cliOnPath) {
  return cliOnPath ? 'oas memory' : 'node scripts/oas.js memory';
}

function commandExists(name, env = process.env) {
  const pathValue = env.PATH || '';
  const suffixes = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  return pathValue.split(path.delimiter).some(dir => (
    suffixes.some(suffix => {
      try {
        return fs.existsSync(path.join(dir, `${name}${suffix}`));
      } catch {
        return false;
      }
    })
  ));
}

function resolveProviderReadiness(settings = {}, env = {}) {
  const provider = settings.provider || 'ollama';
  if (provider === 'ollama') {
    return {
      configured: true,
      provider,
      message: 'Ollama is the default local provider. Start Ollama or add a cloud key in Settings.',
    };
  }
  const mapping = PROVIDER_KEYS[provider];
  if (!mapping) {
    return {
      configured: false,
      provider,
      message: `Unknown provider "${provider}". Choose Ollama, Anthropic, OpenAI, or Gemini in Settings.`,
    };
  }
  const configured = Boolean(String(settings[mapping.settingsKey] || env[mapping.envKey] || '').trim());
  return {
    configured,
    provider,
    message: configured
      ? `${provider} key is configured.`
      : `Add a ${provider} API key in Settings, or switch the provider to Ollama.`,
  };
}

function assertProviderReady(settings = {}, env = {}) {
  const readiness = resolveProviderReadiness(settings, env);
  if (readiness.configured) return readiness;
  const error = new Error(
    `${readiness.message} Complete the first-run checklist before running agents.`
  );
  error.code = 'NO_PROVIDER_CONFIGURED';
  error.statusCode = 409;
  throw error;
}

function tokenConfigured(settingsValue, envValue) {
  return Boolean(String(settingsValue || envValue || '').trim());
}

function readCursorMcpConfig(repoRoot) {
  const filePath = path.join(repoRoot, '.cursor', 'mcp.json');
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    mcpServers: parsed && parsed.mcpServers && typeof parsed.mcpServers === 'object'
      ? parsed.mcpServers
      : {},
  };
}

function evaluateFirstRun(input = {}) {
  const settings = input.settings || {};
  const env = input.env || {};
  const mcpConfig = input.mcpConfig || { mcpServers: {} };
  const servers = Object.keys(mcpConfig.mcpServers || {});
  const provider = resolveProviderReadiness(settings, env);
  const githubConfigured = tokenConfigured(settings.githubToken, env.GITHUB_TOKEN);
  const linearConfigured = tokenConfigured(settings.linearApiKey, env.LINEAR_API_KEY);
  const cliCommand = memoryCliCommand(Boolean(input.cliOnPath));
  const vaultCount = Number(input.vaultCount) || 0;

  const items = [
    {
      id: 'provider',
      title: 'LLM provider',
      required: true,
      status: provider.configured ? 'ready' : 'missing',
      detail: provider.message,
    },
    {
      id: 'memory-cli',
      title: 'Memory CLI',
      required: false,
      status: 'ready',
      command: cliCommand,
      detail: input.cliOnPath
        ? 'oas is on PATH. Use oas memory to search the Markdown vault.'
        : 'Plugin installs do not put oas on PATH. From this clone use node scripts/oas.js memory.',
    },
    {
      id: 'memory-vault',
      title: 'Unified memory vault',
      required: false,
      status: 'ready',
      detail: `Studio reads and writes .oas/memory together with the local store (${vaultCount} entries).`,
    },
    {
      id: 'mcp-chrome',
      title: 'chrome-devtools MCP',
      required: false,
      status: servers.includes('chrome-devtools') ? 'ready' : 'missing',
      detail: 'Default browser debugger. Keyless. Needs Chrome.',
    },
    {
      id: 'inbox-github',
      title: 'GitHub inbox',
      required: false,
      status: githubConfigured ? 'ready' : 'missing',
      detail: githubConfigured
        ? 'GITHUB_TOKEN or Settings token is configured.'
        : 'Optional. Add GITHUB_TOKEN or a token in Settings to import issues.',
    },
    {
      id: 'inbox-linear',
      title: 'Linear inbox',
      required: false,
      status: linearConfigured ? 'ready' : 'missing',
      detail: linearConfigured
        ? 'LINEAR_API_KEY or Settings key is configured.'
        : 'Optional. Add LINEAR_API_KEY to import Linear issues.',
    },
    {
      id: 'desktop',
      title: 'Desktop shell',
      required: false,
      status: 'optional',
      command: 'npm run desktop',
      detail: 'Optional Tauri wrapper around this same Studio UI. Not required.',
    },
    {
      id: 'oas2',
      title: 'OAS2 Rust control plane',
      required: false,
      status: 'skip',
      detail: 'Alpha. Not on the new-user path. Use npm run studio instead.',
    },
    {
      id: 'ito',
      title: 'Itô compute',
      required: false,
      status: 'skip',
      detail: 'Design-partner GPU RFQ only. The CLI package is unpublished.',
    },
    {
      id: 'ccg-workflow',
      title: 'multi-* commands',
      required: false,
      status: 'skip',
      detail: 'Optional. npx ccg-workflow is a separate runtime, not part of base Studio.',
    },
  ];

  const blocking = items.filter(item => item.required && item.status === 'missing');
  return {
    schemaVersion: 'oas.studio.first-run.v1',
    ready: blocking.length === 0,
    dismissed: Boolean(input.dismissed),
    blocking,
    items,
    provider,
    inbox: { githubConfigured, linearConfigured },
    memory: {
      vaultCount,
      unified: true,
      cliCommand,
    },
    mcp: { servers },
  };
}

module.exports = {
  ALLOWED_CURSOR_MCP_SERVERS,
  assertProviderReady,
  commandExists,
  evaluateFirstRun,
  memoryCliCommand,
  readCursorMcpConfig,
  resolveProviderReadiness,
};
