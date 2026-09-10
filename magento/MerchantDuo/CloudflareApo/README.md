# MerchantDuo Cloudflare APO

This Magento module owns website-scoped Worker configuration, deterministic Worker build artifacts, and signed queued full-page-cache invalidation for the v3 Worker shipped at the Composer package root (`src/`).

## Configuration

Configure **Stores > Configuration > Services > Cloudflare APO v3** per website. The Cloudflare API token is encrypted by Magento and is distinct from the Worker purge-signing secret. Use a scoped token; Global API keys are deliberately unsupported. `Cloudflare Workers Builds` is displayed only as a future mode and cannot be used.

Cloudflare API activity is written to `var/log/cloudflare_apo.log` only when request logging is enabled. Response logging is disabled by default and has a bounded, redacted body.

## Operations

The local build is CLI-only and runs in an isolated directory below `var/merchantduo-cloudflare-apo/build`. It copies the pinned package-root Worker source, installs exactly `package-lock.json`, type-checks it, and performs a Wrangler dry-run. No Node.js command runs during an Admin HTTP request.

```bash
bin/magento cloudflare-apo:worker:build
bin/magento cloudflare-apo:worker:connection
bin/magento cloudflare-apo:worker:deploy --website=<id>
bin/magento cloudflare-apo:worker:rollback --website=<id>
bin/magento cloudflare-apo:cache:purge
```

Worker-management actions in Admin are form-key protected and enqueue an operation for cron. CLI deploy and rollback run the same operation service synchronously. Purge delivery is queued and sent by cron; it never sends the purge body or signing secret to module logs. The deployment record table is intentionally metadata-only and must not contain Worker bundles, tokens, or secrets.

Schema and DI configuration changes require `setup:upgrade`; production deployments should perform their normal DI compilation pipeline.
