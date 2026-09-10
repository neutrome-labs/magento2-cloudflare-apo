# v3 native Workers Cache refactor

Scope: replace the KV full-page-cache engine with a cache-disabled gateway and a
cache-enabled `Storefront` entrypoint. This is a clean pre-launch rewrite; KV,
legacy environment aliases, and serialized response records are removed.

- [x] Define the generated `ProjectConfig` contract and validate it at module load.
- [x] Extract storage-independent request normalization, bypass, variants, and origin construction.
- [x] Implement the cache-disabled gateway and cache-enabled loopback `Storefront` entrypoint.
- [x] Implement cacheable response, bounded Vary/tag, response filtering, and native stale policy.
- [x] Implement signed, isolate-local replay protection and native entrypoint-scoped purge with bounded retries.
- [x] Replace the plugin contract with gateway, miss, response, tag, and purge phases.
- [x] Add bounded structured events for bypasses, Storefront misses, native cache status, and purge outcomes.
- [x] Remove KV page cache, legacy configuration aliases, commands, and obsolete source files.
- [x] Update Wrangler, generated types, example configuration, architecture, README, and agent guide.
- [x] Add and run policy tests, type checks, and local Wrangler validation.
- [ ] Capture the v2 baseline and replay the complete acceptance corpus in staging from multiple regions.
- [ ] Have the Magento module generate the production `ProjectConfig` artifact and send signed purge payloads.
- [ ] Deploy the version-isolated Worker, observe native cache/origin/purge metrics, then delete the remote KV namespace after the observation window.

# Magento module delivery

Scope: implement the internal `MerchantDuo_CloudflareApo` Magento module under
`magento/MerchantDuo/CloudflareApo`. The current module owns effective
configuration, deterministic Worker artifacts, and queued signed purge requests.
Worker deployment and its Magento admin actions are the next module phase.
VCL/rule analysis, AI proposals, and a separate operations product are out of
scope.

- [x] Replace the companion-module plan with Magento-owned Worker build, deployment, diagnostics, and cache operations. (Plan only; implementation remains outstanding.)

- [x] Add separate Prettier commands for Worker/repository code and Magento module code. (Locally verified with Prettier's dry-run check.)

- [x] Add the Composer package, Magento registration, module configuration, ACL, schema, and initial service wiring.
- [x] Implement typed settings, deterministic v3 ProjectConfig generation, canonical JSON, hashing, and isolated build reports.
- [ ] Add encrypted Cloudflare API token/account/Worker settings, deploy-mode selection, and connection diagnostics.
- [ ] Add redacted Cloudflare request logging and opt-in response debugging.
- [ ] Package the Worker source and implement the supported isolated local Node.js build.
- [ ] Implement Worker version upload, secret update, activation, verification, status, and rollback.
- [x] Implement a declarative, concurrency-safe purge queue with bounded retry/failure states.
- [x] Implement Magento cache-clean observation, normalized tag queueing, signed purge delivery, retries, cron, and CLI commands.
- [x] Add configuration ACL plus CLI/cron service wiring.
- [ ] Add queued admin build/deploy/update/rollback actions and a Cache Management full-purge action.
- [x] Lint every PHP source and validate XML/JSON configuration.
- [x] Document the Worker and Magento module boundaries, configuration, and operational status. (Locally verified against the Worker and module contracts.)
- [ ] Run Magento setup:upgrade, DI compilation, integration tests, and operational UI tests in a real Magento installation.
- [x] Replace prototype operational persistence with a declarative, concurrency-safe purge queue; honor the enabled setting; and remove incomplete deployment, VCL, AI, and empty admin surfaces. (Tests explicitly deferred by operator.)
