import type { Context } from './types';

export async function handlePurgeRequest(context: Context): Promise<Response> {
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
