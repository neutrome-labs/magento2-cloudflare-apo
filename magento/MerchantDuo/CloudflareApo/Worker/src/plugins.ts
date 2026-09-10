import type { ProjectConfig } from "./config";
import type { RequestContext } from "./request";
export interface Plugin {
  name: string;
  needsBody?: boolean;
  onGateway?(
    context: RequestContext,
  ): Promise<Response | void> | Response | void;
  transformOriginRequest?(
    request: Request,
    context: RequestContext,
  ): Promise<Request> | Request;
  shouldCache?(
    response: Response,
    body: string | null,
    context: RequestContext,
  ): Promise<boolean> | boolean;
  transformResponse?(
    response: Response,
    context: RequestContext,
  ): Promise<Response> | Response;
  tags?(response: Response, context: RequestContext): readonly string[];
  normalizePurge?(
    tags: string[],
    prefixes: string[],
  ): { tags: string[]; prefixes: string[] };
}
export class PluginRuntime {
  constructor(readonly plugins: readonly Plugin[]) {}
  get needsBody(): boolean {
    return this.plugins.some((plugin) => plugin.needsBody);
  }
  async gateway(context: RequestContext): Promise<Response | void> {
    for (const plugin of this.plugins) {
      const response = await plugin.onGateway?.(context);
      if (response) return response;
    }
  }
  async origin(request: Request, context: RequestContext): Promise<Request> {
    for (const plugin of this.plugins)
      request =
        (await plugin.transformOriginRequest?.(request, context)) ?? request;
    return request;
  }
  async cache(
    response: Response,
    body: string | null,
    context: RequestContext,
  ): Promise<boolean> {
    for (const plugin of this.plugins)
      if ((await plugin.shouldCache?.(response, body, context)) === false)
        return false;
    return true;
  }
  async response(
    response: Response,
    context: RequestContext,
  ): Promise<Response> {
    for (const plugin of this.plugins)
      response =
        (await plugin.transformResponse?.(response, context)) ?? response;
    return response;
  }
  tags(response: Response, context: RequestContext): string[] {
    return this.plugins.flatMap(
      (plugin) => plugin.tags?.(response, context) ?? [],
    );
  }
  purge(
    tags: string[],
    prefixes: string[],
  ): { tags: string[]; prefixes: string[] } {
    return this.plugins.reduce(
      (current, plugin) =>
        plugin.normalizePurge?.(current.tags, current.prefixes) ?? current,
      { tags, prefixes },
    );
  }
}
export function createPlugins(config: ProjectConfig): PluginRuntime {
  const plugins: Plugin[] = [];
  if (config.plugins.replaceOriginLinks) plugins.push(originLinks(config));
  if (config.plugins.mergedCssGuard) plugins.push(mergedCssGuard());
  return new PluginRuntime(plugins);
}
function originLinks(config: ProjectConfig): Plugin {
  return {
    name: "origin-links",
    needsBody: true,
    async transformResponse(response, context) {
      const headers = new Headers(response.headers);
      const publicHost = context.originalUrl.host;
      const originUrl = `${config.origin.protocol}//${config.origin.host}`;
      const publicUrl = `${context.originalUrl.protocol}//${publicHost}`;
      const location = headers.get("Location");
      if (location)
        headers.set(
          "Location",
          location
            .replaceAll(originUrl, publicUrl)
            .replaceAll(config.origin.host, publicHost),
        );
      if (
        !/^(text\/|application\/(javascript|json|xml))/.test(
          headers.get("Content-Type") || "",
        )
      )
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      const body = (await response.text())
        .replaceAll(originUrl, publicUrl)
        .replaceAll(config.origin.host, publicHost);
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}
function mergedCssGuard(): Plugin {
  return {
    name: "merged-css-guard",
    needsBody: true,
    async shouldCache(response, body, context) {
      if (!body || !response.headers.get("Content-Type")?.includes("text/html"))
        return true;
      const links = [
        ...body.matchAll(
          /href=["']([^"']*\/static\/version\d+\/_cache\/merged\/[^"']+\.css)["']/gi,
        ),
      ].map((match) => new URL(match[1], context.url).toString());
      return (
        await Promise.all(
          links.map(async (link) => {
            try {
              return (await fetch(link, { method: "HEAD" })).ok;
            } catch {
              return false;
            }
          }),
        )
      ).every(Boolean);
    },
  };
}
