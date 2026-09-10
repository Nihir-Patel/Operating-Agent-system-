/**
 * @file apps/api/src/routes/filesystem.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

module.exports = async function filesystemjsRoutes(req, res, pathname, parsedUrl) {
if (pathname === '/api/fs/tree' && req.method === 'GET') {
  const tree = this.getWorkspaceFileTree(this.workspaceRoot);
  return this.sendJson(res, 200, { root: this.workspaceRoot, tree });
}

if (pathname === '/api/fs/read' && req.method === 'GET') {
  const filePath = parsedUrl.query.path;
  if (!filePath) {
    return this.sendJson(res, 400, { error: 'Query parameter "path" is required' });
  }
  try {
    const fileData = this.readWorkspaceFile(filePath);
    return this.sendJson(res, 200, fileData);
  } catch (err) {
    return this.sendJson(res, 400, { error: err.message });
  }
}

if (pathname === '/api/fs/write' && req.method === 'POST') {
  try {
    const body = await this.parseBody(req);
    const result = this.writeWorkspaceFile(body.path, body.content ?? '', {
      holderId: body.holderId || body.agentId
    });
    return this.sendJson(res, 200, result);
  } catch (err) {
    const status = err.statusCode || (err.code === 'PATH_LEASE_CONFLICT' ? 409 : 400);
    return this.sendJson(res, status, {
      error: err.message,
      errorCode: err.code || 'FS_WRITE_FAILED',
      conflict: err.conflict || null
    });
  }
}

if (pathname === '/api/fs/diff' && req.method === 'POST') {
  try {
    const body = await this.parseBody(req);
    let orig = body.original;
    if (orig === undefined && body.path) {
      try {
        const readRes = this.readWorkspaceFile(body.path);
        orig = readRes.content;
      } catch {
        orig = '';
      }
    }
    const diffResult = this.computeSimpleDiff(orig, body.modified ?? '', body.path || 'file');
    return this.sendJson(res, 200, diffResult);
  } catch (err) {
    return this.sendJson(res, 400, { error: err.message });
  }
}

};
