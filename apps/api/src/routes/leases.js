/**
 * @file apps/api/src/routes/leases.js
 * Exclusive path leases for parallel agent write deconfliction.
 */

module.exports = async function leasesRoutes(req, res, pathname) {
  if (pathname === '/api/leases' && req.method === 'GET') {
    return this.sendJson(res, 200, { leases: this.leases.list() });
  }

  if (pathname === '/api/leases' && req.method === 'POST') {
    try {
      const body = await this.parseBody(req);
      const lease = this.leases.acquire(body || {});
      return this.sendJson(res, 201, lease);
    } catch (err) {
      const status = err.statusCode || (err.code === 'PATH_LEASE_CONFLICT' ? 409 : 400);
      return this.sendJson(res, status, {
        error: err.message,
        errorCode: err.code,
        conflict: err.conflict || null
      });
    }
  }

  if (pathname === '/api/leases/release' && req.method === 'POST') {
    const body = await this.parseBody(req);
    const id = body.id || body.leaseId;
    if (body.holderId && !id) {
      const count = this.leases.releaseHolder(body.holderId);
      return this.sendJson(res, 200, { released: count });
    }
    const released = this.leases.release(id);
    return this.sendJson(res, released ? 200 : 404, { released });
  }

  if (pathname.startsWith('/api/leases/') && req.method === 'DELETE') {
    const id = decodeURIComponent(pathname.slice('/api/leases/'.length));
    const released = this.leases.release(id);
    return this.sendJson(res, released ? 200 : 404, { released });
  }
};
