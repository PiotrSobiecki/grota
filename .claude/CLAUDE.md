# grota

Monorepo: TanStack Start + Hono API on Cloudflare Workers. pnpm.

## Packages

| Package | Purpose |
|---------|---------|
| `packages/data-ops` | Shared DB layer (Drizzle, Zod, Better Auth) |
| `apps/data-service` | REST API (Hono on CF Workers) |
| `apps/user-application` | SSR Frontend (TanStack Start on CF Workers) |

## Verification

Lint auto-runs via PostToolUse hook on Edit/Write (biome check --write).

## Commands

```bash
pnpm run setup                    # install + build data-ops
pnpm run dev:user-application     # frontend dev (port 3000)
pnpm run dev:data-service         # API dev (port 8788)
pnpm run deploy:{staging,production}:{user-application,data-service}
pnpm run seed:{dev,staging,production}
pnpm run lint                     # check all (formatting + linting)
pnpm run lint:fix                 # auto-fix all
```

## Conventions

- `/docs` = single source of truth for requirements; reviews/audits go inline in the doc
- Max 500 lines per source file
- Handlers → Services → Queries separation
- Biome config: `biome.json`. GritQL plugins: `plugins/*.grit`
