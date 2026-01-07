import { buildConfig, debugLog } from './config';
import { createContext, shouldBypass, computeCacheKey } from './context';
import { readCacheRecord, writeCacheRecord, storeHitForPass, buildCachedResponse } from './cache';
import { fetchFromOrigin, fetchCacheableResponse, revalidate } from './origin';
import { finalizeResponse } from './response';
import { handlePurgeRequest } from './purge';

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
      context.claims.push(`bypass:${bypass.reason}`);
      context.isBypassed = true;
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
      context.claims.push('cache:hfp');
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
        context.claims.push('cache:stale');
        ctx.waitUntil(revalidate(context, record));
        return buildCachedResponse(record, context, 'STALE');
      }

      debugLog(config, 'Cached record expired beyond grace, treating as miss');
    }

    const { response, cacheResult, skipCache, uncacheableReason } = await fetchCacheableResponse(context);

    if (cacheResult) {
      context.claims.push('cache:write');
      await writeCacheRecord(env.FPC_CACHE, cacheKey, cacheResult);
    } else if (skipCache && uncacheableReason === 'hit-for-pass') {
      context.claims.push('cache:hfp-store');
      await storeHitForPass(env.FPC_CACHE, cacheKey, context);
    } else if (skipCache && uncacheableReason) {
      context.claims.push(`cache:skip:${uncacheableReason}`);
    }

    return finalizeResponse(response, context, skipCache ? 'UNCACHEABLE' : 'MISS');
  }
};
