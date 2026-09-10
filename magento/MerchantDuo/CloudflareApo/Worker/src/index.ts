import { config } from "./config";
import { noStore } from "./cache-policy";
import { createPlugins } from "./plugins";
import {
  buildOriginRequest,
  bypassReason,
  createRequestContext,
} from "./request";
import { finalize } from "./response";
import { handlePurge } from "./purge";
import { event } from "./observability";
export { Storefront } from "./storefront";
const plugins = createPlugins(config);
/** Uncached gateway: authenticate purge, normalize/classify, bypass private traffic, then call cached Storefront. */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    if (
      request.method === "POST" &&
      new URL(request.url).pathname === config.purge.path
    )
      return handlePurge(
        request,
        env.PURGE_SECRET,
        ctx.exports.Storefront,
        plugins,
      );
    const context = createRequestContext(request, config);
    const pluginResponse = await plugins.gateway(context);
    if (pluginResponse)
      return finalize(noStore(pluginResponse), context, config, "BYPASS");
    const reason = bypassReason(context, config);
    if (reason) {
      context.claims.push(`bypass:${reason}`);
      let originRequest = buildOriginRequest(context, config);
      originRequest = await plugins.origin(originRequest, context);
      const response = await fetch(originRequest);
      event("gateway.bypass", {
        method: request.method,
        reason,
        originStatus: response.status,
      });
      return finalize(noStore(response), context, config, "BYPASS");
    }
    context.claims.push("cache:storefront");
    const response = await ctx.exports.Storefront.fetch(request, {
      cf: { cacheKey: context.cacheKey },
    });
    event("gateway.storefront", {
      method: request.method,
      graphql: context.isGraphql,
      cacheStatus: response.headers.get("Cf-Cache-Status"),
    });
    return finalize(response, context, config, "NATIVE");
  },
} satisfies ExportedHandler<Env>;
