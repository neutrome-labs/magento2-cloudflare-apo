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
├── purge.ts      # Cache purge endpoint handling
└── plugins/      # Extensible plugin system
    ├── index.ts           # Plugin exports
    ├── types.ts           # Plugin interface definitions
    ├── runtime.ts         # Plugin manager implementation
    ├── registry.ts        # Plugin registration (edit to add custom plugins)
    ├── debug-headers.ts   # Debug headers (X-FPC-Cache, X-APO-Claims)
    ├── origin-links.ts    # Origin link replacement in responses
    └── merged-css-guard.ts # Merged CSS asset validation
```

## Plugin System

Plugins provide extensibility without modifying core code. Each plugin can hook into:
- `onRequest` - Early bypass/short-circuit
- `transformCacheKey` - Modify cache key
- `transformOriginRequest` - Modify request to origin
- `validateCacheHit` - Validate cached records before serving
- `shouldCache` - Decide if origin response should be cached
- `transformResponse` - Modify final response

### Built-in Plugins

| Plugin | Enable Flag | Purpose |
|--------|-------------|---------|
| `debug-headers` | `DEBUG=true` | Adds X-FPC-Cache, X-Magento-Cache-Debug headers |
| `cache-claims` | `RETURN_CLAIMS=true` | Adds X-APO-Claims header with request details |
| `origin-links` | `REPLACE_ORIGIN_LINKS=true` | Replaces ORIGIN_HOST in responses |
| `merged-css-guard` | `DETECT_MERGED_STYLES_CHANGE=true` | Validates merged CSS assets exist |

### Adding Custom Plugins

1. Create plugin file in `src/plugins/` implementing `Plugin` interface
2. Import and add to `PLUGINS` array in `src/plugins/registry.ts`
3. Plugins run in array order

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
- `types.ts` - Imports `plugins/types` for PluginManager
- `config.ts` - Depends on `types`
- `context.ts` - Depends on `types`, `plugins/types`
- `response.ts` - Depends on `types`
- `cache.ts` - Depends on `types`, `response`
- `origin.ts` - Depends on `types`, `config`, `cache`
- `purge.ts` - Depends on `types`, `context`
- `plugins/*` - Depend on `types`, `config` (never on other core modules except via Context)
- `index.ts` - Orchestrates all modules including plugins

## Important Files

| File | Purpose |
|------|---------|
| `wrangler.json` | Cloudflare Worker configuration |
| `worker-configuration.d.ts` | **GENERATED** - Env interface, regenerate with `npm run types` |
| `.dev.vars.example` | All available environment variables with defaults |
| `tsconfig.json` | TypeScript configuration |

> ⚠️ **Do not manually edit `worker-configuration.d.ts`** - it is auto-generated from `wrangler.json` by running `npm run types` (alias for `wrangler types`). When adding new environment variables, add them to `wrangler.json` and regenerate.

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
- `RETURN_CLAIMS` - Output X-APO-Claims header with request claims
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
