import type { ProjectConfig } from "./config";
export interface RequestContext {
  request: Request;
  originalUrl: URL;
  url: URL;
  removedMarketingParameters: string[];
  claims: string[];
  isGraphql: boolean;
  cacheKey: string;
}
export function createRequestContext(
  request: Request,
  config: ProjectConfig,
): RequestContext {
  const originalUrl = new URL(request.url);
  const url = new URL(request.url);
  const removedMarketingParameters = normalizeUrl(
    url,
    config.request.marketingParameters,
  );
  const context = {
    request,
    originalUrl,
    url,
    removedMarketingParameters,
    claims: removedMarketingParameters.length
      ? [`strip_params:${removedMarketingParameters.join(",")}`]
      : [],
    isGraphql: url.pathname === config.request.graphqlPath,
    cacheKey: "",
  };
  context.cacheKey = buildCacheKey(context, config);
  return context;
}
function normalizeUrl(url: URL, patterns: readonly string[]): string[] {
  const removed: string[] = [];
  for (const key of [...url.searchParams.keys()])
    if (patterns.some((pattern) => match(key, pattern))) {
      removed.push(key);
      url.searchParams.delete(key);
    }
  const values = [...url.searchParams.entries()].sort(
    ([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv),
  );
  url.search = "";
  values.forEach(([key, value]) => url.searchParams.append(key, value));
  return removed;
}
function match(value: string, pattern: string): boolean {
  return pattern.endsWith("*")
    ? value.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase())
    : value.toLowerCase() === pattern.toLowerCase();
}
export function bypassReason(
  context: RequestContext,
  config: ProjectConfig,
): string | null {
  const { request, url } = context;
  if (request.method !== "GET" && request.method !== "HEAD")
    return `method:${request.method}`;
  if (request.headers.has("Authorization")) return "authorization";
  if (request.headers.has("Range")) return "range";
  if (
    config.request.staticPathPrefixes.some((prefix) =>
      url.pathname.startsWith(prefix),
    )
  )
    return "static-path";
  if (
    config.request.healthPathPrefixes.some((prefix) =>
      url.pathname.startsWith(prefix),
    )
  )
    return "health-check";
  if (
    config.request.excludedPathPrefixes.some(
      (prefix) =>
        url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    )
  )
    return "excluded-path";
  if (context.isGraphql && !request.headers.get("X-Magento-Cache-Id"))
    return "graphql-without-cache-id";
  if (
    /(?:^|;\s*)(?:PHPSESSID|customer|customer_segment_ids)=/i.test(
      request.headers.get("Cookie") || "",
    )
  )
    return "private-session";
  return null;
}
/** Canonical bounded values become the loopback native Workers Cache key. */
export function buildCacheKey(
  context: Omit<RequestContext, "cacheKey"> | RequestContext,
  config: ProjectConfig,
): string {
  const variants = [`site=${config.siteId}`];
  const cookies = parseCookies(context.request.headers.get("Cookie") || "");
  for (const name of config.request.varyCookies) {
    const value = cookies.get(name.toLowerCase());
    if (value)
      variants.push(
        `cookie:${name.toLowerCase()}=${encodeURIComponent(value.slice(0, 256))}`,
      );
  }
  for (const name of config.request.varyHeaders) {
    const value = context.request.headers.get(name);
    if (value)
      variants.push(
        `header:${name.toLowerCase()}=${encodeURIComponent(value.slice(0, 256))}`,
      );
  }
  if (config.request.varyOnDevice)
    variants.push(
      `device=${device(context.request.headers.get("User-Agent") || "")}`,
    );
  for (const name of ["Store", "Content-Currency"]) {
    const value = context.request.headers.get(name);
    if (value)
      variants.push(
        `${name.toLowerCase()}=${encodeURIComponent(value.slice(0, 256))}`,
      );
  }
  if (context.isGraphql)
    variants.push(
      `graphql=${encodeURIComponent((context.request.headers.get("X-Magento-Cache-Id") || "").slice(0, 256))}`,
    );
  return `${context.url.pathname}${context.url.search}${context.url.search ? "&" : "?"}__fpc=${variants.sort().join(";")}`;
}
function parseCookies(value: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const pair of value.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) result.set(name.toLowerCase(), rest.join("="));
  }
  return result;
}
function device(userAgent: string): "mobile" | "tablet" | "desktop" {
  if (/(ipad|playbook|android(?!.*mobile))/i.test(userAgent)) return "tablet";
  return /(mobile|iphone|ipod|android)/i.test(userAgent) ? "mobile" : "desktop";
}
export function buildOriginRequest(
  context: RequestContext,
  config: ProjectConfig,
): Request {
  const target = new URL(context.url);
  target.protocol = config.origin.protocol;
  target.host = config.origin.host;
  const headers = new Headers(context.request.headers);
  headers.set("Host", context.originalUrl.host);
  headers.delete("CF-Connecting-IP");
  headers.delete("X-Forwarded-For");
  const allowed = new Set(
    config.request.allowOriginCookies.map((name) => name.toLowerCase()),
  );
  const cookies = [...parseCookies(context.request.headers.get("Cookie") || "")]
    .filter(([name]) => allowed.has(name))
    .map(([name, value]) => `${name}=${value}`);
  if (cookies.length) headers.set("Cookie", cookies.join("; "));
  else headers.delete("Cookie");
  return new Request(target, {
    method: context.request.method,
    headers,
    redirect: context.request.redirect,
  });
}
