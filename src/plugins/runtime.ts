import type { Context, CacheRecord, Config } from '../types';
import type { Plugin, PluginManager, PluginFactory } from '.';

/**
 * Create a plugin manager from a list of plugin factories.
 * Factories that return null are skipped (disabled).
 */
export function createPluginManager(config: Config, factories: PluginFactory[]): PluginManager {
  const plugins = factories.map(f => f(config)).filter((p): p is Plugin => p !== null);

  return {
    plugins,

    async runOnRequest(ctx: Context): Promise<Response | void> {
      for (const p of plugins) {
        if (p.onRequest) {
          const result = await p.onRequest(ctx);
          if (result) return result;
        }
      }
    },

    runTransformCacheKey(key: string, ctx: Context): string {
      for (const p of plugins) {
        if (p.transformCacheKey) {
          key = p.transformCacheKey(key, ctx);
        }
      }
      return key;
    },

    async runTransformOriginRequest(request: Request, ctx: Context): Promise<Request> {
      for (const p of plugins) {
        if (p.transformOriginRequest) {
          request = await p.transformOriginRequest(request, ctx);
        }
      }
      return request;
    },

    async runValidateCacheHit(record: CacheRecord, ctx: Context): Promise<boolean> {
      for (const p of plugins) {
        if (p.validateCacheHit) {
          const ok = await p.validateCacheHit(record, ctx);
          if (!ok) return false;
        }
      }
      return true;
    },

    async runShouldCache(response: Response, bodyText: string, ctx: Context): Promise<boolean | 'hit-for-pass'> {
      for (const p of plugins) {
        if (p.shouldCache) {
          const result = await p.shouldCache(response, bodyText, ctx);
          if (result === false || result === 'hit-for-pass') return result;
        }
      }
      return true;
    },

    async runTransformResponse(response: Response, ctx: Context, cacheState: string): Promise<Response> {
      for (const p of plugins) {
        if (p.transformResponse) {
          response = await p.transformResponse(response, ctx, cacheState);
        }
      }
      return response;
    }
  };
}
