import type { Config } from './types';

export const DEFAULTS = {
  DEFAULT_TTL: 86400,
  GRACE_SECONDS: 259200,
  HIT_FOR_PASS_SECONDS: 120,
  RESPECT_PRIVATE_NO_CACHE: false,
  RESPECT_CACHE_CONTROL: false,
  CACHE_LOGGED_IN: true,
  DEBUG: false,
  RETURN_CLAIMS: true,
  STATIC_PATH_PATTERN: '^/(?:pub/)?(?:media|static)/',
  HEALTH_CHECK_PATTERN: '^/(?:pub/)?health_check\\.php$',
  MARKETING_PARAMS: ['gclid', 'cx', 'ie', 'cof', 'siteurl', 'zanpid', 'origin', 'fbclid', 'mc_*', 'utm_*', '_bta_*'],
  EXCLUDED_PATHS: ['/admin', '/customer', '/section/load', '/checkout', '/wishlist', '/cart', '/sales', '/rest/', '/onestepcheckout', '/password'],
  GRAPHQL_PATH: '/graphql',
  VARY_COOKIES: ['X-Magento-Vary'],
  VARY_HEADERS: [] as string[],
  VARY_ON_DEVICE_TYPE: true,
  MOBILE_UA_PATTERN: '(?:phone|windows\\s+phone|ipod|blackberry|(?:android|bb\\d+|meego|silk|googlebot) .+? mobile|palm|windows\\s+ce|opera mini|avantgo|mobilesafari|docomo|kaios)',
  TABLET_UA_PATTERN: '(?:ipad|playbook|(?:android|bb\\d+|meego|silk)(?! .+? mobile))',
  ALLOWED_COOKIE_NAMES: ['X-Magento-Vary', 'store', 'currency', 'form_key', 'private_content_version', 'section_data_ids', 'mage-cache-sessid', 'mage-cache-storage', 'mage-cache-storage-section-invalidation', 'mage-messages'],
  INCLUDED_RESPONSE_TYPES: ['text/html', 'text/css', 'text/javascript', 'application/javascript']
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
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [...fallback];
  } catch {
    return [...fallback];
  }
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
  return {
    originHost: origin.host,
    originProtocol: origin.protocol,
    defaultTtl: envInt(env.DEFAULT_TTL, DEFAULTS.DEFAULT_TTL),
    graceSeconds: envInt(env.GRACE_SECONDS, DEFAULTS.GRACE_SECONDS),
    hitForPassSeconds: envInt(env.HIT_FOR_PASS_SECONDS, DEFAULTS.HIT_FOR_PASS_SECONDS),
    respectPrivateNoCache: envBool(env.RESPECT_PRIVATE_NO_CACHE, DEFAULTS.RESPECT_PRIVATE_NO_CACHE),
    respectCacheControl: envBool(env.RESPECT_CACHE_CONTROL, DEFAULTS.RESPECT_CACHE_CONTROL),
    cacheLoggedIn: envBool(env.CACHE_LOGGED_IN, DEFAULTS.CACHE_LOGGED_IN),
    debug: envBool(env.DEBUG, DEFAULTS.DEBUG),
    returnClaims: envBool(env.RETURN_CLAIMS, DEFAULTS.RETURN_CLAIMS),
    purgeSecret: env.PURGE_SECRET || '',
    staticPathPattern: new RegExp(env.STATIC_PATH_PATTERN || DEFAULTS.STATIC_PATH_PATTERN),
    healthCheckPattern: new RegExp(env.HEALTH_CHECK_PATTERN || DEFAULTS.HEALTH_CHECK_PATTERN),
    marketingParams: envArray(env.MARKETING_PARAMS, DEFAULTS.MARKETING_PARAMS),
    excludedPaths: envArray(env.EXCLUDED_PATHS, DEFAULTS.EXCLUDED_PATHS),
    graphqlPath: env.GRAPHQL_PATH || DEFAULTS.GRAPHQL_PATH,
    varyCookies: envArray(env.VARY_COOKIES, DEFAULTS.VARY_COOKIES),
    varyHeaders: envArray(env.VARY_HEADERS, DEFAULTS.VARY_HEADERS),
    varyOnDeviceType: envBool(env.VARY_ON_DEVICE_TYPE, DEFAULTS.VARY_ON_DEVICE_TYPE),
    mobileUaPattern: new RegExp(env.MOBILE_UA_PATTERN || DEFAULTS.MOBILE_UA_PATTERN, 'i'),
    tabletUaPattern: new RegExp(env.TABLET_UA_PATTERN || DEFAULTS.TABLET_UA_PATTERN, 'i'),
    allowedCookieNames: envArray(env.ALLOWED_COOKIE_NAMES, DEFAULTS.ALLOWED_COOKIE_NAMES),
    includedResponseTypes: envArray(env.INCLUDED_RESPONSE_TYPES, DEFAULTS.INCLUDED_RESPONSE_TYPES)
  };
}

export function debugLog(config: Config, ...args: unknown[]): void {
  if (config.debug) {
    console.log('[FPC DEBUG]', ...args);
  }
}
