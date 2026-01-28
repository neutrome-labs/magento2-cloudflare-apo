import { buildConfig, debugLog } from './config';
import { createContext, shouldBypass, computeCacheKey } from './context';
import { readCacheRecord, writeCacheRecord, storeHitForPass, buildCachedResponse } from './cache';
import { fetchFromOrigin, fetchCacheableResponse, revalidate } from './origin';
import { finalizeResponse } from './response';
import { handlePurgeRequest } from './purge';
import { createPluginManager, getPlugins } from './plugins';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const config = buildConfig(env);
    const plugins = createPluginManager(config, getPlugins(config));
    const context = createContext(request, env, config, plugins, ctx.waitUntil.bind(ctx));

    debugLog(config, `Request ${request.method} ${context.originalUrl}`);

    // Handle purge requests
    if (request.method === 'POST' && request.headers.get('X-Purge-Secret')) {
      return handlePurgeRequest(context);
    }

    // Plugin early bypass
    const pluginResponse = await plugins.runOnRequest(context);
    if (pluginResponse) return pluginResponse;

    // Core bypass check
    const bypass = shouldBypass(context);
    if (bypass.bypass) {
      debugLog(config, `Bypass: ${bypass.reason}`);
      context.claims.push(`bypass:${bypass.reason}`);
      context.isBypassed = true;
      const response = await fetchFromOrigin(context);
      return finalizeResponse(response, context, 'UNCACHEABLE');
    }

    // Compute cache key (core + plugins)
    const baseKey = computeCacheKey(context);
    const cacheKey = plugins.runTransformCacheKey(baseKey, context);
    context.cacheKey = cacheKey;
    debugLog(config, `Cache key => ${cacheKey}`);

    const record = await readCacheRecord(env.FPC_CACHE, cacheKey);
    const now = Date.now();

    // Hit-for-pass active
    if (record?.state === 'pass' && record.expires > now) {
      debugLog(config, `Hit-for-pass active (${record.expires - now}ms remaining)`);
      context.claims.push('cache:hfp');
      const response = await fetchFromOrigin(context);
      return finalizeResponse(response, context, 'UNCACHEABLE');
    }

    // Cache HIT
    if (record?.state === 'cache' && record.expires > now) {
      debugLog(config, `Cache HIT, ttl left ${((record.expires - now) / 1000) | 0}s`);

      // Plugin validation (e.g., CSS guard)
      const valid = await plugins.runValidateCacheHit(record, context);
      if (!valid) {
        // Plugin declined this cached record - delete it and fetch fresh
        await env.FPC_CACHE.delete(cacheKey);
        context.claims.push('cache:invalidated');
        const response = await fetchFromOrigin(context);
        return finalizeResponse(response, context, 'MISS');
      }

      return buildCachedResponse(record, context, 'HIT');
    }

    // Cache STALE (serve stale, revalidate in background)
    if (record?.state === 'cache' && record.staleUntil && record.staleUntil > now) {
      debugLog(config, `Cache STALE, grace left ${((record.staleUntil - now) / 1000) | 0}s`);
      context.claims.push('cache:stale');

      // Plugin validation
      const valid = await plugins.runValidateCacheHit(record, context);
      if (!valid) {
        // Plugin declined this cached record - delete it and fetch fresh
        await env.FPC_CACHE.delete(cacheKey);
        context.claims.push('cache:invalidated');
        const response = await fetchFromOrigin(context);
        return finalizeResponse(response, context, 'MISS');
      }

      context.waitUntil(revalidate(context, record));
      return buildCachedResponse(record, context, 'STALE');
    }

    // Cache MISS - fetch from origin
    if (record) {
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
