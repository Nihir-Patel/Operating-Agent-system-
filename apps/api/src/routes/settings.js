/**
 * @file apps/api/src/routes/settings.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

const http = require('http');
const https = require('https');
const url = require('url');

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
    return this.sendJson(res, 200, { success: !!key, provider: 'anthropic', message: key ? 'Anthropic API key configured.' : 'Anthropic API key missing.' });
  }
  if (provider === 'openai') {
    const key = body.openaiApiKey || '';
    return this.sendJson(res, 200, { success: !!key, provider: 'openai', message: key ? 'OpenAI API key configured.' : 'OpenAI API key missing.' });
  }
  if (provider === 'gemini') {
    const key = body.geminiApiKey || '';
    return this.sendJson(res, 200, { success: !!key, provider: 'gemini', message: key ? 'Gemini API key configured.' : 'Gemini API key missing.' });
  }
  return this.sendJson(res, 200, { success: true, provider });
}

};
