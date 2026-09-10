/**
 * @file packages/engine/src/path-leases.js
 * Exclusive workspace path leases so parallel agents cannot write the same files.
 */

function cloneRecord(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLeasePath(input) {
  const raw = String(input || '').trim().replace(/\\/g, '/');
  const stripped = raw.replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  return stripped;
}

function pathsOverlap(left, right) {
  const a = normalizeLeasePath(left);
  const b = normalizeLeasePath(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(b + '/') || b.startsWith(a + '/');
}

function makeLeaseId() {
  return 'lease_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

class PathLeaseRegistry {
  constructor(options = {}) {
    this.store = options.store;
    this.clock = options.clock || (() => Date.now());
    this.leases = new Map();
    this.hydrate();
  }

  hydrate() {
    if (!this.store || typeof this.store.listPathLeases !== 'function') return;
    for (const record of this.store.listPathLeases() || []) {
      if (record && record.id) this.leases.set(record.id, cloneRecord(record));
    }
    this.purgeExpired();
  }

  persist(lease) {
    if (!this.store || typeof this.store.savePathLease !== 'function') return;
    this.store.savePathLease(cloneRecord(lease));
  }

  removePersisted(id) {
    if (!this.store || typeof this.store.deletePathLease !== 'function') return;
    this.store.deletePathLease(id);
  }

  now() {
    return this.clock();
  }

  purgeExpired() {
    const ts = this.now();
    for (const [id, lease] of [...this.leases.entries()]) {
      if (lease.expiresAt && Date.parse(lease.expiresAt) <= ts) {
        this.leases.delete(id);
        this.removePersisted(id);
      }
    }
  }

  list() {
    this.purgeExpired();
    return [...this.leases.values()].map(cloneRecord);
  }

  findConflict(paths, holderId) {
    const normalized = (paths || []).map(normalizeLeasePath).filter(Boolean);
    for (const lease of this.list()) {
      if (lease.holderId === holderId) continue;
      const overlap = (lease.paths || []).find(owned => normalized.some(p => pathsOverlap(p, owned)));
      if (overlap) {
        return { lease, path: overlap };
      }
    }
    return null;
  }

  acquire(payload = {}) {
    this.purgeExpired();
    const holderId = String(payload.holderId || '').trim();
    const paths = [...new Set((payload.paths || []).map(normalizeLeasePath).filter(Boolean))];
    if (!holderId) {
      const err = new Error('holderId is required');
      err.code = 'LEASE_INVALID';
      err.statusCode = 400;
      throw err;
    }
    if (!paths.length) {
      const err = new Error('At least one path is required');
      err.code = 'LEASE_INVALID';
      err.statusCode = 400;
      throw err;
    }

    const conflict = this.findConflict(paths, holderId);
    if (conflict) {
      const err = new Error(`Path ${conflict.path} is leased by ${conflict.lease.holderId}`);
      err.code = 'PATH_LEASE_CONFLICT';
      err.statusCode = 409;
      err.conflict = { holderId: conflict.lease.holderId, path: conflict.path, leaseId: conflict.lease.id };
      throw err;
    }

    const existing = [...this.leases.values()].find(l => l.holderId === holderId);
    const ttlMs = Number(payload.ttlMs) > 0 ? Number(payload.ttlMs) : 15 * 60 * 1000;
    const mergedPaths = existing
      ? [...new Set([...(existing.paths || []), ...paths])]
      : paths;
    const lease = {
      id: existing ? existing.id : (payload.id || makeLeaseId()),
      holderId,
      sessionId: payload.sessionId || existing?.sessionId || null,
      paths: mergedPaths,
      acquiredAt: existing?.acquiredAt || new Date(this.now()).toISOString(),
      expiresAt: new Date(this.now() + ttlMs).toISOString()
    };
    this.leases.set(lease.id, lease);
    this.persist(lease);
    return cloneRecord(lease);
  }

  release(leaseId) {
    this.purgeExpired();
    if (!this.leases.has(leaseId)) return false;
    this.leases.delete(leaseId);
    this.removePersisted(leaseId);
    return true;
  }

  releaseHolder(holderId) {
    this.purgeExpired();
    let released = 0;
    for (const [id, lease] of [...this.leases.entries()]) {
      if (lease.holderId === holderId) {
        this.leases.delete(id);
        this.removePersisted(id);
        released += 1;
      }
    }
    return released;
  }

  assertWritable(filePath, holderId) {
    this.purgeExpired();
    const target = normalizeLeasePath(filePath);
    if (!target) return true;
    for (const lease of this.leases.values()) {
      const hit = (lease.paths || []).some(owned => pathsOverlap(owned, target));
      if (!hit) continue;
      if (holderId && lease.holderId === holderId) return true;
      const err = new Error(`Path ${target} is leased by ${lease.holderId}`);
      err.code = 'PATH_LEASE_CONFLICT';
      err.statusCode = 409;
      err.conflict = { holderId: lease.holderId, path: target, leaseId: lease.id };
      throw err;
    }
    return true;
  }

  toProximityAgents() {
    return this.list().map(lease => ({
      agentId: lease.holderId,
      files: (lease.paths || []).map(p => ({ path: p })),
      startedAt: lease.acquiredAt,
      intent: lease.paths
    }));
  }
}

module.exports = {
  PathLeaseRegistry,
  pathsOverlap,
  normalizeLeasePath
};
