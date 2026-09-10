/**
 * @file packages/engine/src/cost-ledger.js
 * Per-provider token cost estimation and inference event recording.
 */

const PROVIDER_RATES_PER_MILLION = {
  ollama: { input: 0, output: 0 },
  anthropic: { input: 3, output: 15 },
  openai: { input: 2.5, output: 10 },
  gemini: { input: 1.25, output: 5 }
};

const MODEL_RATES_PER_MILLION = {
  'claude-3-7-sonnet': { input: 3, output: 15 },
  'claude-3-7-opus': { input: 15, output: 75 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'gemini-2.5-pro': { input: 1.25, output: 10 }
};

function round6(value) {
  return Number((Number(value) || 0).toFixed(6));
}

function resolveRates(provider, model) {
  if (MODEL_RATES_PER_MILLION[model]) return MODEL_RATES_PER_MILLION[model];
  const key = String(provider || '').toLowerCase();
  return PROVIDER_RATES_PER_MILLION[key] || { input: 3, output: 15 };
}

function estimateCostUsd(input = {}) {
  const provider = input.provider || 'unknown';
  const model = input.model || '';
  const rates = resolveRates(provider, model);
  const promptTokens = Number(input.promptTokens != null ? input.promptTokens : input.prompt_tokens) || 0;
  const completionTokens = Number(input.completionTokens != null ? input.completionTokens : input.completion_tokens) || 0;
  if (promptTokens || completionTokens) {
    return round6((promptTokens * rates.input + completionTokens * rates.output) / 1e6);
  }
  const tokens = Number(input.tokens) || 0;
  const blended = (rates.input + rates.output) / 2;
  return round6((tokens * blended) / 1e6);
}

function summarizeCostLedger(events = [], options = {}) {
  const budgetUsd = Number(options.budgetUsd != null ? options.budgetUsd : 10);
  const totals = {
    usd: 0,
    tokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    byProvider: {}
  };
  const list = Array.isArray(events) ? events : [];
  for (const event of list) {
    const usd = Number(event.usd) || 0;
    const promptTokens = Number(event.prompt_tokens || event.promptTokens) || 0;
    const completionTokens = Number(event.completion_tokens || event.completionTokens) || 0;
    const tokens = Number(event.tokens) || (promptTokens + completionTokens);
    const provider = event.provider || 'unknown';
    totals.usd = round6(totals.usd + usd);
    totals.tokens += tokens;
    totals.promptTokens += promptTokens;
    totals.completionTokens += completionTokens;
    totals.byProvider = {
      ...totals.byProvider,
      [provider]: round6((totals.byProvider[provider] || 0) + usd)
    };
  }
  return {
    events: list,
    totals,
    budgetUsd,
    remainingUsd: round6(Math.max(0, budgetUsd - totals.usd))
  };
}

function recordInferenceCost(store, payload = {}) {
  const promptTokens = Number(payload.promptTokens != null ? payload.promptTokens : payload.prompt_tokens) || 0;
  const completionTokens = Number(payload.completionTokens != null ? payload.completionTokens : payload.completion_tokens) || 0;
  const tokens = Number(payload.tokens) || (promptTokens + completionTokens);
  const event = {
    id: payload.id || ('cost_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)),
    session_id: payload.sessionId || payload.session_id || null,
    provider: payload.provider || 'unknown',
    model: payload.model || '',
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    tokens,
    usd: estimateCostUsd({
      provider: payload.provider,
      model: payload.model,
      promptTokens,
      completionTokens,
      tokens
    }),
    created_at: payload.created_at || new Date().toISOString()
  };

  if (store && typeof store.addCostEvent === 'function') {
    store.addCostEvent(event);
  }
  if (event.session_id && store && typeof store.addSessionCost === 'function') {
    store.addSessionCost(event.session_id, {
      tokens: event.tokens,
      usd: event.usd,
      promptTokens: event.prompt_tokens,
      completionTokens: event.completion_tokens
    });
  }
  return event;
}

module.exports = {
  PROVIDER_RATES_PER_MILLION,
  MODEL_RATES_PER_MILLION,
  estimateCostUsd,
  summarizeCostLedger,
  recordInferenceCost
};
