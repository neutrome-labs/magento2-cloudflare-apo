# v3 architecture

## Scope and boundaries

The Worker is an internal Magento 2 full-page cache. v3 replaces KV-backed page
records with Cloudflare Workers Caching. No v2 configuration aliases or response
record compatibility remain. The Magento module produces the generated project
configuration at build time and delivers signed invalidations through its
Magento declarative purge queue; the Worker only accepts runtime secrets through
bindings. The module does not include partial Worker deployment, VCL/AI rule,
or operations-UI workflows.

`Gateway` is the default, explicitly uncached entrypoint. It normalizes every
request, applies bypass policy, authenticates purge webhooks, and invokes the
cache-enabled `Storefront` loopback with the canonical native cache key.

`Storefront` runs only on a native cache miss/revalidation. It fetches Magento,
applies miss plugins, rejects private/unsafe responses, and returns the final
cacheable response with Cloudflare cache headers, `Vary`, and `Cache-Tag`.

```text
browser or Magento purge
          |
          v
Gateway (cache disabled) -- bypass --> Magento origin
          |
          +-- canonical loopback --> Storefront (cache enabled) --> Magento origin on miss
                                        |
                                        +--> Workers Caching
```

The entrypoint cache key is deliberately only a canonical path/query string.
Bounded variation inputs are encoded in that key. This avoids depending on raw
cookies, `User-Agent`, or the request host.

## Implemented source layout

```text
src/
├── config.ts                    # validates generated config
├── generated/project-config.ts  # Magento-produced data-only artifact
├── request.ts                   # normalized facts, bypass, key, origin request
├── cache-policy.ts              # eligibility, HTTP cache headers, tags
├── plugins.ts                   # gateway/miss/response/tag/purge plugin contract
├── purge.ts                     # signed payload parsing and native purge dispatch
├── response.ts                  # browser-safe response finalization
├── storefront.ts                # cache-enabled WorkerEntrypoint
└── index.ts                     # cache-disabled gateway
```

## Contract decisions

- Only `GET` and `HEAD` can enter shared cache. The gateway bypasses private
  request shapes before the loopback call.
- Cacheable output uses `Cache-Control: public, max-age=<ttl>,
stale-while-revalidate=<grace>`. `s-maxage` is intentionally not used because
  it disables Cloudflare's native stale-while-revalidate behavior.
- `Set-Cookie`, private/no-store, `Vary: *`, non-policy status/MIME, invalid
  GraphQL identity, or plugin rejection result in `no-store` output.
- Native purge runs inside `Storefront`, so tags, path prefixes, and full flush
  all target the entrypoint that owns cached responses. Batches are retried
  without widening their requested scope.
- Signed purges use `X-Purge-Timestamp`, `X-Purge-Nonce`, and
  `X-Purge-Signature` (HMAC-SHA-256 over `timestamp.nonce.body`). A short-lived
  in-memory nonce guard rejects immediate replays; production-wide replay
  persistence is intentionally not added to this pre-launch Worker.

## Validation boundary

Unit tests cover canonical requests and cache response policy. Type checking and
Wrangler dry-run validate the module graph and native-cache configuration. They
cannot prove globally distributed hits, stale revalidation, request collapse,
or entrypoint purge propagation; those remain staging acceptance checks.
