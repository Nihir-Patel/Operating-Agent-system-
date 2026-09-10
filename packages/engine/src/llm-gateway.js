/**
 * @file packages/engine/src/llm-gateway.js
 * Universal Model Gateway supporting Anthropic, OpenAI, Gemini, and Ollama
 */

const https = require('https');
const http = require('http');
const url = require('url');
const { inferProvider, resolveDefaultModel } = require('./model-registry');
const { wrapUntrustedContent, wrapUserMessages } = require('./prompt-guard');
const { toAnthropicTools } = require('./agent-tools');

const DEFAULT_TIMEOUT_MS = Number(process.env.OAS_LLM_TIMEOUT_MS) || 60000;
const DEFAULT_RETRIES = Number(process.env.OAS_LLM_RETRIES) || 1;

function extractGeminiText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const texts = [];
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    const chunks = Array.isArray(parsed) ? parsed : [parsed];
    for (const chunk of chunks) {
      const parts = chunk?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part && typeof part.text === 'string') texts.push(part.text);
      }
    }
    if (texts.length) return texts.join('');
  } catch {
    // Fall through to regex extraction of streamed JSON fragments
  }
  const regex = /"text"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    texts.push(JSON.parse(`"${match[1]}"`));
  }
  return texts.join('');
}

function resolveLlmTimeoutMs(params, fallbackMs) {
  const n = Number(params && params.timeoutMs);
  if (Number.isFinite(n) && n > 0) return n;
  return fallbackMs;
}

function isLiveLlmUnavailable(err) {
  if (!err) return false;
  const code = String(err.code || '');
  if (
    code === 'NO_PROVIDER_CONFIGURED'
    || code === 'LLM_TIMEOUT'
    || code === 'ECONNREFUSED'
    || code === 'ENOTFOUND'
    || code === 'ETIMEDOUT'
    || code === 'ECONNRESET'
  ) {
    return true;
  }
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|not configured|timed out/i.test(String(err.message || ''));
}

