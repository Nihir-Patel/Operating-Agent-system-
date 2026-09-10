/**
 * @file apps/api/src/routes/core.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

const fs = require('fs');
const path = require('path');

function readPluginVersion(workspaceRoot) {
  try {
    return fs.readFileSync(path.join(workspaceRoot, 'VERSION'), 'utf8').trim();
  } catch {
    return 'unknown';
  }
}

module.exports = async function corejsRoutes(req, res, pathname, _parsedUrl) {
if (pathname === '/health' && req.method === 'GET') {
  return this.sendJson(res, 200, {
    status: 'ok',
    service: 'oas-studio',
    studioVersion: '0.9.0',
    pluginVersion: readPluginVersion(this.workspaceRoot),
    time: new Date().toISOString()
  });
}

// --- REAL-TIME SSE STREAM ---
if (pathname === '/api/stream') {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(`data: ${JSON.stringify({ type: 'connected', time: new Date().toISOString() })}\n\n`);
  this.sseClients.add(res);

  const cleanup = () => {
    this.sseClients.delete(res);
  };

  res.on('error', cleanup);
  res.on('close', cleanup);
  res.on('finish', cleanup);
  req.on('close', cleanup);
  req.on('error', cleanup);
  return;
}
};
