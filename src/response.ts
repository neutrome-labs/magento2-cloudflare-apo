import type { Context } from './types';

/**
 * Finalize response before sending to client.
 * Core headers are set here; plugins add debug headers and body transformations.
 */
export async function finalizeResponse(response: Response, context: Context, cacheState: string): Promise<Response> {
  const headers = new Headers(response.headers);
  const isStatic = context.isStatic;

  // Add cache state to claims
  context.claims.push(`cache:${cacheState.toLowerCase()}`);

  // Always set package attribution
  headers.set('X-Served-With', 'neutrome-labs/magento2-cloudflare-apo');

  // Prevent browser caching for non-static pages
  if (!isStatic && (!headers.get('Cache-Control') || !/private/i.test(headers.get('Cache-Control') || ''))) {
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '-1');
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  }

  // Strip internal headers (when not in debug mode)
  if (!context.config.debug) {
    if (!headers.has('X-Magento-Debug')) headers.delete('Age');
    const removeHeaders = ['X-Magento-Debug', 'X-Magento-Tags', 'X-Pool', 'X-Powered-By', 'Server', 'X-Varnish', 'Via', 'Link'];
    removeHeaders.forEach(h => headers.delete(h));
  }

  let result: Response;
  if (context.request.method === 'HEAD') {
    result = new Response(null, { status: response.status, statusText: response.statusText, headers });
  } else {
    result = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  // Run plugin response transforms
  return context.plugins.runTransformResponse(result, context, cacheState);
}
