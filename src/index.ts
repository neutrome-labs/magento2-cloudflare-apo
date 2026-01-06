/// <reference types="@cloudflare/workers-types" />

interface Config {
  defaultTtl: number;
  graceSeconds: number;
  respectPrivateNoCache: boolean;
  respectCacheControl: boolean;
  hitForPassSeconds: number;
  cacheLoggedIn: boolean;
  debug: boolean;
  purgeSecret: string;
  staticPathPattern: RegExp;
  healthCheckPattern: RegExp;
  marketingParams: string[];
  excludedPaths: string[];
  graphqlPath: string;
  varyCookies: string[];
  allowedCookieNames: string[];
  includedResponseTypes: string[];
}

interface Context {
  request: Request;
  env: Env;
  config: Config;
  originalUrl: string;
  url: URL;
  pathname: string;
  search: string;
  marketingRemoved: string[];
  cookieHeader: string;
  sslOffloaded: string;
  isStatic: boolean;
  isHealthCheck: boolean;
  isGraphql: boolean;
  magentoCacheId: string;
  hasAuthToken: boolean;
  authHeader: string;
  store: string;
  currency: string;
  cacheKey: string | null;
}

interface CacheRecord {
  state: 'cache' | 'pass';
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  expires: number;
  staleUntil?: number;
}

interface BypassResult {
  bypass: boolean;
  reason: string;
}

interface FetchResult {
  response: Response;
  cacheResult?: CacheRecord;
  skipCache?: boolean;
  uncacheableReason?: string;
}

const CACHE_PREFIX = 'fpc:';

const DEFAULTS = {
  DEFAULT_TTL: 86400,
  GRACE_SECONDS: 259200,
  HIT_FOR_PASS_SECONDS: 120,
  RESPECT_PRIVATE_NO_CACHE: false,
  RESPECT_CACHE_CONTROL: false,
  CACHE_LOGGED_IN: true,
  DEBUG: false,
  STATIC_PATH_PATTERN: '^/(?:pub/)?(?:media|static)/',
  HEALTH_CHECK_PATTERN: '^/(?:pub/)?health_check\\.php$',
  MARKETING_PARAMS: ['gclid', 'cx', 'ie', 'cof', 'siteurl', 'zanpid', 'origin', 'fbclid', 'mc_*', 'utm_*', '_bta_*'],
  EXCLUDED_PATHS: ['/admin', '/customer', '/section/load', '/checkout', '/wishlist', '/cart', '/sales', '/rest/', '/onestepcheckout', '/password'],
  GRAPHQL_PATH: '/graphql',
  VARY_COOKIES: ['X-Magento-Vary'],
  ALLOWED_COOKIE_NAMES: ['X-Magento-Vary', 'store', 'currency', 'form_key', 'private_content_version', 'section_data_ids', 'mage-cache-sessid', 'mage-cache-storage', 'mage-cache-storage-section-invalidation', 'mage-messages'],
  INCLUDED_RESPONSE_TYPES: ['text/html', 'text/css', 'text/javascript', 'application/javascript']
} as const;

function envBool(val: string | undefined, fallback: boolean): boolean {
  if (val === undefined) return fallback;
  return val === 'true';
}

function envInt(val: string | undefined, fallback: number): number {
  return val ? parseInt(val, 10) : fallback;
}

function envArray(val: string | undefined, fallback: readonly string[]): string[] {
  if (!val) return [...fallback];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [...fallback];
  } catch {
    return [...fallback];
  }
}