function isRetryableError(err) {
  if (!err) return false;
  if (err.code === 'NO_PROVIDER_CONFIGURED') return false;
  if (err.code === 'LLM_TIMEOUT') return true;
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|5\d\d/i.test(String(err.code || err.message || ''));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class UniversalModelGateway {
  constructor(options = {}) {
    this.activeProvider = options.provider || process.env.OAS_DEFAULT_PROVIDER || 'auto';
    this.anthropicApiKey = options.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
    this.openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY || '';
    this.geminiApiKey = options.geminiApiKey || process.env.GEMINI_API_KEY || '';
    this.ollamaBaseUrl = options.ollamaHost || options.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.ollamaModel = options.ollamaModel || process.env.OLLAMA_MODEL || resolveDefaultModel();
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : DEFAULT_RETRIES;
  }

  updateSettings(settings = {}) {
    if (settings.provider) this.activeProvider = settings.provider;
    if (settings.anthropicApiKey !== undefined) this.anthropicApiKey = settings.anthropicApiKey;
    if (settings.openaiApiKey !== undefined) this.openaiApiKey = settings.openaiApiKey;
    if (settings.geminiApiKey !== undefined) this.geminiApiKey = settings.geminiApiKey;
    if (settings.ollamaHost) this.ollamaBaseUrl = settings.ollamaHost;
    if (settings.ollamaModel) this.ollamaModel = settings.ollamaModel;
    if (settings.timeoutMs) this.timeoutMs = Number(settings.timeoutMs);
    if (settings.maxRetries !== undefined) this.maxRetries = Number(settings.maxRetries);
  }

  resolveProvider(modelName) {
    return inferProvider(modelName, this.activeProvider, this.ollamaModel);
  }

  async streamCompletion(params, callbacks = {}) {
    const { onError } = callbacks;
    const { provider, model } = this.resolveProvider(params.model);

    if (provider === 'anthropic' && !this.anthropicApiKey) {
      const err = new Error('Anthropic API key not configured. Go to Settings to add your API key, or switch to Ollama.');
      err.code = 'NO_PROVIDER_CONFIGURED';
      if (onError) onError(err);
      throw err;
    }
    if (provider === 'openai' && !this.openaiApiKey) {
      const err = new Error('OpenAI API key not configured. Go to Settings to add your API key, or switch to Ollama.');
      err.code = 'NO_PROVIDER_CONFIGURED';
      if (onError) onError(err);
      throw err;
    }
    if (provider === 'gemini' && !this.geminiApiKey) {
      const err = new Error('Gemini API key not configured. Go to Settings to add your API key, or switch to Ollama.');
      err.code = 'NO_PROVIDER_CONFIGURED';
      if (onError) onError(err);
      throw err;
    }

    let lastError;
    const guardedParams = {
      ...params,
      prompt: wrapUntrustedContent(params.prompt, params),
      messages: wrapUserMessages(params.messages, params)
    };
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (provider === 'anthropic') {
          return await this.callAnthropicStream(guardedParams, model, callbacks);
        }
        if (provider === 'openai') {
          return await this.callOpenAiStream(guardedParams, model, callbacks);
        }
        if (provider === 'gemini') {
          return await this.callGeminiStream(guardedParams, model, callbacks);
        }
        if (provider === 'ollama') {
          return await this.callOllamaStream(guardedParams, model, callbacks);
        }
        const err = new Error(`No supported LLM provider found for: ${provider}. Configure a provider in Settings.`);
        err.code = 'NO_PROVIDER_CONFIGURED';
        throw err;
      } catch (err) {
        lastError = err;
        if (!isRetryableError(err) || attempt === this.maxRetries) {
          if (onError) onError(err);
          throw err;
        }
        await sleep(200 * (attempt + 1));
      }
    }
    if (onError) onError(lastError);
    throw lastError;
  }

  attachTimeout(req, reject, timeoutMs) {
    const ms = resolveLlmTimeoutMs({ timeoutMs }, this.timeoutMs);
    req.setTimeout(ms, () => {
      const err = new Error(`LLM request timed out after ${ms}ms`);
      err.code = 'LLM_TIMEOUT';
      req.destroy(err);
      reject(err);
    });
  }

  async callAnthropicStream(params, model, callbacks) {
    const body = {
      model,
      max_tokens: params.maxTokens || 4096,
      system: params.systemPrompt || '',
      messages: params.messages || [{ role: 'user', content: params.prompt || 'Execute task' }],
      stream: true
    };
    if (params.tools && params.tools.length) {
      body.tools = toAnthropicTools(params.tools);
    }
    const payload = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.anthropicApiKey,
          'anthropic-version': '2023-06-01'
        }
      }, res => {
        let fullText = '';
        res.on('data', chunk => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim();
              if (dataStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  fullText += parsed.delta.text;
                  if (callbacks.onToken) callbacks.onToken(parsed.delta.text);
                }
              } catch {}
            }
          }
        });
        res.on('end', () => {
          if (callbacks.onComplete) callbacks.onComplete(fullText);
          resolve({ text: fullText, provider: 'anthropic', model });
        });
      });

      this.attachTimeout(req, reject, resolveLlmTimeoutMs(params, this.timeoutMs));
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async callOpenAiStream(params, model, callbacks) {
    const body = {
      model,
      messages: [
        ...(params.systemPrompt ? [{ role: 'system', content: params.systemPrompt }] : []),
        ...(params.messages || [{ role: 'user', content: params.prompt || 'Execute task' }])
      ],
      stream: true
    };
    if (params.tools && params.tools.length) {
      body.tools = params.tools;
    }
    const payload = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`
        }
      }, res => {
        let fullText = '';
        res.on('data', chunk => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim();
              if (dataStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(dataStr);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  fullText += delta;
                  if (callbacks.onToken) callbacks.onToken(delta);
                }
              } catch {}
            }
          }
        });
        res.on('end', () => {
          if (callbacks.onComplete) callbacks.onComplete(fullText);
          resolve({ text: fullText, provider: 'openai', model });
        });
      });

      this.attachTimeout(req, reject, resolveLlmTimeoutMs(params, this.timeoutMs));
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async callGeminiStream(params, model, callbacks) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${this.geminiApiKey}`;
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: (params.systemPrompt ? params.systemPrompt + '\n\n' : '') + (params.prompt || 'Execute task') }] }]
    });

    return new Promise((resolve, reject) => {
      const parsedUrl = url.parse(endpoint);
      const req = https.request({
        hostname: parsedUrl.hostname,
        path: parsedUrl.path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, res => {
        let raw = '';
        res.on('data', chunk => {
          raw += chunk.toString();
        });
        res.on('end', () => {
          const fullText = extractGeminiText(raw);
          if (callbacks.onToken && fullText) callbacks.onToken(fullText);
          if (callbacks.onComplete) callbacks.onComplete(fullText);
          resolve({ text: fullText, provider: 'gemini', model });
        });
      });
      this.attachTimeout(req, reject, resolveLlmTimeoutMs(params, this.timeoutMs));
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async callOllamaStream(params, model, callbacks) {
    const parsed = url.parse(this.ollamaBaseUrl);
    const selectedModel = model || this.ollamaModel || resolveDefaultModel();
    const messages = [
      ...(params.systemPrompt ? [{ role: 'system', content: params.systemPrompt }] : []),
      ...(params.messages || [{ role: 'user', content: params.prompt || 'Execute task' }])
    ];
    const chatBody = {
      model: selectedModel,
      messages,
      stream: true,
      options: {
        num_predict: params.maxTokens || 2048,
        num_ctx: params.numCtx || params.contextWindow || 32768
      }
    };
    if (params.tools && params.tools.length) {
      chatBody.tools = params.tools;
    }
    const payload = JSON.stringify(chatBody);

    return new Promise((resolve, reject) => {
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.request({
        hostname: parsed.hostname,
        port: parsed.port || 11434,
        path: '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, res => {
        let fullText = '';
        let buffer = '';
        let toolCalls = [];
        res.on('data', chunk => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const data = JSON.parse(trimmed);
              const token = data.message?.content || data.response || '';
              if (token) {
                fullText += token;
                if (callbacks.onToken) callbacks.onToken(token);
              }
              if (Array.isArray(data.message?.tool_calls) && data.message.tool_calls.length) {
                toolCalls = data.message.tool_calls;
              }
            } catch {}
          }
        });
        res.on('end', () => {
          if (buffer.trim()) {
            try {
              const data = JSON.parse(buffer.trim());
              const token = data.message?.content || data.response || '';
              if (token) fullText += token;
              if (Array.isArray(data.message?.tool_calls) && data.message.tool_calls.length) {
                toolCalls = data.message.tool_calls;
              }
            } catch {}
          }
          if (callbacks.onComplete) callbacks.onComplete(fullText);
          resolve({ text: fullText, toolCalls, provider: 'ollama', model: selectedModel });
        });
      });
      this.attachTimeout(req, reject, resolveLlmTimeoutMs(params, this.timeoutMs));
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}

module.exports = {
  UniversalModelGateway,
  extractGeminiText,
  resolveLlmTimeoutMs,
  isLiveLlmUnavailable
};
