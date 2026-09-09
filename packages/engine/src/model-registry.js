/**
 * @file packages/engine/src/model-registry.js
 * Single source of truth for model IDs, providers, and context windows.
 */

const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b';

const MODEL_RECORDS = {
  'qwen2.5-coder:7b': { provider: 'ollama', contextWindow: 32768, supportsChat: true, maxTokensDefault: 2048 },
  'qwen2.5:7b-instruct': { provider: 'ollama', contextWindow: 32768, supportsChat: true, maxTokensDefault: 2048 },
  'qwen2.5:1.5b': { provider: 'ollama', contextWindow: 32768, supportsChat: true, maxTokensDefault: 1024 },
  'gpt-oss:120b-cloud': { provider: 'ollama', contextWindow: 131072, supportsChat: true, maxTokensDefault: 4096 },
  'llama3.3': { provider: 'ollama', contextWindow: 131072, supportsChat: true, maxTokensDefault: 2048 },
  'claude-3-7-sonnet': { provider: 'anthropic', contextWindow: 200000, supportsChat: true, maxTokensDefault: 4096 },
  'claude-3-7-opus': { provider: 'anthropic', contextWindow: 200000, supportsChat: true, maxTokensDefault: 4096 },
  'claude-3-5-haiku': { provider: 'anthropic', contextWindow: 200000, supportsChat: true, maxTokensDefault: 4096 },
  'gpt-4o': { provider: 'openai', contextWindow: 128000, supportsChat: true, maxTokensDefault: 4096 },
  'o3-mini': { provider: 'openai', contextWindow: 200000, supportsChat: true, maxTokensDefault: 4096 },
  'gemini-2.5-pro': { provider: 'gemini', contextWindow: 1000000, supportsChat: true, maxTokensDefault: 4096 }
};

const ALIASES = {
  sonnet: 'claude-3-7-sonnet',
  'sonnet-3.7': 'claude-3-7-sonnet',
  opus: 'claude-3-7-opus',
  haiku: 'claude-3-5-haiku',
  claude: 'claude-3-7-sonnet',
  gpt: 'gpt-4o',
  gemini: 'gemini-2.5-pro',
  ollama: DEFAULT_OLLAMA_MODEL
};

function resolveDefaultModel() {
  return DEFAULT_OLLAMA_MODEL;
}

function lookupModel(modelName) {
  if (!modelName) {
    return { id: DEFAULT_OLLAMA_MODEL, ...MODEL_RECORDS[DEFAULT_OLLAMA_MODEL] };
  }
  if (MODEL_RECORDS[modelName]) {
    return { id: modelName, ...MODEL_RECORDS[modelName] };
  }
  const alias = ALIASES[String(modelName).toLowerCase()];
  if (alias && MODEL_RECORDS[alias]) {
    return { id: alias, ...MODEL_RECORDS[alias] };
  }
  return null;
}

function getContextWindow(modelName) {
  const record = lookupModel(modelName);
  return record ? record.contextWindow : 32768;
}

function inferProvider(modelName, activeProvider, ollamaModel) {
  const name = (modelName || '').toLowerCase();
  const exact = lookupModel(modelName);
  if (exact && MODEL_RECORDS[exact.id]) {
    return { provider: exact.provider, model: exact.id, contextWindow: exact.contextWindow, maxTokensDefault: exact.maxTokensDefault };
  }

  if (name.includes('sonnet') || name.includes('opus') || name.includes('haiku') || name.includes('claude')) {
    const id = name.includes('opus') ? 'claude-3-7-opus' : (name.includes('haiku') ? 'claude-3-5-haiku' : 'claude-3-7-sonnet');
    return { provider: 'anthropic', model: id, contextWindow: 200000, maxTokensDefault: 4096 };
  }
  if (name.includes('gpt') || name.includes('o3') || name.includes('o1')) {
    const id = name.includes('o3') ? 'o3-mini' : 'gpt-4o';
    return { provider: 'openai', model: id, contextWindow: MODEL_RECORDS[id].contextWindow, maxTokensDefault: 4096 };
  }
  if (name.includes('gemini')) {
    return { provider: 'gemini', model: modelName || 'gemini-2.5-pro', contextWindow: 1000000, maxTokensDefault: 4096 };
  }
  if (name.includes('llama') || name.includes('qwen') || name.includes('deepseek') || name.includes('mistral') || name.includes('ollama')) {
    const selected = modelName || ollamaModel || DEFAULT_OLLAMA_MODEL;
    return { provider: 'ollama', model: selected, contextWindow: getContextWindow(selected), maxTokensDefault: 2048 };
  }

  if (activeProvider === 'ollama') {
    const selected = modelName || ollamaModel || DEFAULT_OLLAMA_MODEL;
    return { provider: 'ollama', model: selected, contextWindow: getContextWindow(selected), maxTokensDefault: 2048 };
  }
  if (activeProvider === 'anthropic') {
    return { provider: 'anthropic', model: modelName || 'claude-3-7-sonnet', contextWindow: 200000, maxTokensDefault: 4096 };
  }
  if (activeProvider === 'openai') {
    return { provider: 'openai', model: modelName || 'gpt-4o', contextWindow: 128000, maxTokensDefault: 4096 };
  }
  if (activeProvider === 'gemini') {
    return { provider: 'gemini', model: modelName || 'gemini-2.5-pro', contextWindow: 1000000, maxTokensDefault: 4096 };
  }

  const selected = ollamaModel || DEFAULT_OLLAMA_MODEL;
  return { provider: 'ollama', model: selected, contextWindow: getContextWindow(selected), maxTokensDefault: 2048 };
}

module.exports = {
  MODEL_RECORDS,
  ALIASES,
  DEFAULT_OLLAMA_MODEL,
  resolveDefaultModel,
  lookupModel,
  getContextWindow,
  inferProvider
};
