addEventListener('fetch', event => {
  event.respondWith(handleRequest(event));
});

const CONFIG = {
  defaultTtl: 24 * 60 * 60,
  graceSeconds: 3 * 24 * 60 * 60,
  respectPrivateNoCache: false,
  respectCacheControl: false,
  hitForPassSeconds: 120,
  cacheLoggedIn: true,
  debug: false,
  returnClaims: true,
  purgeSecret: 'replace-me',
  staticPathPattern: /^\/(?:pub\/)?(?:media|static)\//,
  healthCheckPattern: /^\/(?:pub\/)?health_check\.php$/,
  marketingParams: [
    'gclid', 'cx', 'ie', 'cof', 'siteurl', 'zanpid', 'origin', 'fbclid',
    'mc_*', 'utm_*', '_bta_*'
  ],
  excludedPaths: [
    '/admin',
    '/customer',
    '/section/load',
    '/checkout',
    '/wishlist',
    '/cart',
    '/sales',
    '/rest/',
    '/onestepcheckout',
    '/password'
  ],
  graphqlPath: '/graphql',
  varyCookies: ['X-Magento-Vary'],
  allowedCookieNames: [
    'X-Magento-Vary',
    'store',
    'currency',
    'form_key',
    'private_content_version',
    'section_data_ids',
    'mage-cache-sessid',
    'mage-cache-storage',
    'mage-cache-storage-section-invalidation',
    'mage-messages'
  ],
  includedResponseTypes: [
    'text/html',
    'text/css',
    'text/javascript',
    'application/javascript',
    // 'application/json'
  ]
};

const CACHE_PREFIX = 'fpc:';


async function handleRequest(event) {
  const request = event.request;
  const config = CONFIG;
  const claims = [];
  const context = createContext(request, config, claims);


  if (request.method === 'POST' && request.headers.get('X-Purge-Secret')) {
    const purgeResponse = await handlePurgeRequest(context);
    return withClaimsHeader(purgeResponse, config, claims);
  }

  const bypass = shouldBypass(context);
  if (bypass.bypass) {
    const response = await fetchFromOrigin(context, event, { tag: 'pass' });
    return withClaimsHeader(finalizeResponse(response, context, 'UNCACHEABLE'), config, claims);
  }

  const cacheKey = await computeCacheKey(context);
  context.cacheKey = cacheKey;

  const record = await readCacheRecord(cacheKey);
  const now = Date.now();

  if (record && record.state === 'pass' && record.expires > now) {
    const response = await fetchFromOrigin(context, event, { tag: 'pass-active' });
    return withClaimsHeader(finalizeResponse(response, context, 'UNCACHEABLE'), config, claims);
  }

  if (record && record.state === 'cache') {
    if (record.expires > now) {
      const response = buildCachedResponse(record, context, 'HIT');
      return withClaimsHeader(response, config, claims);
    }

    if (record.staleUntil > now) {
      event.waitUntil(revalidate(event, context, record));
      const response = buildCachedResponse(record, context, 'STALE');
      return withClaimsHeader(response, config, claims);
    }

  }

  const { response, cacheResult, skipCache, uncacheableReason } = await fetchCacheableResponse(event, context, record);

  if (cacheResult) {
    await writeCacheRecord(cacheKey, cacheResult);
  } else if (skipCache && uncacheableReason === 'hit-for-pass') {
    await storeHitForPass(cacheKey, context);
  }

  const finalized = finalizeResponse(response, context, skipCache ? 'UNCACHEABLE' : 'MISS');
  return withClaimsHeader(finalized, config, claims);
}

function createContext(request, config, claims) {
  const url = new URL(request.url);
  const normalized = normalizeUrl(url, config, claims);
  const headers = request.headers;
  const isGraphql = normalized.pathname.startsWith(config.graphqlPath);
  const magentoCacheId = headers.get('X-Magento-Cache-Id') || '';
  const authHeader = headers.get('Authorization') || '';
  const store = headers.get('Store') || headers.get('X-Store') || '';
  const currency = headers.get('Content-Currency') || headers.get('X-Currency') || '';

  return {
    request,
    config,
    claims,
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
    store,
    currency,
    cacheKey: null
  };
}

function normalizeUrl(url, config, claims) {
  const normalized = new URL(url.href);
  const marketingRemoved = stripMarketingParams(normalized, config);
  const pathname = normalized.pathname;
  const search = normalized.search;


  return { url: normalized, pathname, search, marketingRemoved };
}

function stripMarketingParams(url, config) {
  const removed = [];
  const params = url.searchParams;
  if (!params || Array.from(params.keys()).length === 0) {
    return removed;
  }

  const patterns = config.marketingParams || [];
  const keys = Array.from(params.keys());
  for (const key of keys) {
    if (patterns.some(pattern => matchesPattern(key, pattern))) {
      removed.push(key);
      params.delete(key);
    }
  }

  if (params.toString()) {
    url.search = `?${params.toString()}`;
  } else {
    url.search = '';
  }

  return removed;
}

