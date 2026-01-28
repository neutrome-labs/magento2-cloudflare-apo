import type { Config } from './types';

export const DEFAULTS = {
  // Cache TTL settings
  DEFAULT_TTL: 86400,
  GRACE_SECONDS: 259200,
  RESPECT_PRIVATE_NO_CACHE: false,
  RESPECT_CACHE_CONTROL: false,
  HIT_FOR_PASS_SECONDS: 120,

  // Cache behavior
  CACHE_LOGGED_IN: true,
  STREAM_MISS_RESPONSES: true,

  // Path patterns
  STATIC_PATH_PATTERN: '^/(?:pub/)?(?:media|static)/',
  HEALTH_CHECK_PATTERN: '^/(?:pub/)?health_check\\.php$',

  // URL handling
  MARKETING_PARAMS: ['gclid', 'cx', 'ie', 'cof', 'siteurl', 'zanpid', 'origin', 'fbclid', 'mc_*', 'utm_*', '_bta_*'],
  EXCLUDED_PATHS: ['/admin', '/customer', '/section/load', '/checkout', '/wishlist', '/cart', '/sales', '/rest/', '/onestepcheckout', '/password'],
  GRAPHQL_PATH: '/graphql',

  // Cache key variation
  VARY_COOKIES: ['X-Magento-Vary'],
  VARY_HEADERS: [] as string[],
  VARY_ON_DEVICE_TYPE: true,
  MOBILE_UA_PATTERN: '(?:phone|windows\\s+phone|ipod|blackberry|(?:android|bb\\d+|meego|silk|googlebot) .+? mobile|palm|windows\\s+ce|opera mini|avantgo|mobilesafari|docomo|kaios)',
  TABLET_UA_PATTERN: '(?:ipad|playbook|(?:android|bb\\d+|meego|silk)(?! .+? mobile))',

  // Request/response filtering
  CACHEABLE_COOKIE_NAMES: ['X-Magento-Vary', 'store', 'currency', 'form_key', 'private_content_version', 'section_data_ids', 'mage-cache-sessid', 'mage-cache-storage', 'mage-cache-storage-section-invalidation', 'mage-messages'],
  CACHEABLE_MIME_TYPES: ['text/html', 'text/css', 'text/javascript', 'application/javascript'],

  // Debug & plugins
  DEBUG: false,
  RETURN_CLAIMS: true,
  REPLACE_ORIGIN_LINKS: false,
  DETECT_MERGED_STYLES_CHANGE: false,
  MERGED_STYLES_CHECK_TTL_SECONDS: 60
} as const;

function envBool(val: string | undefined, fallback: boolean): boolean {
  if (val === undefined) return fallback;
  return val === 'true';
}

function envInt(val: string | undefined, fallback: number): number {
  return val ? parseInt(val, 10) : fallback;
}

