/**
 * @file apps/api/src/middleware/auth.js
 * OAS Control Plane Authentication & Rate Limiting Middleware
 */

const crypto = require('crypto');

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

  clientAddress(req) {
    return (req && req.socket && req.socket.remoteAddress) || '';
  }

  isLoopbackRequest(req) {
    if (this.isLoopbackHost(this.bindHost)) return true;
    const remote = this.clientAddress(req);
    return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  }

  updateSettings(settings = {}) {
    if (settings.apiToken !== undefined) this.token = settings.apiToken || null;
    if (settings.rateLimitWindowMs) this.rateLimitWindowMs = Number(settings.rateLimitWindowMs);
    if (settings.maxRequestsPerWindow) this.maxRequestsPerWindow = Number(settings.maxRequestsPerWindow);
  }

  isPublicRoute(pathname, method) {
    if (method === 'GET' && (
      pathname === '/' ||
      pathname === '/index.html' ||
      pathname === '/styles.css' ||
      pathname === '/app.js' ||
      pathname === '/favicon.ico' ||
      pathname === '/health' ||
      (typeof pathname === 'string' && pathname.startsWith('/js/') && !pathname.includes('..'))
    )) {
      return true;
    }
    return false;
  }

  parseCookieToken(cookieHeader) {
    if (!cookieHeader) return '';
    const parts = String(cookieHeader).split(';');
    for (const part of parts) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      if (key !== 'oas_api_token') continue;
      const raw = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
    return '';
  }

  extractToken(req) {
    const headers = (req && req.headers) || {};
    const authHeader = headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    if (headers['x-api-key']) {
      return String(headers['x-api-key']).trim();
    }
    const cookieToken = this.parseCookieToken(headers.cookie);
    if (cookieToken) return cookieToken;
    const reqUrl = req && req.url;
    if (!reqUrl) return '';
    try {
      const parsed = new URL(reqUrl, 'http://127.0.0.1');
      return (parsed.searchParams.get('token') || parsed.searchParams.get('access_token') || '').trim();
    } catch {
      return '';
    }
  }

  tokensMatch(supplied) {
    if (!this.token || !supplied) return false;
    const expected = Buffer.from(String(this.token));
    const actual = Buffer.from(String(supplied));
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  }

  checkRateLimit(req) {
    const ip = this.clientAddress(req) || 'unknown';
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

    if (this.isPublicRoute(pathname, method)) {
      return { authorized: true };
    }

    const suppliedToken = this.extractToken(req);
    if (!this.tokensMatch(suppliedToken)) {
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