function buildConfig(env: Env): Config {
  return {
    defaultTtl: envInt(env.DEFAULT_TTL, DEFAULTS.DEFAULT_TTL),
    graceSeconds: envInt(env.GRACE_SECONDS, DEFAULTS.GRACE_SECONDS),
    hitForPassSeconds: envInt(env.HIT_FOR_PASS_SECONDS, DEFAULTS.HIT_FOR_PASS_SECONDS),
    respectPrivateNoCache: envBool(env.RESPECT_PRIVATE_NO_CACHE, DEFAULTS.RESPECT_PRIVATE_NO_CACHE),
    respectCacheControl: envBool(env.RESPECT_CACHE_CONTROL, DEFAULTS.RESPECT_CACHE_CONTROL),
    cacheLoggedIn: envBool(env.CACHE_LOGGED_IN, DEFAULTS.CACHE_LOGGED_IN),
    debug: envBool(env.DEBUG, DEFAULTS.DEBUG),
    purgeSecret: env.PURGE_SECRET || '',
    staticPathPattern: new RegExp(env.STATIC_PATH_PATTERN || DEFAULTS.STATIC_PATH_PATTERN),
    healthCheckPattern: new RegExp(env.HEALTH_CHECK_PATTERN || DEFAULTS.HEALTH_CHECK_PATTERN),
    marketingParams: envArray(env.MARKETING_PARAMS, DEFAULTS.MARKETING_PARAMS),
    excludedPaths: envArray(env.EXCLUDED_PATHS, DEFAULTS.EXCLUDED_PATHS),
    graphqlPath: env.GRAPHQL_PATH || DEFAULTS.GRAPHQL_PATH,
    varyCookies: envArray(env.VARY_COOKIES, DEFAULTS.VARY_COOKIES),
    allowedCookieNames: envArray(env.ALLOWED_COOKIE_NAMES, DEFAULTS.ALLOWED_COOKIE_NAMES),
    includedResponseTypes: envArray(env.INCLUDED_RESPONSE_TYPES, DEFAULTS.INCLUDED_RESPONSE_TYPES)
  };
}

function debugLog(config: Config, ...args: unknown[]): void {
  if (config.debug) {
    console.log('[FPC DEBUG]', ...args);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const config = buildConfig(env);
    const context = createContext(request, env, config);

    debugLog(config, `Request ${request.method} ${context.originalUrl}`);

    if (request.method === 'POST' && request.headers.get('X-Purge-Secret')) {
      return handlePurgeRequest(context);
    }

    const bypass = shouldBypass(context);
    if (bypass.bypass) {
      debugLog(config, `Bypass: ${bypass.reason}`);
      const response = await fetchFromOrigin(context);
      return finalizeResponse(response, context, 'UNCACHEABLE');
    }

    const cacheKey = computeCacheKey(context);
    context.cacheKey = cacheKey;
    debugLog(config, `Cache key => ${cacheKey}`);

    const record = await readCacheRecord(env.FPC_CACHE, cacheKey);
    const now = Date.now();

    if (record?.state === 'pass' && record.expires > now) {
      debugLog(config, `Hit-for-pass active (${record.expires - now}ms remaining)`);
      const response = await fetchFromOrigin(context);
      return finalizeResponse(response, context, 'UNCACHEABLE');
    }

    if (record?.state === 'cache') {
      if (record.expires > now) {
        debugLog(config, `Cache HIT, ttl left ${((record.expires - now) / 1000) | 0}s`);
        return buildCachedResponse(record, context, 'HIT');
      }

      if (record.staleUntil && record.staleUntil > now) {
        debugLog(config, `Cache STALE, grace left ${((record.staleUntil - now) / 1000) | 0}s`);
        ctx.waitUntil(revalidate(context, record));
        return buildCachedResponse(record, context, 'STALE');
      }

      debugLog(config, 'Cached record expired beyond grace, treating as miss');
    }

    const { response, cacheResult, skipCache, uncacheableReason } = await fetchCacheableResponse(context);

    if (cacheResult) {
      await writeCacheRecord(env.FPC_CACHE, cacheKey, cacheResult);
    } else if (skipCache && uncacheableReason === 'hit-for-pass') {
      await storeHitForPass(env.FPC_CACHE, cacheKey, context);
    }

    return finalizeResponse(response, context, skipCache ? 'UNCACHEABLE' : 'MISS');
  }
};

