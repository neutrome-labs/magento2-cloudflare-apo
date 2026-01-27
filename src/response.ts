import type { Context } from './types';

/**
 * Replace all occurrences of the origin host with the request host in the response body.
 * This is useful when ORIGIN_HOST is set to a different backend server that generates
 * absolute URLs pointing to itself. Also replaces protocol if configured.
 */
function replaceOriginLinks(body: string, context: Context): string {
  const { config, url } = context;
  const originHost = config.originHost;
  const originProtocol = config.originProtocol;
  
  if (!originHost || originHost === url.host) {
    return body;
  }

  let result = body;

  // If origin has a protocol configured, replace protocol://host with request's protocol://host
  if (originProtocol) {
    const originFull = `${originProtocol}//${originHost}`;
    const requestFull = `${url.protocol}//${url.host}`;
    result = result.replaceAll(originFull, requestFull);
  }

  // Also replace any remaining bare host references (without protocol)
  result = result.replaceAll(originHost, url.host);

  return result;
}

export function finalizeResponse(response: Response, context: Context, cacheState: string): Response {
  const headers = new Headers(response.headers);
  const isStatic = context.isStatic;

  // Add cache state to claims
  context.claims.push(`cache:${cacheState.toLowerCase()}`);

  // Always set package attribution header
  headers.set('X-Served-With', 'neutrome-labs/magento2-cloudflare-apo');

  // Debug-only headers
  if (context.config.debug) {
    if (!headers.has('X-Magento-Cache-Debug')) {
      headers.set('X-Magento-Cache-Debug', cacheState === 'UNCACHEABLE' ? 'UNCACHEABLE' : cacheState);
    }

    headers.set('X-FPC-Cache', cacheState);

    if (cacheState === 'STALE') headers.set('X-FPC-Grace', 'normal');
    if (cacheState === 'UNCACHEABLE') headers.delete('X-FPC-Grace');

    // Add claims header when returnClaims is enabled
    if (context.config.returnClaims && context.claims.length) {
      headers.set('X-APO-Claims', [...new Set(context.claims)].join('|'));
    }
  }

  if (!isStatic && (!headers.get('Cache-Control') || !/private/i.test(headers.get('Cache-Control') || ''))) {
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '-1');
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  }

  // Strip internal headers only when not in debug mode
  if (!context.config.debug) {
    if (!headers.has('X-Magento-Debug')) headers.delete('Age');

    const removeHeaders = ['X-Magento-Debug', 'X-Magento-Tags', 'X-Pool', 'X-Powered-By', 'Server', 'X-Varnish', 'Via', 'Link'];
    removeHeaders.forEach(h => headers.delete(h));
  }

  // Replace origin host in Location header for redirects
  if (context.config.replaceOriginLinks && context.config.originHost) {
    const location = headers.get('Location');
    if (location) {
      headers.set('Location', replaceOriginLinks(location, context));
    }
  }

  if (context.request.method === 'HEAD') {
    return new Response(null, { status: response.status, statusText: response.statusText, headers });
  }

  // Replace origin links if enabled and we have an origin host configured
  if (context.config.replaceOriginLinks && context.config.originHost) {
    const contentType = headers.get('Content-Type') || '';
    // Only process text-based responses
    if (contentType.includes('text/html') || 
        contentType.includes('text/css') || 
        contentType.includes('application/javascript') || 
        contentType.includes('application/json') ||
        contentType.includes('application/xml')
    ) {
      return response.text().then(body => {
        const modifiedBody = replaceOriginLinks(body, context);
        return new Response(modifiedBody, { status: response.status, statusText: response.statusText, headers });
      }) as unknown as Response;
    }
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
