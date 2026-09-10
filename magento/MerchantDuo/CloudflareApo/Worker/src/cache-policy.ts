import type { ProjectConfig } from "./config";
import type { RequestContext } from "./request";
import type { PluginRuntime } from "./plugins";
const INTERNAL_HEADERS = [
  "age",
  "server",
  "via",
  "x-powered-by",
  "x-varnish",
  "x-pool",
  "link",
];
export async function cacheableResponse(
  origin: Response,
  context: RequestContext,
  config: ProjectConfig,
  plugins: PluginRuntime,
): Promise<Response> {
  const response = await plugins.response(origin, context);
  const headers = new Headers(response.headers);
  const cacheControl = headers.get("Cache-Control") || "";
  const contentType = (headers.get("Content-Type") || "").toLowerCase();
  const allowed =
    config.cache.statuses.includes(response.status) &&
    config.cache.mimeTypes.some((mime) => contentType.includes(mime));
  const rejected =
    !allowed ||
    /(?:private|no-store|no-cache)/i.test(cacheControl) ||
    headers.has("Set-Cookie") ||
    headers.get("Vary") === "*";
  const body = plugins.needsBody ? await response.clone().text() : null;
  if (rejected || !(await plugins.cache(response, body, context)))
    return noStore(response);
  headers.delete("Set-Cookie");
  mergeVary(headers, config.request.varyHeaders);
  headers.set(
    "Cache-Control",
    `public, max-age=${config.cache.ttlSeconds}, stale-while-revalidate=${config.cache.staleSeconds}`,
  );
  headers.set(
    "Cache-Tag",
    normalizeTags([
      ...magentoTags(headers.get("X-Magento-Tags")),
      `site:${config.siteId}`,
      `route:${context.isGraphql ? "graphql" : context.url.pathname === "/" ? "home" : "page"}`,
      ...plugins.tags(response, context),
    ]).join(","),
  );
  sanitize(headers, config.plugins.debugHeaders);
  return new Response(
    context.request.method === "HEAD" ? null : response.body,
    { status: response.status, statusText: response.statusText, headers },
  );
}
export function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.delete("Cache-Tag");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
function mergeVary(headers: Headers, configured: readonly string[]): void {
  const values = new Set(
    (headers.get("Vary") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  configured.forEach((header) => values.add(header));
  if (values.size) headers.set("Vary", [...values].join(", "));
}
export function normalizeTags(tags: readonly string[]): string[] {
  return [
    ...new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => /^[\x21-\x7e]{1,1024}$/.test(tag)),
    ),
  ].slice(0, 1000);
}
function magentoTags(value: string | null): string[] {
  return value ? value.split(",") : [];
}
function sanitize(headers: Headers, debug: boolean): void {
  if (!debug) {
    INTERNAL_HEADERS.forEach((name) => headers.delete(name));
    headers.delete("X-Magento-Tags");
  }
  headers.set("X-Served-With", "neutrome-labs/magento2-cloudflare-apo");
}