function createContext(request: Request, env: Env, config: Config): Context {
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

function shouldBypass(context: Context): BypassResult {
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

function computeCacheKey(context: Context): string {
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

async function readCacheRecord(kv: KVNamespace, cacheKey: string): Promise<CacheRecord | null> {
  return kv.get<CacheRecord>(cacheKey, 'json');
}

function buildCachedResponse(record: CacheRecord, context: Context, status: string): Response {
  const headers = new Headers(record.headers || {});
  headers.set('X-FPC-Cache', status);
  if (status === 'STALE') headers.set('X-FPC-Grace', 'normal');
  headers.set('X-Magento-Cache-Debug', status === 'HIT' || status === 'STALE' ? 'HIT' : status);

  const responseInit = { status: record.status || 200, statusText: record.statusText || '', headers };
  const body = record.body ?? '';

  const response = context.request.method === 'HEAD'
    ? new Response(null, responseInit)
    : new Response(body, responseInit);

  return finalizeResponse(response, context, status, { fromCache: true });
}

async function revalidate(context: Context, _record: CacheRecord): Promise<void> {
  try {
    await fetchCacheableResponse(context);
  } catch (err) {
    debugLog(context.config, 'Revalidate error', err);
  }
}

async function fetchCacheableResponse(context: Context): Promise<FetchResult> {
  const response = await fetchFromOrigin(context);
  const clone = response.clone();
  const { config, env } = context;

  const status = clone.status;
  const headers = new Headers(clone.headers);
  const cacheControl = headers.get('Cache-Control') || '';
  const surrogate = headers.get('Surrogate-Control') || '';
  const vary = headers.get('Vary') || '';
  const setCookie = headers.get('Set-Cookie');

  if ((status !== 200 && status !== 404) || /private/i.test(cacheControl)) {
    return { response, skipCache: true, uncacheableReason: 'status' };
  }

  const noStoreHeader = /no-store|no-cache/i.test(cacheControl) || /no-store/i.test(surrogate);
  if ((config.respectPrivateNoCache && noStoreHeader) || vary === '*') {
    debugLog(config, `Marking hit-for-pass: cache-control='${cacheControl}' surrogate='${surrogate}' vary='${vary}'`);
    return { response, skipCache: true, uncacheableReason: 'hit-for-pass' };
  }

  if (setCookie) headers.delete('Set-Cookie');

  if (headers.get('X-Magento-Debug')) {
    headers.set('X-Magento-Cache-Control', cacheControl);
  }

  let ttlSeconds = deriveTtl(cacheControl, config);
  if (ttlSeconds <= 0) ttlSeconds = config.defaultTtl;

  const bodyText = await clone.text();
  if (bodyText.length < 3) {
    return { response, skipCache: true, uncacheableReason: 'body-too-small' };
  }

  if (context.isGraphql && context.magentoCacheId) {
    const responseCacheId = headers.get('X-Magento-Cache-Id');
    if (responseCacheId && responseCacheId !== context.magentoCacheId) {
      debugLog(config, `GraphQL cache-id mismatch request=${context.magentoCacheId} response=${responseCacheId}`);
      return { response, skipCache: true, uncacheableReason: 'graphql-mismatch' };
    }
  }

  const expires = Date.now() + ttlSeconds * 1000;
  const staleUntil = expires + config.graceSeconds * 1000;
  const responseHeaders = sanitizeHeaders(headers, context);

  const cacheRecord: CacheRecord = {
    state: 'cache',
    status,
    statusText: clone.statusText || '',
    headers: responseHeaders,
    body: bodyText,
    expires,
    staleUntil
  };

  if (context.cacheKey) {
    await writeCacheRecord(env.FPC_CACHE, context.cacheKey, cacheRecord);
  }

  return { response, cacheResult: cacheRecord };
}

async function fetchFromOrigin(context: Context): Promise<Response> {
  const request = buildOriginRequest(context);
  return fetch(request);
}

function buildOriginRequest(context: Context): Request {
  const { request, url, config, isStatic, cookieHeader } = context;
  const headers = new Headers(request.headers);

  if (cookieHeader) {
    if (isStatic) {
      headers.delete('Cookie');
    } else {
      const allowlist = new Set(config.allowedCookieNames.map(name => name.toLowerCase()));
      const parsed = cookieHeader.split(';').map(chunk => chunk.trim()).filter(Boolean);
      const kept: string[] = [];

      for (const piece of parsed) {
        const name = piece.split('=')[0].trim().toLowerCase();
        if (allowlist.has(name) || (config.cacheLoggedIn && name === 'phpsessid')) {
          kept.push(piece);
        }
      }

      if (kept.length) {
        headers.set('Cookie', kept.join('; '));
      } else {
        headers.delete('Cookie');
      }
    }
  }

  return new Request(url.toString(), {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: request.redirect
  });
}

function deriveTtl(cacheControl: string, config: Config): number {
  if (!config.respectCacheControl || !cacheControl) return config.defaultTtl;

  const sMaxAgeMatch = cacheControl.match(/s-maxage=(\d+)/i);
  if (sMaxAgeMatch) return parseInt(sMaxAgeMatch[1], 10);

  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  if (maxAgeMatch) return parseInt(maxAgeMatch[1], 10);

  return config.defaultTtl;
}

function sanitizeHeaders(headers: Headers, context: Context): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const skipKeys = ['age', 'x-powered-by', 'server', 'via', 'x-varnish', 'link'];

  headers.forEach((value, key) => {
    if (skipKeys.includes(key.toLowerCase())) return;
    sanitized[key] = value;
  });

  return sanitized;
}

function finalizeResponse(
  response: Response,
  context: Context,
  cacheState: string,
  _options: { fromCache?: boolean } = {}
): Response {
  const headers = new Headers(response.headers);
  const isStatic = context.isStatic;

  if (!headers.has('X-Magento-Cache-Debug')) {
    headers.set('X-Magento-Cache-Debug', cacheState === 'UNCACHEABLE' ? 'UNCACHEABLE' : cacheState);
  }

  headers.set('X-FPC-Cache', cacheState);

  if (cacheState === 'STALE') headers.set('X-FPC-Grace', 'normal');
  if (cacheState === 'UNCACHEABLE') headers.delete('X-FPC-Grace');

  if (!isStatic && (!headers.get('Cache-Control') || !/private/i.test(headers.get('Cache-Control') || ''))) {
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '-1');
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  }

  if (!headers.has('X-Magento-Debug')) headers.delete('Age');

  const removeHeaders = ['X-Magento-Debug', 'X-Magento-Tags', 'X-Pool', 'X-Powered-By', 'Server', 'X-Varnish', 'Via', 'Link'];
  removeHeaders.forEach(h => headers.delete(h));

  return context.request.method === 'HEAD'
    ? new Response(null, { status: response.status, statusText: response.statusText, headers })
    : new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function writeCacheRecord(kv: KVNamespace, cacheKey: string, record: CacheRecord): Promise<void> {
  const ttlSeconds = Math.max(60, Math.ceil(((record.staleUntil || record.expires) - Date.now()) / 1000));
  await kv.put(cacheKey, JSON.stringify(record), { expirationTtl: ttlSeconds });
}

async function storeHitForPass(kv: KVNamespace, cacheKey: string, context: Context): Promise<void> {
  const ttlSeconds = Math.max(1, context.config.hitForPassSeconds);
  const record: CacheRecord = {
    state: 'pass',
    expires: Date.now() + ttlSeconds * 1000
  };
  await kv.put(cacheKey, JSON.stringify(record), { expirationTtl: ttlSeconds });
}

async function handlePurgeRequest(context: Context): Promise<Response> {
  const { request, config, env } = context;
  const providedSecret = request.headers.get('X-Purge-Secret') || '';

  if (!config.purgeSecret || providedSecret !== config.purgeSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const headerKey = request.headers.get('X-Cache-Key');
  let keys: string[] = [];

  if (headerKey) {
    keys.push(headerKey);
  } else {
    const bodyText = await request.text();
    if (bodyText) {
      try {
        const payload = JSON.parse(bodyText);
        if (Array.isArray(payload)) {
          keys = payload;
        } else if (Array.isArray(payload.keys)) {
          keys = payload.keys;
        } else if (typeof payload.key === 'string') {
          keys = [payload.key];
        }
      } catch {
        return new Response('Invalid JSON payload', { status: 400 });
      }
    }
  }

  keys = keys.filter(key => typeof key === 'string' && key.length > 0);

  if (!keys.length) {
    return new Response('Cache key required', { status: 400 });
  }

  await Promise.all(keys.map(key => env.FPC_CACHE.delete(key)));
  return new Response(`Purged ${keys.length} keys`, { status: 200 });
}
