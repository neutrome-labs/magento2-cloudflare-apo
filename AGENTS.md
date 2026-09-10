# Agent guide

## v3 architecture

The Worker is a clean pre-launch v3 implementation, not a compatibility layer.
Never reintroduce KV page storage, `CacheRecord`, hit-for-pass records, legacy
environment aliases, or the v2 single-handler orchestration.

`src/index.ts` is the cache-disabled Gateway. `src/storefront.ts` is the
cache-enabled `WorkerEntrypoint`. Only the Gateway may inspect untrusted browser
request state and then select the canonical loopback cache key. Only Storefront
may call native cache purge, because native purges are entrypoint scoped.

`src/generated/project-config.ts` is a data-only Magento deployment artifact.
Validate new fields in `src/config.ts`; do not add an environment-variable
parser for normal policy. Runtime secrets remain bindings only. The Magento
module uses a declarative, concurrency-safe purge queue; do not reintroduce a
generic operational table, imperative schema patch, or partial deployment/VCL/AI
workflow.

## Changes

1. Read `architecture.md`, `plan-v3.md`, and `tasks.md` first.
2. Add/refine the relevant task row before changing code.
3. Keep request normalization, bypass, key construction, origin construction,
   cache policy, and purge parsing independently testable and storage-free.
4. Plugins must declare `needsBody`. Body-dependent behavior belongs on a
   Storefront miss; it cannot run on a native hit.
5. Update the generated configuration contract, README, architecture, and this
   guide whenever a structural or protocol decision changes.
6. Mark only locally verified work complete. Keep remote cache, purge,
   multi-region, and production validation explicitly outstanding.

## Validation

Run `npm run check`, `npm run types`, and a Wrangler configuration validation
after structural changes. Local Wrangler does not substitute for native Workers
Caching acceptance: stage warm hits, stale windows, concurrent misses, private
traffic, and entrypoint-scoped purges before production routing.
