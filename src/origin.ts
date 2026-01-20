import type { Context, CacheRecord, FetchResult } from './types';
import { debugLog } from './config';
import { writeCacheRecord } from './cache';

export async function fetchFromOrigin(context: Context): Promise<Response> {
  const request = buildOriginRequest(context);
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
  const responseHeaders = sanitizeHeaders(headers);

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

export async function revalidate(context: Context, _record: CacheRecord): Promise<void> {
  try {
    await fetchCacheableResponse(context);
  } catch (err) {
    debugLog(context.config, 'Revalidate error', err);
  }
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
