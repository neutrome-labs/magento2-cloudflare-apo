import type { CacheRecord, Context } from './types';
import { finalizeResponse } from './response';

export async function readCacheRecord(kv: KVNamespace, cacheKey: string): Promise<CacheRecord | null> {
  return kv.get<CacheRecord>(cacheKey, 'json');
}

export async function writeCacheRecord(kv: KVNamespace, cacheKey: string, record: CacheRecord): Promise<void> {
  const ttlSeconds = Math.max(60, Math.ceil(((record.staleUntil || record.expires) - Date.now()) / 1000));
  await kv.put(cacheKey, JSON.stringify(record), { expirationTtl: ttlSeconds });
}

export async function storeHitForPass(kv: KVNamespace, cacheKey: string, context: Context): Promise<void> {
  const ttlSeconds = Math.max(1, context.config.hitForPassSeconds);
  const record: CacheRecord = {
    state: 'pass',
    expires: Date.now() + ttlSeconds * 1000
  };
  await kv.put(cacheKey, JSON.stringify(record), { expirationTtl: ttlSeconds });
}

export async function buildCachedResponse(record: CacheRecord, context: Context, status: string): Promise<Response> {
  const headers = new Headers(record.headers || {});
  headers.set('X-FPC-Cache', status);
  if (status === 'STALE') headers.set('X-FPC-Grace', 'normal');
  headers.set('X-Magento-Cache-Debug', status === 'HIT' || status === 'STALE' ? 'HIT' : status);

  const responseInit = { status: record.status || 200, statusText: record.statusText || '', headers };
  const body = record.body ?? '';

  const response = context.request.method === 'HEAD'
    ? new Response(null, responseInit)
    : new Response(body, responseInit);

  return finalizeResponse(response, context, status);
}
