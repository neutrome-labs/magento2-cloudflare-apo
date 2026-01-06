# AI Agents Instructions

This file provides guidance for AI coding assistants (GitHub Copilot, Claude, Cursor, etc.) working on this codebase.

## Project Overview

Cloudflare Worker implementing Full Page Cache (FPC) for Magento 2 stores using KV storage and stale-while-revalidate strategy.

## Architecture

```
src/
├── index.ts      # Entry point - fetch handler orchestration
├── types.ts      # Shared TypeScript interfaces
├── config.ts     # Environment parsing, defaults, debugLog
├── context.ts    # Request analysis, URL normalization, cache key computation
├── cache.ts      # KV operations (read/write), cached response building
├── origin.ts     # Origin fetching, cacheability decisions
├── response.ts   # Response finalization, header sanitization
└── purge.ts      # Cache purge endpoint handling
```

## Key Patterns

### Configuration Flow
```
Env (strings from wrangler.json/secrets) → buildConfig() → Config (typed runtime values)
```

### Request Flow
```
Request → createContext() → shouldBypass() → computeCacheKey() → cache check → origin fetch → finalizeResponse()
```

### Module Dependencies
- `types.ts` - No dependencies (pure types)
- `config.ts` - Depends on `types`
- `context.ts` - Depends on `types`
- `response.ts` - Depends on `types`
- `cache.ts` - Depends on `types`, `response`
- `origin.ts` - Depends on `types`, `config`, `cache`
- `purge.ts` - Depends on `types`
- `index.ts` - Orchestrates all modules

## Important Files

| File | Purpose |
|------|---------|
| `wrangler.json` | Cloudflare Worker configuration |
| `worker-configuration.d.ts` | Env interface (`wrangler types`) |
| `.dev.vars.example` | All available environment variables with defaults |
| `tsconfig.json` | TypeScript configuration |

## Code Guidelines

1. **Types**: All interfaces in `types.ts`, keep modules focused
2. **Config**: Defaults in `config.ts` DEFAULTS object, env overrides via `buildConfig()`
3. **No circular imports**: Follow dependency hierarchy above
4. **Pure functions**: Prefer stateless functions, pass context explicitly
5. **Error handling**: Let errors bubble up to main handler

## Environment Variables

All config is overridable via environment. See `.dev.vars.example` for complete list with defaults.

Key variables:
- `PURGE_SECRET` - Required secret for cache purge endpoint
- `DEBUG` - Enable console logging
- `DEFAULT_TTL` - Cache TTL in seconds
- `EXCLUDED_PATHS` - JSON array of paths to bypass

## Commands

```bash
npm run dev      # Local development server
npm run deploy   # Deploy to Cloudflare
npm run check    # TypeScript type check
npm run types    # Regenerate Env types from wrangler.json
```

## When Making Changes

> **Important**: When modifying code structure, adding new modules, or changing configuration options, please update this AGENTS.md file and README.md accordingly.

### Checklist for structural changes:
- [ ] Update Architecture section if adding/removing modules
- [ ] Update Module Dependencies if imports change
- [ ] Update `.dev.vars.example` if adding env variables
- [ ] Update README.md Environment Variables table
- [ ] Run `npm run check` to verify types
