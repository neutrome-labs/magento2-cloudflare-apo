import { config } from "./config";
import { normalizeTags } from "./cache-policy";
import type { PluginRuntime } from "./plugins";
import type { NativePurge } from "./storefront";
import { event } from "./observability";
interface PurgePayload {
  tags?: unknown;
  pathPrefixes?: unknown;
  purgeEverything?: unknown;
}
export interface StorefrontPurger {
  purge(input: NativePurge): Promise<unknown>;
}
const recentNonces = new Map<string, number>();
export async function handlePurge(
  request: Request,
  secret: string | undefined,
  storefront: StorefrontPurger,
  plugins: PluginRuntime,
): Promise<Response> {
  const raw = await request.text();
  const timestamp = request.headers.get("X-Purge-Timestamp") || "";
  const nonce = request.headers.get("X-Purge-Nonce") || "";
  const signature = request.headers.get("X-Purge-Signature") || "";
  if (!(await authentic(secret || "", timestamp, nonce, raw, signature)))
    return json({ error: "unauthorized" }, 401);
  let payload: PurgePayload;
  try {
    payload = JSON.parse(raw) as PurgePayload;
  } catch {
    return json({ error: "invalid JSON payload" }, 400);
  }
  const parsed = parsePayload(payload);
  if (parsed instanceof Error) return json({ error: parsed.message }, 400);
  const normalized = plugins.purge(parsed.tags, parsed.pathPrefixes);
  try {
    const result = await storefront.purge({
      ...parsed,
      tags: normalized.tags,
      pathPrefixes: normalized.prefixes,
    });
    event("purge.success", {
      tags: normalized.tags.length,
      pathPrefixes: normalized.prefixes.length,
      purgeEverything: parsed.purgeEverything,
    });
    return json({ success: true, result }, 200);
  } catch (error) {
    console.error("Native cache purge failed", error);
    event("purge.failure", {
      tags: normalized.tags.length,
      pathPrefixes: normalized.prefixes.length,
      purgeEverything: parsed.purgeEverything,
    });
    return json({ error: "native purge failed" }, 502);
  }
}
async function authentic(
  secret: string,
  timestamp: string,
  nonce: string,
  raw: string,
  signature: string,
): Promise<boolean> {
  const issued = Number(timestamp);
  if (
    !secret ||
    !Number.isInteger(issued) ||
    Math.abs(Date.now() - issued * 1000) >
      config.purge.maxClockSkewSeconds * 1000 ||
    !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)
  )
    return false;
  purgeExpiredNonces();
  if (recentNonces.has(nonce)) return false;
  const expected = await hmac(`${timestamp}.${nonce}.${raw}`, secret);
  if (!constantTimeEqual(expected, signature)) return false;
  recentNonces.set(nonce, Date.now() + config.purge.maxClockSkewSeconds * 1000);
  return true;
}
async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index++)
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}
function purgeExpiredNonces(): void {
  const now = Date.now();
  for (const [nonce, expiresAt] of recentNonces)
    if (expiresAt <= now) recentNonces.delete(nonce);
}
function parsePayload(payload: PurgePayload): NativePurge | Error {
  if (payload.purgeEverything === true)
    return { tags: [], pathPrefixes: [], purgeEverything: true };
  if (
    payload.tags !== undefined &&
    (!Array.isArray(payload.tags) ||
      !payload.tags.every((tag) => typeof tag === "string"))
  )
    return new Error("tags must be strings");
  if (
    payload.pathPrefixes !== undefined &&
    (!Array.isArray(payload.pathPrefixes) ||
      !payload.pathPrefixes.every((prefix) => typeof prefix === "string"))
  )
    return new Error("pathPrefixes must be strings");
  const rawTags = (payload.tags || []) as string[];
  const tags = normalizeTags(rawTags);
  if (
    tags.length !== new Set(rawTags.map((tag) => tag.trim().toLowerCase())).size
  )
    return new Error(
      "unsafe purge tag; request explicit purgeEverything instead",
    );
  const pathPrefixes = [
    ...new Set(
      ((payload.pathPrefixes || []) as string[]).map((prefix) => prefix.trim()),
    ),
  ];
  if (pathPrefixes.some((prefix) => !/^\/[\x21-\x7e]{0,1023}$/.test(prefix)))
    return new Error("unsafe path prefix");
  if (
    (!tags.length && !pathPrefixes.length) ||
    tags.length > config.purge.maxItemsPerRequest ||
    pathPrefixes.length > config.purge.maxItemsPerRequest
  )
    return new Error("provide bounded tags, pathPrefixes, or purgeEverything");
  return { tags, pathPrefixes, purgeEverything: false };
}
function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
