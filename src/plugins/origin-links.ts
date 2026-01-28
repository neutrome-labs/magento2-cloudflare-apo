import type { Config, Context } from '../types';
import type { Plugin } from '.';

/**
 * Origin Links Plugin
 * Replaces origin host references with request host in response bodies.
 * Useful when ORIGIN_HOST points to a different backend that generates absolute URLs.
 * 
 * Note: Disabled when streamMissResponses=true (requires body buffering).
 */
export function originLinksPlugin(config: Config): Plugin | null {
  if (!config.replaceOriginLinks || !config.originHost) return null;
  
  // Disable when streaming is enabled - body transforms require buffering
  if (config.streamMissResponses) return null;

  const originHost = config.originHost;
  const originProtocol = config.originProtocol;

  return {
    name: 'origin-links',

    async transformResponse(response, ctx, _cacheState) {
      const requestHost = ctx.url.host;
      if (originHost === requestHost) return response;

      const headers = new Headers(response.headers);

      // Replace Location header for redirects
      const location = headers.get('Location');
      if (location) {
        headers.set('Location', replaceLinks(location, originHost, originProtocol, ctx));
      }

      // Replace domain in Set-Cookie headers
      const cookies = response.headers.getAll('Set-Cookie');
      if (cookies.length) {
        headers.delete('Set-Cookie');
        for (const cookie of cookies) {
          const updated = cookie.replace(
            new RegExp(`(domain=)${originHost.replace(/\./g, '\\.')}`, 'gi'),
            `$1${requestHost}`
          );
          headers.append('Set-Cookie', updated);
        }
      }

      // Replace body content for text-based responses
      const contentType = headers.get('Content-Type') || '';
      const textTypes = ['text/html', 'text/css', 'application/javascript', 'application/json', 'application/xml'];
      
      if (textTypes.some(t => contentType.includes(t))) {
        const body = await response.text();
        const modified = replaceLinks(body, originHost, originProtocol, ctx);
        return new Response(modified, { status: response.status, statusText: response.statusText, headers });
      }

      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
  };
}

function replaceLinks(content: string, originHost: string, originProtocol: string | null, ctx: Context): string {
  let result = content;
  const requestHost = ctx.url.host;

  // Replace protocol://host with request's protocol://host
  if (originProtocol) {
    const originFull = `${originProtocol}//${originHost}`;
    const requestFull = `${ctx.url.protocol}//${requestHost}`;
    result = result.replaceAll(originFull, requestFull);
  }

  // Replace remaining bare host references
  result = result.replaceAll(originHost, requestHost);
  return result;
}
