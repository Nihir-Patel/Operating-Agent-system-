/**
 * @file apps/api/src/routes/core.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

module.exports = async function corejsRoutes(req, res, pathname, parsedUrl) {
if (pathname === '/health' && req.method === 'GET') {
  return this.sendJson(res, 200, {
    status: 'ok',
    service: 'oas-studio',
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
