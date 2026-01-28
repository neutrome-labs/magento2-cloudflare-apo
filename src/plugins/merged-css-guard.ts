import type { Config, Context } from '../types';
import type { Plugin } from '.';
import { debugLog } from '../config';

const ASSET_OK_PREFIX = 'assetok:';

/**
 * Merged CSS Guard Plugin
 * Validates that merged CSS assets referenced in HTML still exist (return 200).
 * If any are missing, blocks caching to prevent serving broken pages.
 * 
 * Note: Disabled when streamMissResponses=true (shouldCache requires body buffering).
 */

/**
 * Extract Magento merged CSS links from HTML
 * e.g., /static/version1762259560/_cache/merged/<hash>.min.css
 */
function extractMergedCssLinks(html: string, baseUrl: string): string[] {
  if (!html) return [];

  const results = new Set<string>();
  const re = /href=["']([^"']*\/static\/version\d+\/_cache\/merged\/[^"']+\.css)["']/gi;
  let m;

  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    try {
      let abs: string;
      if (/^https?:\/\//i.test(href)) {
        abs = href;
      } else if (href.startsWith('//')) {
        const b = new URL(baseUrl);
        abs = `${b.protocol}${href}`;
      } else {
        abs = new URL(href, baseUrl).toString();
      }
      results.add(abs);
    } catch {
      // ignore URL parsing errors
    }
  }

  return Array.from(results);
}

/**
 * Check if a single asset URL returns 200 OK
 * Results are cached in KV to avoid repeated HEAD requests
 */
async function checkAssetOk(
  url: string,
  context: Context
): Promise<{ ok: boolean; cached: boolean }> {
  const { config, env } = context;
  const key = ASSET_OK_PREFIX + url;

  // Check KV cache first
  try {
    const cached = await env.FPC_CACHE.get(key, 'text');
    if (cached === '1') return { ok: true, cached: true };
    if (cached === '0') return { ok: false, cached: true };
  } catch {
    // KV error, proceed with HEAD request
  }

  // Not cached, perform HEAD request
  let ok = false;
  try {
    const headRes = await fetch(url, { method: 'HEAD' });
    ok = headRes.status === 200;
  } catch {
    ok = false;
  }

  // Cache the result
  const ttl = Math.max(5, config.mergedStylesCheckTtlSeconds);
  try {
    await env.FPC_CACHE.put(key, ok ? '1' : '0', { expirationTtl: ttl });
  } catch {
    // Ignore KV write errors
  }

  return { ok, cached: false };
}

interface CssVerifyResult {
  ok: boolean;
  count: number;
  failed?: number;
}

/**
 * Verify that all merged CSS assets referenced in HTML exist (return 200)
 * If any are missing, returns ok: false to trigger cache invalidation
 */
async function verifyMergedCss(
  html: string,
  context: Context
): Promise<CssVerifyResult> {
  const { config } = context;

  if (!config.detectMergedStylesChange) {
    return { ok: true, count: 0 };
  }

  const baseUrl = context.url.toString();
  const cssLinks = extractMergedCssLinks(html, baseUrl);

  if (!cssLinks.length) {
    return { ok: true, count: 0 };
  }

  debugLog(config, `Checking ${cssLinks.length} merged CSS asset(s)`);

  try {
    let cachedHits = 0;
    const checks = await Promise.all(
      cssLinks.map(async (u) => {
        const res = await checkAssetOk(u, context);
        if (res.cached) cachedHits++;
        return res.ok;
      })
    );

    const allOk = checks.every(Boolean);

    if (!allOk) {
      const failedCount = checks.filter((ok) => !ok).length;
      debugLog(config, `Merged CSS check failed: ${failedCount}/${cssLinks.length} not 200`);
      context.claims.push('css:merged-miss');
      return { ok: false, count: cssLinks.length, failed: failedCount };
    }

    if (cachedHits > 0) {
      context.claims.push('css:asset-cache-hit');
    }
    context.claims.push('css:merged-ok');
    return { ok: true, count: cssLinks.length };
  } catch (e) {
    debugLog(config, `Merged CSS verification error: ${e instanceof Error ? e.message : e}`);
    context.claims.push('css:merged-error');
    return { ok: false, count: cssLinks.length, failed: cssLinks.length };
  }
}

/**
 * Get Content-Type header value from a headers object (case-insensitive)
 */
function getHeaderValue(
  headersObject: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (!headersObject) return undefined;
  if (name in headersObject) return headersObject[name];

  const target = name.toLowerCase();
  for (const key of Object.keys(headersObject)) {
    if (key.toLowerCase() === target) return headersObject[key];
  }
  return undefined;
}

/**
 * Merged CSS Guard Plugin
 * Validates that merged CSS assets referenced in HTML still exist (return 200).
 * If any are missing, blocks caching to prevent serving broken pages.
 */
export function mergedCssGuardPlugin(config: Config): Plugin | null {
  if (!config.detectMergedStylesChange) return null;
  
  // Disable when streaming is enabled - shouldCache requires body buffering
  if (config.streamMissResponses) return null;

  return {
    name: 'merged-css-guard',

    async validateCacheHit(record, ctx) {
      const contentType = getHeaderValue(record.headers, 'Content-Type') || '';
      if (!contentType.includes('text/html')) return true;

      const check = await verifyMergedCss(record.body || '', ctx);
      if (!check.ok) {
        debugLog(config, `CSS guard: invalidating cache hit (${check.failed}/${check.count} assets missing)`);
        return false;
      }
      return true;
    },

    async shouldCache(_response, bodyText, ctx) {
      const contentType = ctx.request.headers.get('Accept') || '';
      // Only check HTML responses
      if (!contentType.includes('text/html')) return true;

      const check = await verifyMergedCss(bodyText, ctx);
      if (!check.ok) {
        debugLog(config, `CSS guard: blocking cache (${check.failed}/${check.count} assets missing)`);
        return 'hit-for-pass';
      }
      return true;
    }
  };
}
