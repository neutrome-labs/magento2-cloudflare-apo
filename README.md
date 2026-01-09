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

```bash
# Install dependencies
npm install

# Create project
make create-project name=PROJECT_NAME

# Edit PROJECT_NAME/wrangler.jsonc and PROJECT_NAME/.dev.vars with your settings

# Start local dev server (both ORIGIN_HOST and REPLACE_ORIGIN_LINKS MUST be set)
make dev name=PROJECT_NAME 

# Deploy to Cloudflare
make deploy name=PROJECT_NAME
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
See [.dev.vars.example](.dev.vars.example) for complete reference.

## Commands

| Command | Description |
|---------|-------------|
| `make create-project name=PROJECT_NAME` | Create new project scaffold |
| `make dev name=PROJECT_NAME` | Start local dev server for project |
| `make deploy name=PROJECT_NAME` | Deploy project to Cloudflare |
| `npm run dev` | Start local development server |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run check` | TypeScript type check |
| `npm run types` | Regenerate Env types |
| `npm run kv:list` | List KV namespaces |
| `npm run tail` | Stream live logs |

## Cache Purging

Send a POST request with the purge secret:

```bash
# Purge a single page by its URL
curl -X POST "https://your-domain.com/any-path" \
  -H "X-Purge-Secret: YOUR_SECRET" 

# Flush all
curl -X POST "https://your-domain.com/__purge" \
  -H "X-Purge-Secret: YOUR_SECRET"
  -H "X-Purge-All: true"
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
cp .dev.vars.example PROJECT_NAME/.dev.vars

# Edit .dev.vars with your settings
# Start dev server
make dev name=PROJECT_NAME
```

## License

MIT
