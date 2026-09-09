/**
 * @file apps/api/src/middleware/auth.js
 * OAS Control Plane Authentication & Rate Limiting Middleware
 */

class AuthMiddleware {
  constructor(options = {}) {
    this.token = options.token || process.env.OAS_API_TOKEN || null;
    this.bindHost = options.bindHost || '127.0.0.1';
    this.rateLimitWindowMs = options.rateLimitWindowMs || 60000;
    this.maxRequestsPerWindow = options.maxRequestsPerWindow || 300;
    this.requestCounts = new Map(); // ip -> { count, windowStart }
  }

  isLoopbackHost(host) {
    if (!host) return true;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  }

  isLoopbackRequest(req) {
    if (this.isLoopbackHost(this.bindHost)) return true;
    const ip = (req && req.headers && req.headers['x-forwarded-for'])
      || (req && req.socket && req.socket.remoteAddress)
      || '127.0.0.1';
    const first = String(ip).split(',')[0].trim();
    return first === '127.0.0.1' || first === '::1' || first === '::ffff:127.0.0.1';
  }

  updateSettings(settings = {}) {
    if (settings.apiToken !== undefined) this.token = settings.apiToken || null;
    if (settings.rateLimitWindowMs) this.rateLimitWindowMs = Number(settings.rateLimitWindowMs);
    if (settings.maxRequestsPerWindow) this.maxRequestsPerWindow = Number(settings.maxRequestsPerWindow);
  }

  isPublicRoute(pathname, method) {
    // Static assets and UI controller are always public
    if (method === 'GET' && (
      pathname === '/' ||
      pathname === '/index.html' ||
      pathname === '/styles.css' ||
      pathname === '/app.js' ||
      pathname === '/favicon.ico' ||
      pathname === '/api/stream' ||
      pathname === '/health'
    )) {
      return true;
    }
    return false;
  }

  checkRateLimit(req) {
    const ip = req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
    const now = Date.now();
    let client = this.requestCounts.get(ip);

    if (!client || now - client.windowStart > this.rateLimitWindowMs) {
      client = { count: 1, windowStart: now };
      this.requestCounts.set(ip, client);
      return { allowed: true, remaining: this.maxRequestsPerWindow - 1 };
    }

    client.count++;
    if (client.count > this.maxRequestsPerWindow) {
      const retryAfterSec = Math.ceil((client.windowStart + this.rateLimitWindowMs - now) / 1000);
      return { allowed: false, retryAfterSec, remaining: 0 };
    }

    return { allowed: true, remaining: this.maxRequestsPerWindow - client.count };
  }

  authenticate(req, pathname, method) {
    // If rate limited, reject immediately
    const rateCheck = this.checkRateLimit(req);
    if (!rateCheck.allowed) {
      return {
        authorized: false,
        statusCode: 429,
        error: 'Too Many Requests',
        retryAfter: rateCheck.retryAfterSec
      };
    }

    if (!this.token) {
      if (this.isLoopbackRequest(req)) {
        return { authorized: true };
      }
      return {
        authorized: false,
        statusCode: 401,
        error: 'OAS_API_TOKEN is required for non-loopback access.'
      };
    }

    // Public UI and assets bypass auth
    if (this.isPublicRoute(pathname, method)) {
      return { authorized: true };
    }

    // Extract credentials from Authorization header or query or x-api-key
    const authHeader = req.headers['authorization'] || '';
    const apiKeyHeader = req.headers['x-api-key'] || '';

    let suppliedToken = '';
    if (authHeader.startsWith('Bearer ')) {
      suppliedToken = authHeader.slice(7).trim();
    } else if (apiKeyHeader) {
      suppliedToken = apiKeyHeader.trim();
    }

    if (!suppliedToken || suppliedToken !== this.token) {
      return {
        authorized: false,
        statusCode: 401,
        error: 'Unauthorized: Invalid or missing API token.'
      };
    }

    return { authorized: true };
  }
}

module.exports = {
  AuthMiddleware
};
