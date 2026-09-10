import type { ProjectConfig } from "./config";
import type { RequestContext } from "./request";
/** Apply client diagnostics without changing cache eligibility or cache headers. */
export function finalize(
  response: Response,
  context: RequestContext,
  config: ProjectConfig,
  state: string,
): Response {
  const headers = new Headers(response.headers);
  if (config.plugins.debugHeaders) headers.set("X-FPC-Cache", state);
  if (config.plugins.returnClaims && context.claims.length)
    headers.set("X-APO-Claims", [...new Set(context.claims)].join("|"));
  return new Response(
    context.request.method === "HEAD" ? null : response.body,
    { status: response.status, statusText: response.statusText, headers },
  );
}
