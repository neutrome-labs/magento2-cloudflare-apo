import { WorkerEntrypoint, cache } from "cloudflare:workers";
import { config } from "./config";
import { cacheableResponse } from "./cache-policy";
import { createPlugins } from "./plugins";
import { buildOriginRequest, createRequestContext } from "./request";
import { event } from "./observability";
const plugins = createPlugins(config);
export interface NativePurge {
  tags: string[];
  pathPrefixes: string[];
  purgeEverything: boolean;
}
/** Cache-enabled entrypoint: Cloudflare invokes this only on a native miss/revalidation. */
export class Storefront extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const context = createRequestContext(request, config);
    let originRequest = buildOriginRequest(context, config);
    originRequest = await plugins.origin(originRequest, context);
    const origin = await fetch(originRequest);
    const response = await cacheableResponse(origin, context, config, plugins);
    event("storefront.miss", {
      method: request.method,
      graphql: context.isGraphql,
      originStatus: origin.status,
      cacheable: response.headers.get("Cache-Control") !== "no-store",
    });
    return response;
  }
  async purge(input: NativePurge): Promise<unknown> {
    if (input.purgeEverything) return cache.purge({ purgeEverything: true });
    // Native purge limits are request scoped. Split independent tag/prefix sets,
    // retrying a transient platform failure without ever widening the request.
    const results: unknown[] = [];
    for (const tags of chunks(input.tags, 100))
      results.push(await retry(() => cache.purge({ tags })));
    for (const pathPrefixes of chunks(input.pathPrefixes, 100))
      results.push(await retry(() => cache.purge({ pathPrefixes })));
    return results;
  }
}
function chunks(values: string[], size: number): string[][] {
  const result: string[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}
async function retry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 2)
        await new Promise<void>((resolve) =>
          setTimeout(resolve, 50 * (attempt + 1)),
        );
    }
  }
  throw lastError;
}
