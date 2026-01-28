import type { Context, CacheRecord, FetchResult, StreamingFetchResult } from './types';
import { debugLog, errorLog } from './config';
import { writeCacheRecord, storeHitForPass } from './cache';

export async function fetchFromOrigin(context: Context): Promise<Response> {
  let request = buildOriginRequest(context);
  request = await context.plugins.runTransformOriginRequest(request, context);
  debugLog(context.config, `Fetching from origin: ${request.url}`);
  return fetch(request);
}

function buildOriginRequest(context: Context): Request {
  const { request, url, config, isStatic, cookieHeader } = context;
  const headers = new Headers(request.headers);

  // Build target URL, optionally rewriting origin host and/or protocol
  let targetUrl = url.toString();
  if (config.originHost || config.originProtocol) {
    const rewritten = new URL(url.toString());
    const originalHost = url.host;
    if (config.originHost) {
      // Parse origin host to handle hostname:port format
      const [hostname, port] = config.originHost.split(':');
      rewritten.hostname = hostname;
      rewritten.port = port || ''; // Clear port if not specified in originHost
    }
    if (config.originProtocol) {
      rewritten.protocol = config.originProtocol;
    }
    targetUrl = rewritten.toString();
    // Use origin host in Host header if original is localhost (dev mode)
    // Otherwise preserve original Host header for virtual hosting
    if (originalHost.startsWith('localhost') || originalHost.startsWith('127.0.0.1')) {
      headers.set('Host', config.originHost || rewritten.host);
    } else {
      headers.set('Host', originalHost);
    }
  }

  // Skip cookie filtering for bypassed requests (e.g., /admin)
  if (cookieHeader && !context.isBypassed) {
    if (isStatic) {
      headers.delete('Cookie');
    } else {
      const allowlist = new Set(config.cacheableCookieNames.map(name => name.toLowerCase()));
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

      debugLog(context.config, `Filtered cookies: kept=[${kept.join(', ')}]`);
    }
  }

  return new Request(targetUrl, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: request.redirect
  });
}

