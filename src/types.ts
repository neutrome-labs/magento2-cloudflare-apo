import type { PluginManager } from './plugins';

export interface Config {
  defaultTtl: number;
  graceSeconds: number;
  respectPrivateNoCache: boolean;
  respectCacheControl: boolean;
  hitForPassSeconds: number;

  cacheLoggedIn: boolean;

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

  cacheableCookieNames: string[];
  cacheableMimeTypes: string[];
  
  originHost: string | null;
  originProtocol: string | null;
  
  debug: boolean;
  returnClaims: boolean;
  replaceOriginLinks: boolean;
  detectMergedStylesChange: boolean;
  mergedStylesCheckTtlSeconds: number;

  purgeSecret: string;
}

export interface Context {
  env: Env;
  config: Config;
  plugins: PluginManager;

  request: Request;
  cacheKey: string | null;
  
  originalUrl: string;
  url: URL;
  pathname: string;
  search: string;
  marketingRemoved: string[];
  
  isStatic: boolean;
  isHealthCheck: boolean;
  isGraphql: boolean;

  cookieHeader: string;
  sslOffloaded: string;
  magentoCacheId: string;
  hasAuthToken: boolean;
  authHeader: string;
  store: string;
  currency: string;
  
  claims: string[];
  isBypassed: boolean;
  
  waitUntil: (promise: Promise<unknown>) => void;
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
