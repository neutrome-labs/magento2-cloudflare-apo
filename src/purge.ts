import type { Context } from './types';
import { computeCacheKey } from './context';

/**
 * Handle purge request - purges the cache for the requested URL
 * Use X-Purge: true header to purge single URL
 * Use X-Purge-All: true header to purge entire cache
 */
export async function handlePurgeRequest(context: Context): Promise<Response> {
  const { request, config, env, plugins } = context;
  const providedSecret = request.headers.get('X-Purge-Secret') || '';

  if (!config.purgeSecret || providedSecret !== config.purgeSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Check for purge-all request
  if (request.headers.get('X-Purge-All') === 'true') {
    return await purgeAllKeys(env);
  }

  // Compute cache key using same pipeline as normal requests (core + plugins)
  const baseKey = computeCacheKey(context);
  const cacheKey = plugins.runTransformCacheKey(baseKey, context);
  await env.FPC_CACHE.delete(cacheKey);

  return new Response(JSON.stringify({
    success: true,
    purged: cacheKey,
    url: context.url.href
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function purgeAllKeys(env: Env): Promise<Response> {
  let cursor: string | undefined;
  let totalDeleted = 0;

  do {
    const list = await env.FPC_CACHE.list({ cursor, limit: 1000 });
    const keys = list.keys.map(k => k.name);

    if (keys.length > 0) {
      await Promise.all(keys.map(key => env.FPC_CACHE.delete(key)));
      totalDeleted += keys.length;
    }

    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  return new Response(JSON.stringify({ 
    success: true, 
    purged: totalDeleted,
    message: `Purged all ${totalDeleted} cache keys` 
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
