import type { Context } from './types';

/**
 * Replace all occurrences of the origin host with the request host in the response body.
 * This is useful when ORIGIN_HOST is set to a different backend server that generates
 * absolute URLs pointing to itself.
 */
function replaceOriginLinks(body: string, context: Context): string {
  const { config, url } = context;
  const originHost = config.originHost;
  
  if (!originHost || originHost === url.host) {
    return body;
  }

  const requestHost = url.host;
  const originProtocol = config.originProtocol || url.protocol;
  const originBase = `${originProtocol}//${originHost}`;
  const requestBase = `${url.protocol}//${requestHost}`;

  // Replace full URLs (protocol + host)
  let result = body.replaceAll(originBase, requestBase);
  
  // Also replace protocol-relative URLs (//host)
  result = result.replaceAll(`//${originHost}`, `//${requestHost}`);

  return result;
}

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

  if (context.request.method === 'HEAD') {
    return new Response(null, { status: response.status, statusText: response.statusText, headers });
  }

  // Replace origin links if enabled and we have an origin host configured
  if (context.config.replaceOriginLinks && context.config.originHost) {
    const contentType = headers.get('Content-Type') || '';
    // Only process text-based responses
    if (contentType.includes('text/html') || contentType.includes('text/css') || 
        contentType.includes('application/javascript') || contentType.includes('application/json')) {
      return response.text().then(body => {
        const modifiedBody = replaceOriginLinks(body, context);
        return new Response(modifiedBody, { status: response.status, statusText: response.statusText, headers });
      }) as unknown as Response;
    }
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