function matchesPattern(value, pattern) {
  if (!pattern) return false;
  if (pattern.endsWith('*')) {
    return value.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase());
  }
  return value.toLowerCase() === pattern.toLowerCase();
}

function shouldBypass(context) {
  const { request, config, isGraphql, hasAuthToken, magentoCacheId, pathname, isStatic, isHealthCheck } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return { bypass: true, reason: `method:${request.method}` };
  }

  if (request.method === 'HEAD' && request.headers.get('Range')) {
    return { bypass: true, reason: 'range-head' };
  }

  if (isHealthCheck) {
    return { bypass: true, reason: 'health-check' };
  }

  if (isStatic) {
    return { bypass: true, reason: 'static-path' };
  }

  if (config.excludedPaths.some(path => pathname.includes(path))) {
    return { bypass: true, reason: 'excluded-path' };
  }

  if (isGraphql && hasAuthToken && !magentoCacheId) {
    return { bypass: true, reason: 'graphql-auth-pass' };
  }

  return { bypass: false, reason: '' };
}

async function computeCacheKey(context) {
  const { url, config, magentoCacheId, isGraphql, cookieHeader, sslOffloaded, store, currency } = context;
  const hostname = url.hostname;
  const pathname = url.pathname;
  const params = url.searchParams;

  let key = `${CACHE_PREFIX}${hostname}${pathname}`;

  if ([...params.keys()].length) {
    const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (pairs.length) {
      key += `?${pairs.map(([k, v]) => `${k}=${v}`).join('&')}`;
    }
  }

  if (isGraphql && magentoCacheId) {
    key += `::graphql:${magentoCacheId}`;
    if (context.hasAuthToken) {
      key += ':authorized';
    }
  } else {
    const varyCookie = extractCookieValue(cookieHeader, config.varyCookies || []);
    if (varyCookie) {
      key += `::vary:${varyCookie}`;
    }
  }

  if (sslOffloaded) {
    key += `::ssl:${sslOffloaded}`;
  }

  if (isGraphql) {
    if (store) {
      key += `::store:${store}`;
    }
    if (currency) {
      key += `::currency:${currency}`;
    }
  }

  return key;
}

function extractCookieValue(cookieHeader, names) {
  if (!cookieHeader || !Array.isArray(names) || names.length === 0) {
    return '';
  }
  const cookies = cookieHeader.split(';').map(chunk => chunk.trim()).filter(Boolean);
  const wanted = [];
  for (const name of names) {
    const found = cookies.find(cookie => cookie.toLowerCase().startsWith(`${name.toLowerCase()}=`));
    if (found) {
      wanted.push(found.split('=')[1] || '');
    }
  }
  return wanted.join('_');
}

async function readCacheRecord(cacheKey) {
  const raw = await FPC_CACHE.get(cacheKey, 'json');
  if (!raw) return null;
  return raw;
}

function buildCachedResponse(record, context, status) {
  const headers = new Headers(record.headers || {});
  headers.set('X-FPC-Cache', status);
  if (status === 'STALE') {
    headers.set('X-FPC-Grace', 'normal');
  }
  headers.set('X-Magento-Cache-Debug', status === 'HIT' || status === 'STALE' ? 'HIT' : status);
  const responseInit = { status: record.status, statusText: record.statusText, headers };
  const body = record.body ?? '';
  const response = context.request.method === 'HEAD'
    ? new Response(null, responseInit)
    : new Response(body, responseInit);
  return finalizeResponse(response, context, status, { fromCache: true, record });
}

async function revalidate(event, context, record) {
  try {
    await fetchCacheableResponse(event, context, record);
  } catch (err) {
  }
}

async function fetchCacheableResponse(event, context, previousRecord) {
  const response = await fetchFromOrigin(context, event);
  const clone = response.clone();
  const { config } = context;

  const status = clone.status;
  const headers = new Headers(clone.headers);
  const cacheControl = headers.get('Cache-Control') || '';
  const surrogate = headers.get('Surrogate-Control') || '';
  const vary = headers.get('Vary') || '';
  const setCookie = headers.get('Set-Cookie');

  if ((status !== 200 && status !== 404) || /private/i.test(cacheControl)) {
    return { response, skipCache: true, uncacheableReason: 'status' };
  }

  const noStoreHeader = /no-store/i.test(cacheControl) || /no-cache/i.test(cacheControl) || /no-store/i.test(surrogate);
  if ((context.config.respectPrivateNoCache && noStoreHeader) || vary === '*') {
    return { response, skipCache: true, uncacheableReason: 'hit-for-pass' };
  }

  if (setCookie) {
    headers.delete('Set-Cookie');
  }

  if (headers.get('X-Magento-Debug')) {
    headers.set('X-Magento-Cache-Control', cacheControl || '');
  }

  let ttlSeconds = deriveTtl(cacheControl, config);
  if (ttlSeconds <= 0) {
    ttlSeconds = config.defaultTtl;
  }

  const bodyText = await clone.text();
  if (bodyText.length < 3) {
    return { response, skipCache: true, uncacheableReason: 'body-too-small' };
  }

  if (context.isGraphql && context.magentoCacheId) {
    const responseCacheId = headers.get('X-Magento-Cache-Id');
    if (responseCacheId && responseCacheId !== context.magentoCacheId) {
      return { response, skipCache: true, uncacheableReason: 'graphql-mismatch' };
    }
  }

  const expires = Date.now() + ttlSeconds * 1000;
  const staleUntil = expires + context.config.graceSeconds * 1000;
  const statusText = clone.statusText || '';
  const responseHeaders = sanitizeHeaders(headers, context);

  const cacheRecord = {
    state: 'cache',
    status,
    statusText,
    headers: responseHeaders,
    body: bodyText,
    expires,
    staleUntil
  };

  return { response, cacheResult: cacheRecord };
}