export async function fetchCacheableResponse(context: Context): Promise<FetchResult> {
  const response = await fetchFromOrigin(context);
  const { config, env } = context;

  const status = response.status;
  const headers = new Headers(response.headers);
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

  // Check if content-type is cacheable
  const contentType = (headers.get('Content-Type') || '').toLowerCase();
  const isCacheableMime = config.cacheableMimeTypes.some(mime => contentType.includes(mime.toLowerCase()));
  if (!isCacheableMime) {
    debugLog(config, `Skipping cache: content-type '${contentType}' not in cacheableMimeTypes`);
    return { response, skipCache: true, uncacheableReason: 'content-type' };
  }

  if (headers.get('X-Magento-Debug')) {
    headers.set('X-Magento-Cache-Control', cacheControl);
  }

  let ttlSeconds = deriveTtl(cacheControl, config);
  if (ttlSeconds <= 0) ttlSeconds = config.defaultTtl;

  // Clone response only when we need to read the body
  // This ensures both branches are consumed (original returned, clone read)
  const clone = response.clone();
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

  // Run plugin shouldCache hook
  const pluginDecision = await context.plugins.runShouldCache(response, bodyText, context);
  if (pluginDecision === false) {
    return { response, skipCache: true, uncacheableReason: 'plugin-blocked' };
  }
  if (pluginDecision === 'hit-for-pass') {
    return { response, skipCache: true, uncacheableReason: 'hit-for-pass' };
  }

  const expires = Date.now() + ttlSeconds * 1000;
  const staleUntil = expires + config.graceSeconds * 1000;
  const responseHeaders = sanitizeHeaders(headers);

  const cacheRecord: CacheRecord = {
    state: 'cache',
    status,
    statusText: response.statusText || '',
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

export async function revalidate(context: Context, _record: CacheRecord): Promise<void> {
  try {
    const { response } = await fetchCacheableResponse(context);
    // Consume the response body to avoid memory leaks
    await response.arrayBuffer();
  } catch (err) {
    errorLog('Revalidate error', context.cacheKey, err);
  }
}

/**
 * Fetch from origin with streaming response.
 * Returns immediately after header checks, streams body to client while caching in background.
 * 
 * Trade-offs:
 * - No body-dependent plugin hooks (shouldCache, merged-css-guard)
 * - No body transformations (origin-links) in streaming mode
 * - Caching errors don't affect client response (logged via errorLog)
 */
export async function fetchStreamingResponse(context: Context): Promise<StreamingFetchResult> {
  const response = await fetchFromOrigin(context);
  const { config, env, cacheKey } = context;

  const status = response.status;
  const headers = new Headers(response.headers);
  const cacheControl = headers.get('Cache-Control') || '';
  const surrogate = headers.get('Surrogate-Control') || '';
  const vary = headers.get('Vary') || '';
  const setCookie = headers.get('Set-Cookie');

  // Header-based uncacheability checks (same as fetchCacheableResponse)
  if ((status !== 200 && status !== 404) || /private/i.test(cacheControl)) {
    debugLog(config, 'Streaming: uncacheable status or private');
    context.claims.push('stream:skip:status');
    return { response, cachePromise: Promise.resolve() };
  }

  const noStoreHeader = /no-store|no-cache/i.test(cacheControl) || /no-store/i.test(surrogate);
  if ((config.respectPrivateNoCache && noStoreHeader) || vary === '*') {
    debugLog(config, `Streaming: hit-for-pass cache-control='${cacheControl}' surrogate='${surrogate}' vary='${vary}'`);
    context.claims.push('stream:hfp');
    const hfpPromise = cacheKey 
      ? storeHitForPass(env.FPC_CACHE, cacheKey, context).catch(e => errorLog('Streaming HFP write error', cacheKey, e))
      : Promise.resolve();
    return { response, cachePromise: hfpPromise };
  }

  // Check if content-type is cacheable
  const contentType = (headers.get('Content-Type') || '').toLowerCase();
  const isCacheableMime = config.cacheableMimeTypes.some(mime => contentType.includes(mime.toLowerCase()));
  if (!isCacheableMime) {
    debugLog(config, `Streaming: content-type '${contentType}' not cacheable`);
    context.claims.push('stream:skip:content-type');
    return { response, cachePromise: Promise.resolve() };
  }

  if (setCookie) headers.delete('Set-Cookie');

  let ttlSeconds = deriveTtl(cacheControl, config);
  if (ttlSeconds <= 0) ttlSeconds = config.defaultTtl;

  // Tee the response: one branch for client, one for caching
  const [clientStream, cacheStream] = response.body 
    ? response.body.tee() 
    : [null, null];

  // Build client response with cleaned headers
  const clientHeaders = new Headers(headers);
  const clientResponse = new Response(clientStream, {
    status,
    statusText: response.statusText,
    headers: clientHeaders
  });

  // Background caching promise
  const cachePromise = (async () => {
    if (!cacheKey || !cacheStream) {
      if (cacheStream) {
        // Consume unused stream to prevent memory leak
        await new Response(cacheStream).arrayBuffer();
      }
      return;
    }

    try {
      const bodyText = await new Response(cacheStream).text();
      
      // Body size check
      if (bodyText.length < 3) {
        debugLog(config, 'Streaming: body too small, not caching');
        context.claims.push('stream:skip:body-small');
        return;
      }

      // GraphQL cache-id mismatch check
      if (context.isGraphql && context.magentoCacheId) {
        const responseCacheId = headers.get('X-Magento-Cache-Id');
        if (responseCacheId && responseCacheId !== context.magentoCacheId) {
          debugLog(config, `Streaming: GraphQL cache-id mismatch`);
          context.claims.push('stream:skip:graphql-mismatch');
          return;
        }
      }

      const expires = Date.now() + ttlSeconds * 1000;
      const staleUntil = expires + config.graceSeconds * 1000;
      const responseHeaders = sanitizeHeaders(headers);

      const cacheRecord: CacheRecord = {
        state: 'cache',
        status,
        statusText: response.statusText || '',
        headers: responseHeaders,
        body: bodyText,
        expires,
        staleUntil
      };

      await writeCacheRecord(env.FPC_CACHE, cacheKey, cacheRecord);
      debugLog(config, `Streaming: cached ${cacheKey} ttl=${ttlSeconds}s`);
      context.claims.push('stream:cached');
    } catch (err) {
      errorLog('Streaming cache write error', cacheKey, err);
      context.claims.push('stream:cache-error');
    }
  })();

  context.claims.push('stream:active');
  return { response: clientResponse, cachePromise };
}

function deriveTtl(cacheControl: string, config: Context['config']): number {
  if (!config.respectCacheControl || !cacheControl) return config.defaultTtl;

  const sMaxAgeMatch = cacheControl.match(/s-maxage=(\d+)/i);
  if (sMaxAgeMatch) return parseInt(sMaxAgeMatch[1], 10);

  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  if (maxAgeMatch) return parseInt(maxAgeMatch[1], 10);

  return config.defaultTtl;
}

function sanitizeHeaders(headers: Headers): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const skipKeys = ['age', 'x-powered-by', 'server', 'via', 'x-varnish', 'link'];

  headers.forEach((value, key) => {
    if (skipKeys.includes(key.toLowerCase())) return;
    sanitized[key] = value;
  });

  return sanitized;
}
