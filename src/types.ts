export interface Config {
  originHost: string | null;
  originProtocol: string | null;
  defaultTtl: number;
  graceSeconds: number;
  respectPrivateNoCache: boolean;
  respectCacheControl: boolean;
  hitForPassSeconds: number;
  cacheLoggedIn: boolean;
  debug: boolean;
  returnClaims: boolean;
  purgeSecret: string;
  staticPathPattern: RegExp;
  healthCheckPattern: RegExp;
  marketingParams: string[];
  excludedPaths: string[];
  graphqlPath: string;
  varyCookies: string[];
  varyHeaders: string[];
  varyOnDeviceType: boolean;
  mobileUaPattern: RegExp;
  tabletUaPattern: RegExp;
  allowedCookieNames: string[];
  includedResponseTypes: string[];
  replaceOriginLinks: boolean;
  detectMergedStylesChanges: boolean;
  mergedStylesCheckTtlSeconds: number;
}

export interface Context {
  request: Request;
  env: Env;
  config: Config;
  claims: string[];
  originalUrl: string;
  url: URL;
  pathname: string;
  search: string;
  marketingRemoved: string[];
  cookieHeader: string;
  sslOffloaded: string;
  isStatic: boolean;
  isHealthCheck: boolean;
  isGraphql: boolean;
  magentoCacheId: string;
  hasAuthToken: boolean;
  authHeader: string;
  store: string;
  currency: string;
  cacheKey: string | null;
  isBypassed: boolean;
}

export interface CacheRecord {
  state: 'cache' | 'pass';
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  expires: number;
  staleUntil?: number;
}

export interface BypassResult {
  bypass: boolean;
  reason: string;
}

export interface FetchResult {
  response: Response;
  cacheResult?: CacheRecord;
  skipCache?: boolean;
  uncacheableReason?: string;
}