async function fetchFromOrigin(context, event, metadata = {}) {
  const request = buildOriginRequest(context);
  const response = await fetch(request);
  if (metadata.tag) {
  }
  return response;
}

function buildOriginRequest(context) {
  const { request, url, config, isStatic, cookieHeader } = context;
  const headers = new Headers(request.headers);

  if (cookieHeader) {
    if (isStatic) {
      headers.delete('Cookie');
    } else {
      const allowlist = new Set(config.allowedCookieNames.map(name => name.toLowerCase()));
      const parsed = cookieHeader.split(';').map(chunk => chunk.trim()).filter(Boolean);
      const kept = [];
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

  const init = {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: request.redirect,
    cf: request.cf,
    signal: request.signal
  };

  return new Request(url.toString(), init);
}

function deriveTtl(cacheControl, config) {
  if (!config.respectCacheControl || !cacheControl) {
    return config.defaultTtl;
  }
  const sMaxAgeMatch = cacheControl.match(/s-maxage=(\d+)/i);
  if (sMaxAgeMatch) {
    return parseInt(sMaxAgeMatch[1], 10);
  }
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  if (maxAgeMatch) {
    return parseInt(maxAgeMatch[1], 10);
  }
  return config.defaultTtl;
}

function sanitizeHeaders(headers, context) {
  const sanitized = {};
  headers.forEach((value, key) => {
    if (['age', 'x-powered-by', 'server', 'via', 'x-varnish', 'link'].includes(key.toLowerCase())) {
      return;
    }
    if (context.isStatic && key.toLowerCase() === 'cache-control') {
      sanitized[key] = value;
      return;
    }
    sanitized[key] = value;
  });
  return sanitized;
}

function finalizeResponse(response, context, cacheState, options = {}) {
  const headers = new Headers(response.headers);
  const isStatic = context.isStatic;

  if (!headers.has('X-Magento-Cache-Debug')) {
    headers.set('X-Magento-Cache-Debug', cacheState === 'UNCACHEABLE' ? 'UNCACHEABLE' : cacheState);
  }

  headers.set('X-FPC-Cache', cacheState);

  if (cacheState === 'STALE') {
    headers.set('X-FPC-Grace', 'normal');
  }

  if (cacheState === 'UNCACHEABLE') {
    headers.delete('X-FPC-Grace');
  }

  if (!isStatic && (!headers.get('Cache-Control') || !/private/i.test(headers.get('Cache-Control')))) {
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '-1');
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  }

  if (!headers.has('X-Magento-Debug')) {
    headers.delete('Age');
  }

  headers.delete('X-Magento-Debug');
  headers.delete('X-Magento-Tags');
  headers.delete('X-Pool');
  headers.delete('X-Powered-By');
  headers.delete('Server');
  headers.delete('X-Varnish');
  headers.delete('Via');
  headers.delete('Link');

  const init = {
    status: response.status,
    statusText: response.statusText,
    headers
  };

  return context.request.method === 'HEAD'
    ? new Response(null, init)
    : new Response(response.body, init);
}

async function writeCacheRecord(cacheKey, record) {
  const ttlSeconds = Math.max(60, Math.ceil((record.staleUntil - Date.now()) / 1000));
  await FPC_CACHE.put(cacheKey, JSON.stringify(record), {
    expirationTtl: ttlSeconds
  });
}

async function storeHitForPass(cacheKey, context) {
  const ttlSeconds = Math.max(1, context.config.hitForPassSeconds);
  const record = {
    state: 'pass',
    expires: Date.now() + ttlSeconds * 1000
  };
  await FPC_CACHE.put(cacheKey, JSON.stringify(record), { expirationTtl: ttlSeconds });
}

async function handlePurgeRequest(context) {
  const { request, config } = context;
  const providedSecret = request.headers.get('X-Purge-Secret') || '';

  if (!config.purgeSecret || providedSecret !== config.purgeSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const headerKey = request.headers.get('X-Cache-Key');
  let keys = [];

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
      } catch (err) {
        return new Response('Invalid JSON payload', { status: 400 });
      }
    }
  }

  keys = keys.filter(key => typeof key === 'string' && key.length > 0);

  if (!keys.length) {
    return new Response('Cache key required', { status: 400 });
  }

  await Promise.all(keys.map(key => FPC_CACHE.delete(key)));
  return new Response(`Purged ${keys.length} keys`, { status: 200 });
}

function withClaimsHeader(response, config, claims) {
    return response;

}
