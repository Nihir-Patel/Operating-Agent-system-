/**
 * Studio control-plane auth: token storage, Authorization headers, SSE URL.
 */

export const OAS_API_TOKEN_STORAGE_KEY = 'oas-api-token';
export const OAS_API_TOKEN_COOKIE = 'oas_api_token';

const nativeFetch = typeof window !== 'undefined' && window.fetch
  ? window.fetch.bind(window)
  : null;

export function persistApiToken(token) {
  const value = String(token || '').trim();
  try {
    if (value) sessionStorage.setItem(OAS_API_TOKEN_STORAGE_KEY, value);
    else sessionStorage.removeItem(OAS_API_TOKEN_STORAGE_KEY);
  } catch {}
  try {
    if (value) {
      document.cookie = OAS_API_TOKEN_COOKIE + '=' + encodeURIComponent(value) + '; Path=/; SameSite=Strict';
    } else {
      document.cookie = OAS_API_TOKEN_COOKIE + '=; Path=/; Max-Age=0; SameSite=Strict';
    }
  } catch {}
}

export function getApiToken() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('token');
    if (fromQuery) {
      persistApiToken(fromQuery);
      return fromQuery;
    }
  } catch {}
  try {
    return sessionStorage.getItem(OAS_API_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function attachAuthHeaders(existing) {
  const headers = new Headers();
  if (existing instanceof Headers) {
    existing.forEach((value, key) => headers.set(key, value));
  } else if (Array.isArray(existing)) {
    existing.forEach(pair => headers.set(pair[0], pair[1]));
  } else if (existing && typeof existing === 'object') {
    Object.keys(existing).forEach(key => headers.set(key, existing[key]));
  }
  const token = getApiToken();
  if (token) {
    if (!headers.get('Authorization')) headers.set('Authorization', 'Bearer ' + token);
    if (!headers.get('x-api-key')) headers.set('x-api-key', token);
  }
  return headers;
}

export function isControlPlaneUrl(input) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  return String(url).includes('/api/');
}

export function getSseStreamUrl() {
  const token = getApiToken();
  return token ? '/api/stream?token=' + encodeURIComponent(token) : '/api/stream';
}

export function installAuthenticatedFetch(hooks = {}) {
  if (!nativeFetch || typeof window === 'undefined') return;
  window.fetch = function oasAuthenticatedFetch(input, init) {
    const source = init || {};
    const options = Object.assign({}, source);
    const alreadyRetried = source._oasAuthRetry === true;
    delete options._oasAuthRetry;
    if (isControlPlaneUrl(input)) {
      options.headers = attachAuthHeaders(source.headers);
    }
    return nativeFetch(input, options).then(res => {
      if (res.status !== 401 || alreadyRetried || !isControlPlaneUrl(input)) {
        return res;
      }
      const entered = typeof window.prompt === 'function'
        ? window.prompt('Control plane API token required. Enter OAS_API_TOKEN:')
        : '';
      if (!entered) return res;
      persistApiToken(entered);
      if (typeof hooks.onAuthRetry === 'function') {
        hooks.onAuthRetry();
      }
      return nativeFetch(input, Object.assign({}, options, {
        headers: attachAuthHeaders(options.headers)
      }));
    });
  };
}
