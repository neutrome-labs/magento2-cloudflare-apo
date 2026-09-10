import { projectConfig } from "./generated/project-config";

export interface ProjectConfig {
  schema: "magento2-cloudflare-apo/v3";
  siteId: string;
  origin: { host: string; protocol: "http:" | "https:" };
  cache: {
    ttlSeconds: number;
    staleSeconds: number;
    statuses: readonly number[];
    mimeTypes: readonly string[];
  };
  request: {
    marketingParameters: readonly string[];
    excludedPathPrefixes: readonly string[];
    staticPathPrefixes: readonly string[];
    healthPathPrefixes: readonly string[];
    varyCookies: readonly string[];
    varyHeaders: readonly string[];
    allowOriginCookies: readonly string[];
    varyOnDevice: boolean;
    graphqlPath: string;
  };
  plugins: {
    debugHeaders: boolean;
    returnClaims: boolean;
    replaceOriginLinks: boolean;
    mergedCssGuard: boolean;
  };
  purge: {
    path: string;
    maxClockSkewSeconds: number;
    maxItemsPerRequest: number;
  };
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error(`Invalid v3 project configuration: ${message}`);
}
/** Validate the generated artifact once, before it can receive traffic. */
export function loadConfig(candidate: unknown = projectConfig): ProjectConfig {
  const config = candidate as ProjectConfig;
  assert(
    config?.schema === "magento2-cloudflare-apo/v3",
    "schema must be magento2-cloudflare-apo/v3",
  );
  assert(
    /^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(config.siteId),
    "siteId is invalid",
  );
  assert(
    /^[a-z0-9.-]+(?::\d+)?$/i.test(config.origin.host),
    "origin.host is invalid",
  );
  assert(
    config.origin.protocol === "https:" || config.origin.protocol === "http:",
    "origin.protocol is invalid",
  );
  assert(
    Number.isInteger(config.cache.ttlSeconds) && config.cache.ttlSeconds > 0,
    "cache.ttlSeconds must be positive",
  );
  assert(
    Number.isInteger(config.cache.staleSeconds) &&
      config.cache.staleSeconds >= 0,
    "cache.staleSeconds must be non-negative",
  );
  assert(
    config.cache.statuses.length > 0 &&
      config.cache.statuses.every(Number.isInteger),
    "cache.statuses is invalid",
  );
  assert(
    config.cache.mimeTypes.length > 0 &&
      config.cache.mimeTypes.every((value) => value.includes("/")),
    "cache.mimeTypes is invalid",
  );
  assert(
    config.request.excludedPathPrefixes.every((path) => path.startsWith("/")),
    "excluded paths must be prefixes",
  );
  assert(
    config.request.varyHeaders.every((header) => /^[a-z0-9-]+$/i.test(header)),
    "vary headers are invalid",
  );
  assert(
    config.request.graphqlPath.startsWith("/") &&
      config.purge.path.startsWith("/"),
    "paths must start with /",
  );
  assert(
    Number.isInteger(config.purge.maxClockSkewSeconds) &&
      config.purge.maxClockSkewSeconds > 0,
    "purge clock skew is invalid",
  );
  assert(
    Number.isInteger(config.purge.maxItemsPerRequest) &&
      config.purge.maxItemsPerRequest > 0 &&
      config.purge.maxItemsPerRequest <= 1000,
    "purge batch size is invalid",
  );
  return config;
}
export const config = loadConfig();
