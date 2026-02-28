# 001: Bootstrap & Cleanup

## Goal

Strip the `saas-on-cf` template demo code, rename everything to Grota, remove i18n overhead, add required environment variables, and rebrand the landing page -- establishing a clean foundation for all subsequent features.

## Prerequisites

None. This is the first design doc.

## Scope

### IN

- Remove `client/` domain from data-ops (table, schema, queries, barrel, package.json export)
- Remove client handlers and services from data-service
- Remove all demo dashboard routes (api/, binding/, direct/ CRUD demo pages) from user-application
- Rename worker names in both `wrangler.jsonc` files: `saas-on-cf-*` to `grota-*`
- Update service binding references to match new worker names
- Remove i18n infrastructure (PL-only decision -- resolves **C5**)
- Add all required environment variables to spec (resolves **C7**)
- Rebrand landing page: title, hero text, meta tags to "Grota"
- Keep health domain in data-ops (useful for monitoring)
- Keep auth infrastructure (Better Auth email/password for operator)

### OUT

- New database tables (doc 002+)
- New API endpoints (doc 002+)
- Google OAuth setup (doc 004)
- Any new pages beyond landing/signin/dashboard shell

## Decisions

| Blocker | Decision |
|---------|----------|
| **C5** (i18n strategy) | **PL-only for MVP.** Remove `use-intl`, locale files, i18n middleware, locale URL prefix logic. All UI strings are hardcoded Polish. This eliminates `i18n/` directory, locale JSON files, `IntlProvider`, and locale-aware routing. |
| **C6** (worker names) | Rename `saas-on-cf-ds-*` to `grota-ds-*` and `saas-on-cf-ua-*` to `grota-ua-*` across all envs. |
| **C7** (env vars) | Add `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ENCRYPTION_KEY` to env var spec. Actual values set later, but type declarations and `.env.example` updated now. |

## Data Model Changes

No new tables. **Remove** the `clients` table entirely.

### Delete files

```
packages/data-ops/src/client/          # entire directory
  table.ts
  schema.ts
  queries.ts
  index.ts
```

### Update `packages/data-ops/package.json`

Remove the `"./client"` export:

```jsonc
{
  "exports": {
    // REMOVE this entry:
    // "./client": {
    //   "types": "./dist/client/index.d.ts",
    //   "default": "./dist/client/index.js"
    // },
    "./health": {
      "types": "./dist/health/index.d.ts",
      "default": "./dist/health/index.js"
    },
    "./auth/*": {
      "types": "./dist/auth/*.d.ts",
      "default": "./dist/auth/*.js"
    },
    "./database/*": {
      "types": "./dist/database/*.d.ts",
      "default": "./dist/database/*.js"
    },
    "./drizzle/*": {
      "types": "./dist/drizzle/*.d.ts",
      "default": "./dist/drizzle/*.js"
    }
  }
}
```

### Update `packages/data-ops/src/drizzle/relations.ts`

File currently contains only a commented-out import. Keep the file but ensure no references to `clients`:

```ts
// Reserved for cross-domain relation definitions.
// Added when doc 002+ introduces tables with foreign keys.
```

### Generate migration

After deleting the `clients` table definition, the table still exists in the database. Generate and run a migration to drop it:

```bash
pnpm --filter @repo/data-ops drizzle:dev:generate
pnpm --filter @repo/data-ops drizzle:dev:migrate
```

## API Endpoints

### Remove

Delete these files from `apps/data-service/src/hono/`:

| File | Content |
|------|---------|
| `handlers/client-handlers.ts` | Client CRUD route handlers |
| `services/client-service.ts` | Client business logic |

### Update `apps/data-service/src/hono/app.ts`

Remove the client route registration:

```ts
import { Hono } from "hono";
// REMOVE: import clients from "./handlers/client-handlers";
import health from "./handlers/health-handlers";
import { createCorsMiddleware } from "./middleware/cors";
import { onErrorHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";

export const App = new Hono<{ Bindings: Env }>();

App.use("*", requestId());
App.onError(onErrorHandler);
App.use("*", createCorsMiddleware());

App.route("/health", health);
// REMOVE: App.route("/clients", clients);
```

### Remaining endpoints (unchanged)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health/live` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe (checks DB) |

## UI Pages & Components

### Remove

Delete these directories and files from `apps/user-application/src/`:

**Demo dashboard routes:**
```
routes/_auth/dashboard/api/         # entire directory (7 files)
routes/_auth/dashboard/binding/     # entire directory (7 files)
routes/_auth/dashboard/direct/      # entire directory (7 files)
routes/_auth/dashboard/index.tsx    # demo index with tabs
```

**Demo server functions:**
```
core/functions/clients/             # entire directory
  binding.ts
  direct.ts
core/functions/example-functions.ts
core/middleware/example-middleware.ts
```

