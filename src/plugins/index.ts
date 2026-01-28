/**
 * Plugins Module
 * 
 * Provides extensibility through a simple hook-based plugin system.
 * Plugins run in registry order and can hook into:
 * - onRequest: early bypass
 * - transformCacheKey: modify cache key
 * - validateCacheHit: validate cached records before serving
 * - shouldCache: decide if origin response should be cached
 * - transformResponse: modify response before sending to client
 */
import type { Context, CacheRecord, Config } from '../types';
// Built-in plugins
import { mergedCssGuardPlugin } from './merged-css-guard';
import { debugHeadersPlugin } from './debug-headers';
import { cacheClaimsPlugin } from './cache-claims';
import { originLinksPlugin } from './origin-links';

export { createPluginManager } from './runtime';

/**
 * Plugin registry - returns plugins in execution order.
 * Each factory receives config and returns a Plugin or null (disabled).
 * 
 * To add custom plugins:
 * 1. Import your plugin factory here
 * 2. Add it to the PLUGINS array in desired order
 * 
 * Execution order is array order.
 */
const PLUGINS: PluginFactory[] = [
  // Core plugins (run first)
  mergedCssGuardPlugin,
  
  // Response modifiers (run in order)
  originLinksPlugin,
  
  // Debug/observability (run last)
  debugHeadersPlugin,
  cacheClaimsPlugin,
];

/**
 * Get all enabled plugins for the given config.
 */
export function getPlugins(config: Config): PluginFactory[] {
  return PLUGINS;
}

/**
 * Plugin hook interface.
 * Plugins run in registry order; each hook receives the current state and can modify it.
 */
export interface Plugin {
  /** Unique plugin name */
  name: string;

  /**
   * Early request hook. Return a Response to short-circuit (bypass caching entirely).
   * Return void to continue normal flow.
   */
  onRequest?(ctx: Context): Promise<Response | void> | Response | void;

  /**
   * Modify cache key. Return a new key or the same key.
   * Runs after core key computation.
   */
  transformCacheKey?(key: string, ctx: Context): string;

  /**
   * Modify request before sending to origin.
   * Return the (possibly modified) Request.
   */
  transformOriginRequest?(request: Request, ctx: Context): Request | Promise<Request>;

  /**
   * Decide if a cached record should be served (HIT/STALE path).
   * Return false to skip serving and fetch fresh.
   */
  validateCacheHit?(record: CacheRecord, ctx: Context): boolean | Promise<boolean>;

  /**
   * Decide if an origin response should be cached.
   * Return true to cache, false to skip, 'hit-for-pass' to store HFP.
   */
  shouldCache?(response: Response, bodyText: string, ctx: Context): boolean | 'hit-for-pass' | Promise<boolean | 'hit-for-pass'>;

  /**
   * Final response transformation before sending to client.
   * Return the (possibly modified) Response.
   */
  transformResponse?(response: Response, ctx: Context, cacheState: string): Response | Promise<Response>;
}

/**
 * Plugin manager - orchestrates hook execution in registry order.
 */
export interface PluginManager {
  readonly plugins: readonly Plugin[];

  runOnRequest(ctx: Context): Promise<Response | void>;
  runTransformCacheKey(key: string, ctx: Context): string;
  runTransformOriginRequest(request: Request, ctx: Context): Promise<Request>;
  runValidateCacheHit(record: CacheRecord, ctx: Context): Promise<boolean>;
  runShouldCache(response: Response, bodyText: string, ctx: Context): Promise<boolean | 'hit-for-pass'>;
  runTransformResponse(response: Response, ctx: Context, cacheState: string): Promise<Response>;
}

export type PluginFactory = (config: Config) => Plugin | null;
