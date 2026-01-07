import type { Context } from './types';

export async function handlePurgeRequest(context: Context): Promise<Response> {
  const { request, config, env } = context;
  const providedSecret = request.headers.get('X-Purge-Secret') || '';

  if (!config.purgeSecret || providedSecret !== config.purgeSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Check for purge-all request
  const purgeAll = request.headers.get('X-Purge-All') === 'true';
  if (purgeAll) {
    return await purgeAllKeys(env);
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