**i18n infrastructure (if present):**
```
i18n/                               # entire directory (if exists)
  core/
  messages/
```

**FAQ components and routes (template demo):**
```
routes/faq/                         # if exists
components/faq/                     # if exists
```

### Update

**`routes/_auth/dashboard/route.tsx`** -- replace demo layout with empty deployment dashboard shell:

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <div className="space-y-6">
      <Outlet />
    </div>
  );
}
```

**`routes/_auth/dashboard/index.tsx`** -- create a minimal placeholder:

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/dashboard/")({
  component: DashboardIndex,
});

function DashboardIndex() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Panel operatora</h1>
      <p className="text-muted-foreground">
        Brak wdrozen. Utworz nowe wdrozenie aby rozpoczac.
      </p>
    </div>
  );
}
```

**`routes/__root.tsx`** -- update meta tags:

```tsx
...seo({
  title: "Grota | Google Reorganize, Onboard, Transfer, Archive",
  description: "Portal onboardingu klientow - reorganizacja dostepu Google, backup i archiwizacja.",
}),
```

**`routes/index.tsx`** (landing page) -- update hero text:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { FeaturesSection } from "@/components/landing/features-section";
import { Footer } from "@/components/landing/footer";
import { HeroSection } from "@/components/landing/hero-section";
import { NavigationBar } from "@/components/navigation";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <NavigationBar />
      <main>
        <HeroSection />
        <FeaturesSection />
      </main>
      <Footer />
    </div>
  );
}
```

Update `components/landing/hero-section.tsx` -- change title to "Grota" and subtitle to describe the tool in Polish:

```tsx
// Key changes (exact component structure depends on existing file):
// Title: "Grota"
// Subtitle: "Google Reorganize, Onboard, Transfer, Archive"
// Description: "Portal onboardingu klientow - reorganizacja dostepu,
//   backup dokumentow i mediow z prywatnych kont Google."
```

**`components/landing/features-section.tsx`** -- update feature cards to reflect Grota capabilities:

1. "Onboarding klientow" -- Wizard krok po kroku: dane firmy, OAuth, lista pracownikow
2. "Backup 3-2-1" -- Serwer lokalny + Backblaze B2, szyfrowanie AES-256
3. "Reorganizacja dostepu" -- Google Groups, Shared Drives, uprawnienia

**`components/navigation/navigation-bar.tsx`** -- replace brand name with "Grota".

### Regenerate route tree

After adding/removing route files:

```bash
cd apps/user-application && npx @tanstack/router-cli generate
```

This also happens automatically during `pnpm run dev` and `pnpm run build`.

## Wrangler Configuration Changes

### `apps/data-service/wrangler.jsonc`

```jsonc
{
  "name": "grota-ds",
  // ...
  "env": {
    "dev": {
      "name": "grota-ds-dev"
    },
    "staging": {
      "name": "grota-ds-staging"
    },
    "production": {
      "name": "grota-ds-production"
    }
  }
}
```

### `apps/user-application/wrangler.jsonc`

```jsonc
{
  "name": "grota-ua",
  // ...
  "services": [
    {
      "binding": "DATA_SERVICE",
      "service": "grota-ds-dev"
    }
  ],
  "env": {
    "dev": {
      "name": "grota-ua-dev",
      "services": [
        {
          "binding": "DATA_SERVICE",
          "service": "grota-ds-dev"
        }
      ]
    },
    "staging": {
      "name": "grota-ua-staging",
      "services": [
        {
          "binding": "DATA_SERVICE",
          "service": "grota-ds-staging"
        }
      ]
    },
    "production": {
      "name": "grota-ua-production",
      "services": [
        {
          "binding": "DATA_SERVICE",
          "service": "grota-ds-production"
        }
      ]
    }
  }
}
```

## Environment Variables

### New variables (values set in `.dev.vars` / `.env` per environment)

| Variable | Package | Purpose | Required from |
|----------|---------|---------|---------------|
| `RESEND_API_KEY` | data-service | Send transactional emails (magic links, summaries) | Doc 003 |
| `GOOGLE_CLIENT_ID` | user-application | Google OAuth consent screen | Doc 004 |
| `GOOGLE_CLIENT_SECRET` | data-service | Google OAuth token exchange | Doc 004 |
| `TELEGRAM_BOT_TOKEN` | data-service | Telegram Bot API notifications | Doc 006 |
| `TELEGRAM_CHAT_ID` | data-service | Telegram chat target for alerts | Doc 006 |
| `ENCRYPTION_KEY` | data-service | AES-256-GCM key for token encryption (base64-encoded 32 bytes) | Doc 004 |

### Existing variables (unchanged)

| Variable | Package | Purpose |
|----------|---------|---------|
| `DATABASE_HOST` | both | Neon Postgres connection |
| `DATABASE_USERNAME` | both | Neon Postgres auth |
| `DATABASE_PASSWORD` | both | Neon Postgres auth |
| `API_TOKEN` | data-service | Bearer token for protected endpoints |
| `BETTER_AUTH_SECRET` | user-application | Session encryption |
| `BETTER_AUTH_BASE_URL` | user-application | Auth callback base URL |
| `CLOUDFLARE_ENV` | both | Environment selector |
| `ALLOWED_ORIGINS` | data-service | CORS origins |
| `VITE_DATA_SERVICE_URL` | user-application | Public API URL (client-side) |
| `VITE_API_TOKEN` | user-application | Client-side API auth |

### `.env.example` update

Create or update `.env.example` files in each app with placeholder values for all variables. These files are committed to git as documentation.

### `worker-configuration.d.ts` update

After adding new env vars, regenerate types:

```bash
cd apps/data-service && pnpm cf-typegen
cd apps/user-application && pnpm cf-typegen
```

## Implementation Steps

1. **Delete demo data-ops domain**
   - Remove `packages/data-ops/src/client/` directory
   - Remove `"./client"` export from `packages/data-ops/package.json`
   - Update `packages/data-ops/src/drizzle/relations.ts` (clear commented code)
   - Generate and run migration to drop `clients` table
   - Rebuild data-ops: `pnpm --filter @repo/data-ops build`

2. **Delete demo data-service code**
   - Remove `apps/data-service/src/hono/handlers/client-handlers.ts`
   - Remove `apps/data-service/src/hono/services/client-service.ts`
   - Update `apps/data-service/src/hono/app.ts` to remove client route

3. **Delete demo user-application code**
   - Remove `routes/_auth/dashboard/api/` directory
   - Remove `routes/_auth/dashboard/binding/` directory
   - Remove `routes/_auth/dashboard/direct/` directory
   - Remove `core/functions/clients/` directory
   - Remove `core/functions/example-functions.ts`
   - Remove `core/middleware/example-middleware.ts`
   - Remove FAQ routes and components if they exist

4. **Remove i18n infrastructure**
   - Remove `i18n/` directory if it exists
   - Remove `use-intl` dependency from `package.json` if present
   - Remove locale-related imports from `__root.tsx` and route files
   - Remove locale prefix routing logic
   - Hardcode all UI strings in Polish

5. **Rename workers**
   - Update `apps/data-service/wrangler.jsonc` (all `saas-on-cf-ds` to `grota-ds`)
   - Update `apps/user-application/wrangler.jsonc` (all `saas-on-cf-ua` to `grota-ua`, all service binding references to `grota-ds-*`)

6. **Rebrand landing page**
   - Update `__root.tsx` meta tags (title, description)
   - Update `hero-section.tsx` (title: "Grota", Polish description)
   - Update `features-section.tsx` (Grota-relevant features)
   - Update `navigation-bar.tsx` (brand name)
   - Update `footer.tsx` (brand name)

7. **Create placeholder dashboard**
   - Rewrite `routes/_auth/dashboard/route.tsx` (clean layout)
   - Create `routes/_auth/dashboard/index.tsx` (empty state placeholder)

8. **Update environment variable spec**
   - Create/update `.env.example` files in both apps
   - Regenerate `worker-configuration.d.ts` in both apps
   - Ensure all new variables have placeholder entries

9. **Regenerate route tree and lint**
   - Run `cd apps/user-application && npx @tanstack/router-cli generate`
   - Run `pnpm run lint:fix` to clean up formatting
   - Run `pnpm run lint` to verify no issues remain

10. **Verify build**
    - Run `pnpm run setup` (install + build data-ops)
    - Run `pnpm run dev:data-service` -- confirm starts on port 8788
    - Run `pnpm run dev:user-application` -- confirm starts on port 3000

## Manual Test Script

1. Run `pnpm run setup` -- should complete without errors
2. Run `pnpm run dev:data-service` in one terminal
3. Open `http://localhost:8788/health/live` -- should return `{"status":"ok","time":"..."}`
4. Open `http://localhost:8788/health/ready` -- should return `{"status":"ok",...,"database":"connected"}`
5. Open `http://localhost:8788/clients` -- should return 404 (route removed)
6. Run `pnpm run dev:user-application` in another terminal
7. Open `http://localhost:3000/` -- should show landing page with "Grota" title and Polish text
8. Click "Zaloguj sie" (or navigate to `/signin`)
9. Sign in with operator credentials (email/password)
10. After sign-in, should redirect to `/_auth/dashboard/`
11. Dashboard should show "Panel operatora" heading with empty state message
12. No references to "TanStack", "saas-on-cf", or demo CRUD should be visible anywhere
13. Browser page title should show "Grota | Google Reorganize, Onboard, Transfer, Archive"
