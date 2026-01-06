# Cloudflare Worker FPC for Magento 2

A Cloudflare Worker implementing Full Page Cache (FPC) for Magento 2 stores. Uses Cloudflare KV for storage and implements stale-while-revalidate for optimal performance.

## Features

- **Stale-While-Revalidate** - Serves stale content while fetching fresh version in background
- **Smart Cache Bypass** - Automatic bypass for logged-in users, checkout, admin paths
- **GraphQL Support** - Caches GraphQL responses with X-Magento-Cache-Id variation
- **Secure Purging** - Protected endpoint for cache invalidation
- **Debug Headers** - `X-FPC-Cache` (HIT/MISS/STALE/UNCACHEABLE) for easy debugging
- **Fully Configurable** - All settings overridable via environment variables

## Quick Start

### Prerequisites

- Node.js >= 18
- Cloudflare account with a configured domain

### Setup

```bash
# Install dependencies
npm install

# Login to Cloudflare
npx wrangler login

# Set purge secret
npx wrangler secret put PURGE_SECRET

# Deploy
npm run deploy
```

### Configure Routes

Edit `wrangler.json` to add your domain:

```json
{
  "routes": [
    { "pattern": "example.com/*", "zone_name": "example.com" }
  ]
}
```

## Project Structure

```
src/
├── index.ts      # Entry point - fetch handler
├── types.ts      # TypeScript interfaces
├── config.ts     # Environment parsing & defaults
├── context.ts    # Request analysis & cache keys
├── cache.ts      # KV storage operations
├── origin.ts     # Origin fetching logic
├── response.ts   # Response formatting
└── purge.ts      # Cache purge handling
```

## Configuration

All settings have sensible defaults and can be overridden via environment variables.

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PURGE_SECRET` | string | - | **Required.** Secret for purge endpoint |
| `DEBUG` | boolean | `false` | Enable debug logging |
| `DEFAULT_TTL` | number | `86400` | Cache TTL in seconds (24h) |
| `GRACE_SECONDS` | number | `259200` | Stale grace period (72h) |
| `HIT_FOR_PASS_SECONDS` | number | `120` | Uncacheable marker TTL |
| `RESPECT_CACHE_CONTROL` | boolean | `false` | Honor origin Cache-Control |
| `CACHE_LOGGED_IN` | boolean | `true` | Cache with X-Magento-Vary |
| `GRAPHQL_PATH` | string | `/graphql` | GraphQL endpoint path |
| `EXCLUDED_PATHS` | JSON array | See below | Paths to bypass cache |
| `MARKETING_PARAMS` | JSON array | See below | URL params to strip |
| `VARY_COOKIES` | JSON array | `["X-Magento-Vary"]` | Cookies for cache variation |

### Default Excluded Paths

```json
["/admin", "/customer", "/section/load", "/checkout", "/wishlist", "/cart", "/sales", "/rest/", "/onestepcheckout", "/password"]
```

### Default Marketing Params (stripped from URLs)

```json
["gclid", "cx", "ie", "cof", "siteurl", "zanpid", "origin", "fbclid", "mc_*", "utm_*", "_bta_*"]
```

See [.dev.vars.example](.dev.vars.example) for complete reference.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local development server |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run check` | TypeScript type check |
| `npm run types` | Regenerate Env types |
| `npm run kv:list` | List KV namespaces |
| `npm run tail` | Stream live logs |

## Cache Purging

Send a POST request with the purge secret:

```bash
# Purge by cache key header
curl -X POST "https://your-domain.com/any-path" \
  -H "X-Purge-Secret: YOUR_SECRET" \
  -H "X-Cache-Key: fpc:your-domain.com/path"

# Purge multiple keys via body
curl -X POST "https://your-domain.com/any-path" \
  -H "X-Purge-Secret: YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"keys": ["fpc:domain.com/page1", "fpc:domain.com/page2"]}'
```

## Response Headers

| Header | Values | Description |
|--------|--------|-------------|
| `X-FPC-Cache` | `HIT`, `MISS`, `STALE`, `UNCACHEABLE` | Cache status |
| `X-FPC-Grace` | `normal` | Present when serving stale |
| `X-Magento-Cache-Debug` | `HIT`, `MISS`, etc. | Magento compatibility |

## Local Development

```bash
# Copy example env file
cp .dev.vars.example .dev.vars

# Edit .dev.vars with your settings
# Start dev server
npm run dev
```

## License

MIT
