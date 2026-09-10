/**
 * @file packages/engine/src/model-router.js
 * Choose a provider/model from settings, remaining budget, and configured keys.
 */

const { inferProvider } = require('./model-registry');

function remainingBudget(ledgerSummary = {}) {
  const budgetUsd = Number(ledgerSummary.budgetUsd != null ? ledgerSummary.budgetUsd : 10);
  const spent = Number(ledgerSummary.totals && ledgerSummary.totals.usd) || 0;
  return budgetUsd - spent;
}

function hasProviderKey(settings = {}, provider) {
  if (provider === 'anthropic') return Boolean(settings.anthropicApiKey);
  if (provider === 'openai') return Boolean(settings.openaiApiKey);
  if (provider === 'gemini') return Boolean(settings.geminiApiKey);
  return true;
}

function localRoute(settings = {}, reason) {
  const inferred = inferProvider(settings.ollamaModel, 'ollama', settings.ollamaModel);
  return {
    provider: inferred.provider,
    model: inferred.model,
    contextWindow: inferred.contextWindow,
    maxTokensDefault: inferred.maxTokensDefault,
    fallback: true,
    reason
  };
}

function resolveRoute(settings = {}, preferredModel, ledgerSummary = {}) {
  const requested = inferProvider(
    preferredModel || settings.defaultModel,
    settings.provider,
    settings.ollamaModel
  );

  if (remainingBudget(ledgerSummary) <= 0 && requested.provider !== 'ollama') {
    return localRoute(settings, 'budget-exhausted');
  }

  if (requested.provider !== 'ollama' && !hasProviderKey(settings, requested.provider)) {
    return localRoute(settings, 'missing-api-key');
  }

  return {
    provider: requested.provider,
    model: requested.model,
    contextWindow: requested.contextWindow,
    maxTokensDefault: requested.maxTokensDefault,
    fallback: false,
    reason: 'requested'
  };
}

function assertWithinBudget(ledgerSummary = {}) {
  if (remainingBudget(ledgerSummary) <= 0) {
    const err = new Error('Session budget exceeded');
    err.code = 'BUDGET_EXCEEDED';
    err.statusCode = 402;
    throw err;
  }
  return true;
}

module.exports = {
  remainingBudget,
  resolveRoute,
  assertWithinBudget
};
