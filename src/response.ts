import type { Context } from './types';

export function finalizeResponse(response: Response, context: Context, cacheState: string): Response {
  const headers = new Headers(response.headers);
  const isStatic = context.isStatic;

  // Add cache state to claims
  context.claims.push(`cache:${cacheState.toLowerCase()}`);

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

  // Add claims header when returnClaims is enabled
  if (context.config.returnClaims && context.claims.length) {
    headers.set('X-APO-Claims', [...new Set(context.claims)].join('|'));
  }

  return context.request.method === 'HEAD'
    ? new Response(null, { status: response.status, statusText: response.statusText, headers })
    : new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