function envArray(val: string | undefined, fallback: readonly string[]): string[] {
  if (!val) return [...fallback];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function parseOriginHost(val: string | undefined): { host: string | null; protocol: string | null } {
  if (!val) return { host: null, protocol: null };
  
  // Check if it includes a protocol (e.g., https://backend.example.com)
  if (val.includes('://')) {
    try {
      const url = new URL(val);
      return { host: url.host, protocol: url.protocol };
    } catch {
      return { host: val, protocol: null };
    }
  }
  
  return { host: val, protocol: null };
}

export function buildConfig(env: Env): Config {
  const origin = parseOriginHost(env.ORIGIN_HOST);
  const varyCookies = envArray(env.VARY_COOKIES, DEFAULTS.VARY_COOKIES);
  // Support both new and old env var names for backward compatibility
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cacheableCookieNames = envArray(env.CACHEABLE_COOKIE_NAMES || (env as any).ALLOWED_COOKIE_NAMES, DEFAULTS.CACHEABLE_COOKIE_NAMES);
  // Merge VARY_COOKIES into CACHEABLE_COOKIE_NAMES to avoid manual double-config
  const mergedCacheableCookies = [...new Set([...cacheableCookieNames, ...varyCookies])];
  
  return {
    // Cache TTL settings
    defaultTtl: envInt(env.DEFAULT_TTL, DEFAULTS.DEFAULT_TTL),
    graceSeconds: envInt(env.GRACE_SECONDS, DEFAULTS.GRACE_SECONDS),
    respectPrivateNoCache: envBool(env.RESPECT_PRIVATE_NO_CACHE, DEFAULTS.RESPECT_PRIVATE_NO_CACHE),
    respectCacheControl: envBool(env.RESPECT_CACHE_CONTROL, DEFAULTS.RESPECT_CACHE_CONTROL),
    hitForPassSeconds: envInt(env.HIT_FOR_PASS_SECONDS, DEFAULTS.HIT_FOR_PASS_SECONDS),

    // Cache behavior
    cacheLoggedIn: envBool(env.CACHE_LOGGED_IN, DEFAULTS.CACHE_LOGGED_IN),
    streamMissResponses: envBool(env.STREAM_MISS_RESPONSES, DEFAULTS.STREAM_MISS_RESPONSES),

    // Path patterns
    staticPathPattern: new RegExp(env.STATIC_PATH_PATTERN || DEFAULTS.STATIC_PATH_PATTERN),
    healthCheckPattern: new RegExp(env.HEALTH_CHECK_PATTERN || DEFAULTS.HEALTH_CHECK_PATTERN),

    // URL handling
    marketingParams: envArray(env.MARKETING_PARAMS, DEFAULTS.MARKETING_PARAMS),
    excludedPaths: envArray(env.EXCLUDED_PATHS, DEFAULTS.EXCLUDED_PATHS),
    graphqlPath: env.GRAPHQL_PATH || DEFAULTS.GRAPHQL_PATH,

    // Cache key variation
    varyCookies,
    varyHeaders: envArray(env.VARY_HEADERS, DEFAULTS.VARY_HEADERS),
    varyOnDeviceType: envBool(env.VARY_ON_DEVICE_TYPE, DEFAULTS.VARY_ON_DEVICE_TYPE),
    mobileUaPattern: new RegExp(env.MOBILE_UA_PATTERN || DEFAULTS.MOBILE_UA_PATTERN, 'i'),
    tabletUaPattern: new RegExp(env.TABLET_UA_PATTERN || DEFAULTS.TABLET_UA_PATTERN, 'i'),

    // Request/response filtering
    cacheableCookieNames: mergedCacheableCookies,
    // Support both new and old env var names for backward compatibility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cacheableMimeTypes: envArray(env.CACHEABLE_MIME_TYPES || (env as any).INCLUDED_RESPONSE_TYPES, DEFAULTS.CACHEABLE_MIME_TYPES),

    // Origin settings
    originHost: origin.host,
    originProtocol: origin.protocol,

    // Debug & plugins
    debug: envBool(env.DEBUG, DEFAULTS.DEBUG),
    returnClaims: envBool(env.RETURN_CLAIMS, DEFAULTS.RETURN_CLAIMS),
    replaceOriginLinks: envBool(env.REPLACE_ORIGIN_LINKS, DEFAULTS.REPLACE_ORIGIN_LINKS),
    detectMergedStylesChange: envBool(env.DETECT_MERGED_STYLES_CHANGE, DEFAULTS.DETECT_MERGED_STYLES_CHANGE),
    mergedStylesCheckTtlSeconds: envInt(env.MERGED_STYLES_CHECK_TTL_SECONDS, DEFAULTS.MERGED_STYLES_CHECK_TTL_SECONDS),

    // Secrets
    purgeSecret: env.PURGE_SECRET || ''
  };
}

export function debugLog(config: Config, ...args: unknown[]): void {
  if (config.debug) {
    console.log('[FPC DEBUG]', ...args);
  }
}

/**
 * Always log errors regardless of debug setting.
 * Use for background task failures and critical errors.
 */
export function errorLog(...args: unknown[]): void {
  console.error('[FPC ERROR]', ...args);
}
