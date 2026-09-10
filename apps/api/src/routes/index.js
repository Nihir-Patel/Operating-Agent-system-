/**
 * @file apps/api/src/routes/index.js
 * Ordered route dispatch for OAS Control Plane
 */

const handlers = [
  require('./core'),
  require('./catalog'),
  require('./graph'),
  require('./filesystem'),
  require('./settings'),
  require('./sessions'),
  require('./worktrees'),
  require('./leases'),
  require('./inbox'),
  require('./arena'),
  require('./read-plane'),
  require('./platform'),
  require('./llm-ops'),
  require('./compliance'),
  require('./static-assets')
];

async function dispatchRoutes(server, req, res, pathname, parsedUrl) {
  for (const handler of handlers) {
    await handler.call(server, req, res, pathname, parsedUrl);
    if (res.headersSent || res.writableEnded || res.destroyed || res.oasPending || res.oasSent) {
      return true;
    }
  }
  return false;
}

module.exports = { dispatchRoutes };
