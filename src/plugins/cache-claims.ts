import type { Config } from '../types';
import type { Plugin } from '.';

/**
 * Cache Claims Plugin
 * Adds X-APO-Claims header showing request handling details.
 * Enabled by RETURN_CLAIMS=true (independent of DEBUG).
 */
export function cacheClaimsPlugin(config: Config): Plugin | null {
  if (!config.returnClaims) return null;

  return {
    name: 'cache-claims',

    async transformResponse(response, ctx, _cacheState) {
      if (!ctx.claims.length) return response;

      const headers = new Headers(response.headers);
      headers.set('X-APO-Claims', [...new Set(ctx.claims)].join('|'));

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
  };
}
