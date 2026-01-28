import type { Config } from '../types';
import type { Plugin } from '.';

/**
 * Debug Headers Plugin
 * Adds debug headers (X-FPC-Cache, X-Magento-Cache-Debug, etc.) when DEBUG=true.
 */
export function debugHeadersPlugin(config: Config): Plugin | null {
  if (!config.debug) return null;

  return {
    name: 'debug-headers',

    async transformResponse(response, ctx, cacheState) {
      const headers = new Headers(response.headers);

      // Core debug headers
      if (!headers.has('X-Magento-Cache-Debug')) {
        headers.set('X-Magento-Cache-Debug', cacheState === 'UNCACHEABLE' ? 'UNCACHEABLE' : cacheState);
      }
      headers.set('X-FPC-Cache', cacheState);

      if (cacheState === 'STALE') headers.set('X-FPC-Grace', 'normal');
      if (cacheState === 'UNCACHEABLE') headers.delete('X-FPC-Grace');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
  };
}
