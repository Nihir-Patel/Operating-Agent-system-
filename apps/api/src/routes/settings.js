/**
 * @file apps/api/src/routes/settings.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

const http = require('http');
const https = require('https');
const url = require('url');

function probeHttp(requestOptions, timeoutMs = 4000) {
  return new Promise(resolve => {
    const client = requestOptions.protocol === 'http:' ? http : https;
    const req = client.request(requestOptions, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', err => resolve({ error: err.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ error: 'Connection timed out.' });
    });
    req.end();
  });
}

function cloudKeyMissing(provider, label) {
  return {
    success: false,
    live: false,
    provider,
    message: `${label} API key missing.`,
    error: `${label} API key is not configured.`
  };
}

module.exports = async function settingsRoutes(req, res, pathname, parsedUrl) {
if (pathname === '/api/settings' && req.method === 'GET') {
  return this.sendJson(res, 200, this.store.getSettings());
}

if (pathname === '/api/settings' && req.method === 'POST') {
  const body = await this.parseBody(req);
  const updated = this.store.saveSettings(body);
  if (this.gateway && this.gateway.updateSettings) {
    this.gateway.updateSettings(body);
  }
  if (this.auth && this.auth.updateSettings) {
    this.auth.updateSettings(body);
  }
  return this.sendJson(res, 200, updated);
}

if (pathname === '/api/settings/test' && req.method === 'POST') {
  const body = await this.parseBody(req);
  const provider = body.provider || 'ollama';
  if (provider === 'ollama') {
    const hostUrl = body.ollamaHost || 'http://localhost:11434';
    try {
      const parsed = url.parse(hostUrl);
      const client = parsed.protocol === 'https:' ? https : http;
      const testReq = client.request({
        hostname: parsed.hostname,
        port: parsed.port || 11434,
        path: '/api/tags',
        method: 'GET',
        timeout: 4000
      }, (testRes) => {
        let data = '';
        testRes.on('data', chunk => { data += chunk; });
        testRes.on('end', () => {
          try {
            const parsedData = JSON.parse(data);
            const models = (parsedData.models || []).map(m => m.name);
            return this.sendJson(res, 200, {
              success: true,
              provider: 'ollama',
              models,
              message: `Connected to Ollama! Found ${models.length} model(s): ${models.join(', ')}`
            });
          } catch (e) {
            return this.sendJson(res, 200, { success: true, provider: 'ollama', models: [], message: 'Connected to Ollama endpoint.' });
          }
        });
      });
      testReq.on('error', (err) => {
        return this.sendJson(res, 200, { success: false, provider: 'ollama', error: `Cannot connect to Ollama at ${hostUrl}: ${err.message}` });
      });
      testReq.on('timeout', () => {
        testReq.destroy();
        return this.sendJson(res, 200, { success: false, provider: 'ollama', error: `Connection to ${hostUrl} timed out.` });
      });
      testReq.end();
      res.oasPending = true;
      return;
    } catch (err) {
      return this.sendJson(res, 200, { success: false, provider: 'ollama', error: err.message });
    }
  }
  if (provider === 'anthropic') {
    const key = body.anthropicApiKey || '';
    if (!key) {
      return this.sendJson(res, 200, cloudKeyMissing('anthropic', 'Anthropic'));
    }
    res.oasPending = true;
    const probed = await probeHttp({
      hostname: 'api.anthropic.com',
      path: '/v1/models',
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      }
    });
    if (probed.error) {
      return this.sendJson(res, 200, {
        success: false,
        live: true,
        provider: 'anthropic',
        error: probed.error,
        message: `Live Anthropic check failed: ${probed.error}`
      });
    }
    const ok = probed.statusCode >= 200 && probed.statusCode < 300;
    return this.sendJson(res, 200, {
      success: ok,
      live: true,
      provider: 'anthropic',
      statusCode: probed.statusCode,
      message: ok ? 'Anthropic API accepted the key.' : `Anthropic API returned HTTP ${probed.statusCode}.`,
      error: ok ? undefined : `Anthropic API returned HTTP ${probed.statusCode}.`
    });
  }
  if (provider === 'openai') {
    const key = body.openaiApiKey || '';
    if (!key) {
      return this.sendJson(res, 200, cloudKeyMissing('openai', 'OpenAI'));
    }
    res.oasPending = true;
    const probed = await probeHttp({
      hostname: 'api.openai.com',
      path: '/v1/models',
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` }
    });
    if (probed.error) {
      return this.sendJson(res, 200, {
        success: false,
        live: true,
        provider: 'openai',
        error: probed.error,
        message: `Live OpenAI check failed: ${probed.error}`
      });
    }
    const ok = probed.statusCode >= 200 && probed.statusCode < 300;
    return this.sendJson(res, 200, {
      success: ok,
      live: true,
      provider: 'openai',
      statusCode: probed.statusCode,
      message: ok ? 'OpenAI API accepted the key.' : `OpenAI API returned HTTP ${probed.statusCode}.`,
      error: ok ? undefined : `OpenAI API returned HTTP ${probed.statusCode}.`
    });
  }
  if (provider === 'gemini') {
    const key = body.geminiApiKey || '';
    if (!key) {
      return this.sendJson(res, 200, cloudKeyMissing('gemini', 'Gemini'));
    }
    res.oasPending = true;
    const probed = await probeHttp({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models?key=${encodeURIComponent(key)}`,
      method: 'GET'
    });
    if (probed.error) {
      return this.sendJson(res, 200, {
        success: false,
        live: true,
        provider: 'gemini',
        error: probed.error,
        message: `Live Gemini check failed: ${probed.error}`
      });
    }
    const ok = probed.statusCode >= 200 && probed.statusCode < 300;
    return this.sendJson(res, 200, {
      success: ok,
      live: true,
      provider: 'gemini',
      statusCode: probed.statusCode,
      message: ok ? 'Gemini API accepted the key.' : `Gemini API returned HTTP ${probed.statusCode}.`,
      error: ok ? undefined : `Gemini API returned HTTP ${probed.statusCode}.`
    });
  }
  return this.sendJson(res, 200, { success: true, live: false, provider });
}

};
