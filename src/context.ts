import type { Config, Context, BypassResult } from './types';

export const CACHE_PREFIX = 'fpc:';

export function createContext(request: Request, env: Env, config: Config): Context {
  const url = new URL(request.url);
  const normalized = normalizeUrl(url, config);
  const headers = request.headers;
  const isGraphql = normalized.pathname.startsWith(config.graphqlPath);
  const magentoCacheId = headers.get('X-Magento-Cache-Id') || '';
  const authHeader = headers.get('Authorization') || '';

  return {
    request,
    env,
    config,
    originalUrl: url.href,
    url: normalized.url,
    pathname: normalized.pathname,
    search: normalized.search,
    marketingRemoved: normalized.marketingRemoved,
    cookieHeader: headers.get('Cookie') || '',
    sslOffloaded: headers.get('CF-Visitor') || headers.get('X-Forwarded-Proto') || '',
    isStatic: config.staticPathPattern.test(normalized.pathname),
    isHealthCheck: config.healthCheckPattern.test(normalized.pathname),
    isGraphql,
    magentoCacheId,
    hasAuthToken: /^Bearer\s+/i.test(authHeader),
    authHeader,
    store: headers.get('Store') || headers.get('X-Store') || '',
    currency: headers.get('Content-Currency') || headers.get('X-Currency') || '',
    cacheKey: null
  };
}

function normalizeUrl(url: URL, config: Config): { url: URL; pathname: string; search: string; marketingRemoved: string[] } {
  const normalized = new URL(url.href);
  const marketingRemoved = stripMarketingParams(normalized, config);
  return {
    url: normalized,
    pathname: normalized.pathname,
    search: normalized.search,
    marketingRemoved
  };
}

function stripMarketingParams(url: URL, config: Config): string[] {
  const removed: string[] = [];
  const params = url.searchParams;
  if (!params || Array.from(params.keys()).length === 0) return removed;

  const patterns = config.marketingParams;
  const keys = Array.from(params.keys());

  for (const key of keys) {
    if (patterns.some(pattern => matchesPattern(key, pattern))) {
      removed.push(key);
      params.delete(key);
    }
  }

  url.search = params.toString() ? `?${params.toString()}` : '';
  return removed;
}

function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.endsWith('*')) {
    return value.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase());
  }
  return value.toLowerCase() === pattern.toLowerCase();
}

export function shouldBypass(context: Context): BypassResult {
  const { request, config, isGraphql, hasAuthToken, magentoCacheId, pathname, isStatic, isHealthCheck } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return { bypass: true, reason: `method:${request.method}` };
  }

  if (request.method === 'HEAD' && request.headers.get('Range')) {
    return { bypass: true, reason: 'range-head' };
  }

  if (isHealthCheck) return { bypass: true, reason: 'health-check' };
  if (isStatic) return { bypass: true, reason: 'static-path' };

  if (config.excludedPaths.some(path => pathname.includes(path))) {
    return { bypass: true, reason: 'excluded-path' };
  }

  if (isGraphql && hasAuthToken && !magentoCacheId) {
    return { bypass: true, reason: 'graphql-auth-pass' };
  }

  return { bypass: false, reason: '' };
}

export function computeCacheKey(context: Context): string {
  const { url, config, magentoCacheId, isGraphql, cookieHeader, sslOffloaded, store, currency, hasAuthToken } = context;
  let key = `${CACHE_PREFIX}${url.hostname}${url.pathname}`;

  const params = url.searchParams;
  if ([...params.keys()].length) {
    const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (pairs.length) {
      key += `?${pairs.map(([k, v]) => `${k}=${v}`).join('&')}`;
    }
  }

  if (isGraphql && magentoCacheId) {
    key += `::graphql:${magentoCacheId}`;
    if (hasAuthToken) key += ':authorized';
  } else {
    const varyCookie = extractCookieValue(cookieHeader, config.varyCookies);
    if (varyCookie) key += `::vary:${varyCookie}`;
  }

  if (sslOffloaded) key += `::ssl:${sslOffloaded}`;

  if (isGraphql) {
    if (store) key += `::store:${store}`;
    if (currency) key += `::currency:${currency}`;
  }

  return key;
}

function extractCookieValue(cookieHeader: string, names: string[]): string {
  if (!cookieHeader || !names.length) return '';

  const cookies = cookieHeader.split(';').map(chunk => chunk.trim()).filter(Boolean);
  const wanted: string[] = [];

  for (const name of names) {
    const found = cookies.find(cookie => cookie.toLowerCase().startsWith(`${name.toLowerCase()}=`));
    if (found) wanted.push(found.split('=')[1] || '');
  }

  return wanted.join('_');
}
