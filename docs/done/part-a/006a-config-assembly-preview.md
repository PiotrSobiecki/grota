# 006a: Config Assembly & Preview

## Goal

Create the config domain in data-ops (assembly query + JSON schema), add R2 bucket binding to data-service, implement the config preview endpoint, and build the operator config preview page -- allowing the operator to inspect the assembled config JSON before export.

## Prerequisites

- Doc 001 (Bootstrap & Cleanup)
- Doc 002a/b (Operator Deployment CRUD)
- Doc 003a/b (Client Onboarding Wizard)
- Doc 004a/b (Google OAuth & Encryption)
- Doc 005a/b (Employee Folder Selection)

## Scope

### IN

- Config JSON assembly: join deployments + employees + folder_selections, decrypt OAuth tokens
- Zod schema for the config JSON shape
- Config domain package export in data-ops
- R2 bucket binding in data-service `wrangler.jsonc` (needed for 006b, but binding + typegen done here)
- Config preview endpoint: `GET /config/preview/:deploymentId`
- Config service: `buildConfigJson` + `previewConfig` functions
- Config handlers + route registration in `app.ts`
- Operator config preview page: `/_auth/dashboard/$id/config` (preview + summary cards only)
- Security notice about plaintext tokens in R2 (resolves **B10**)
- Link from deployment detail page to config page (when status is `ready` or `active`)

### OUT

- R2 upload / export endpoint (doc 006b)
- Export UI / button (doc 006b)
- Re-export flow (doc 006b)
- Deployment status transition `ready` -> `active` (doc 006b)
- Telegram notification (doc 006b)
- Email summary via Resend (doc 006b)
- Server access instructions card (doc 006b -- only relevant after export)
- Server scripts (Phase 2)
- Config versioning (MVP: overwrite on re-export)

## Decisions

| Blocker/Clarification | Decision |
|----------------------|----------|
| **B10** (R2 config JSON security) | **Accept plaintext in R2.** The R2 bucket is operator-controlled (our Cloudflare account). The config contains OAuth refresh tokens which are revocable. If a token is compromised, the user revokes it via Google Account settings and re-authorizes. A note is added to the operator config page. |

## Data Model Changes

No new tables. Uses existing schema from previous docs.

### New file: `packages/data-ops/src/config/queries.ts`

Assembly query that joins all data needed for the config JSON:

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import { deployments } from "../deployment/table";
import { employees } from "../employee/table";
import { folderSelections } from "../folder-selection/table";

export interface ConfigAssemblyData {
  deployment: {
    id: string;
    clientName: string;
    domain: string;
    workspaceOauthToken: string | null;
    b2Config: unknown;
    serverConfig: unknown;
    adminEmail: string | null;
    createdAt: Date;
  };
  accounts: Array<{
    id: string;
    email: string;
    name: string;
    role: string;
    driveOauthToken: string | null;
    folders: Array<{
      folderId: string;
      folderName: string;
      category: string;
    }>;
  }>;
}

export async function getConfigAssemblyData(
  deploymentId: string,
): Promise<ConfigAssemblyData | null> {
  const db = getDb();

  // 1. Get deployment
  const deploymentResult = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId));
  const deployment = deploymentResult[0];
  if (!deployment) return null;

  // 2. Get employees with completed selections
  const employeeList = await db
    .select()
    .from(employees)
    .where(eq(employees.deploymentId, deploymentId));

  // 3. Get folder selections for each employee
  const accounts = await Promise.all(
    employeeList.map(async (emp) => {
      const selections = await db
        .select()
        .from(folderSelections)
        .where(eq(folderSelections.employeeId, emp.id));

      return {
        id: emp.id,
        email: emp.email,
        name: emp.name,
        role: emp.role,
        driveOauthToken: emp.driveOauthToken,
        folders: selections.map((s) => ({
          folderId: s.folderId,
          folderName: s.folderName,
          category: s.category,
        })),
      };
    }),
  );

  return {
    deployment: {
      id: deployment.id,
      clientName: deployment.clientName,
      domain: deployment.domain,
      workspaceOauthToken: deployment.workspaceOauthToken,
      b2Config: deployment.b2Config,
      serverConfig: deployment.serverConfig,
      adminEmail: deployment.adminEmail,
      createdAt: deployment.createdAt,
    },
    accounts,
  };
}
```

### New file: `packages/data-ops/src/config/schema.ts`

```ts
import { z } from "zod";

/** The shape of the config JSON exported to R2. */
export const ConfigJsonSchema = z.object({
  deployment_id: z.string().uuid(),
  client_name: z.string(),
  domain: z.string(),
  created_at: z.string(),
  workspace: z
    .object({
      oauth_refresh_token: z.string(),
    })
    .nullable(),
  accounts: z.array(
    z.object({
      email: z.string(),
      name: z.string(),
      role: z.string(),
      oauth_refresh_token: z.string().nullable(),
      folders: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          category: z.string(),
        }),
      ),
    }),
  ),
  b2: z.unknown().nullable(),
  server: z.unknown().nullable(),
});

export type ConfigJson = z.infer<typeof ConfigJsonSchema>;
```

### New file: `packages/data-ops/src/config/index.ts`

```ts
export { getConfigAssemblyData, type ConfigAssemblyData } from "./queries";
export { ConfigJsonSchema, type ConfigJson } from "./schema";
```

### Update `packages/data-ops/package.json` exports

```jsonc
{
  "exports": {
    "./config": { "types": "./dist/config/index.d.ts", "default": "./dist/config/index.js" },
    // ... existing exports
  }
}
```

Build: `pnpm --filter @repo/data-ops build`

## API Endpoints

### New file: `apps/data-service/src/hono/handlers/config-handlers.ts`

```ts
import { zValidator } from "@hono/zod-validator";
import { EmployeeDeploymentParamSchema } from "@repo/data-ops/employee";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authMiddleware } from "../middleware/auth";
import * as configService from "../services/config-service";
import type { Result } from "../types/result";

function resultToResponse<T>(
  c: Context,
  result: Result<T>,
  successStatus: ContentfulStatusCode = 200,
) {
  if (!result.ok)
    return c.json(
      { error: result.error.message, code: result.error.code },
      result.error.status as ContentfulStatusCode,
    );
  return c.json(result.data, successStatus);
}

const configHandlers = new Hono<{ Bindings: Env }>();

// Preview config JSON (without exporting to R2)
configHandlers.get(
  "/preview/:deploymentId",
  (c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
  zValidator("param", EmployeeDeploymentParamSchema),
  async (c) => {
    const { deploymentId } = c.req.valid("param");
    return resultToResponse(
      c,
      await configService.previewConfig(deploymentId, c.env),
    );
  },
);

export default configHandlers;
```

### New file: `apps/data-service/src/hono/services/config-service.ts`

```ts
import { getConfigAssemblyData, type ConfigJson } from "@repo/data-ops/config";
import { decrypt } from "@repo/data-ops/encryption";
import type { Result } from "../types/result";

/** Build the config JSON from assembly data, decrypting tokens. */
export async function buildConfigJson(
  deploymentId: string,
  encryptionKey: string,
): Promise<Result<ConfigJson>> {
  const data = await getConfigAssemblyData(deploymentId);
  if (!data) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Wdrozenie nie znalezione", status: 404 },
    };
  }

  // Decrypt workspace OAuth token
  let workspaceRefreshToken: string | null = null;
  if (data.deployment.workspaceOauthToken) {
    try {
      const decrypted = await decrypt(
        data.deployment.workspaceOauthToken,
        encryptionKey,
      );
      const parsed = JSON.parse(decrypted) as { refresh_token: string | null };
      workspaceRefreshToken = parsed.refresh_token;
    } catch (err) {
      console.error("Failed to decrypt workspace token:", err);
    }
  }

  // Decrypt employee Drive OAuth tokens
  const accounts = await Promise.all(
    data.accounts.map(async (account) => {
      let refreshToken: string | null = null;
      if (account.driveOauthToken) {
        try {
          const decrypted = await decrypt(account.driveOauthToken, encryptionKey);
          const parsed = JSON.parse(decrypted) as { refresh_token: string | null };
          refreshToken = parsed.refresh_token;
        } catch (err) {
          console.error(`Failed to decrypt token for ${account.email}:`, err);
        }
      }

      return {
        email: account.email,
        name: account.name,
        role: account.role,
        oauth_refresh_token: refreshToken,
        folders: account.folders.map((f) => ({
          id: f.folderId,
          name: f.folderName,
          category: f.category,
        })),
      };
    }),
  );

  const config: ConfigJson = {
    deployment_id: data.deployment.id,
    client_name: data.deployment.clientName,
    domain: data.deployment.domain,
    created_at: data.deployment.createdAt.toISOString(),
    workspace: workspaceRefreshToken
      ? { oauth_refresh_token: workspaceRefreshToken }
      : null,
    accounts,
    b2: data.deployment.b2Config ?? null,
    server: data.deployment.serverConfig ?? null,
  };

  return { ok: true, data: config };
}

/** Preview config without exporting. */
export async function previewConfig(
  deploymentId: string,
  env: Env,
): Promise<Result<ConfigJson>> {
  return buildConfigJson(deploymentId, env.ENCRYPTION_KEY);
}
```

### Update `apps/data-service/src/hono/app.ts`

```ts
import configHandlers from "./handlers/config-handlers";

// Add to route registration:
App.route("/config", configHandlers);
```

### R2 Bucket Binding

Update `apps/data-service/wrangler.jsonc` to add R2 bucket binding in each environment:

```jsonc
{
  "name": "grota-ds",
  // ...
  "env": {
    "dev": {
      "name": "grota-ds-dev",
      "r2_buckets": [
        {
          "binding": "CONFIG_BUCKET",
          "bucket_name": "grota-configs-dev"
        }
      ]
    },
    "staging": {
      "name": "grota-ds-staging",
      "r2_buckets": [
        {
          "binding": "CONFIG_BUCKET",
          "bucket_name": "grota-configs-staging"
        }
      ]
    },
    "production": {
      "name": "grota-ds-production",
      "r2_buckets": [
        {
          "binding": "CONFIG_BUCKET",
          "bucket_name": "grota-configs-production"
        }
      ]
    }
  }
}
```

After updating wrangler.jsonc, regenerate types:

```bash
cd apps/data-service && pnpm cf-typegen
```

This adds `CONFIG_BUCKET: R2Bucket` to the `Env` interface in `worker-configuration.d.ts`.

### Endpoint summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/config/preview/:deploymentId` | Bearer | Preview config JSON (no R2 upload) |

## UI Pages & Components

### New route: `apps/user-application/src/routes/_auth/dashboard/$id/config.tsx`

Preview-only page (export UI added in doc 006b):

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_auth/dashboard/$id/config")({
  component: ConfigPage,
});

function ConfigPage() {
  const { id: deploymentId } = Route.useParams();

  // Fetch config preview
  const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
  const apiToken = import.meta.env.VITE_API_TOKEN;

  const previewQuery = useSuspenseQuery({
    queryKey: ["config-preview", deploymentId],
    queryFn: async () => {
      const response = await fetch(
        `${dataServiceUrl}/config/preview/${deploymentId}`,
        {
          headers: { Authorization: `Bearer ${apiToken}` },
        },
      );
      if (!response.ok) throw new Error("Nie udalo sie pobrac podgladu");
      return response.json();
    },
  });

  const config = previewQuery.data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">
        Konfiguracja eksportu
      </h1>

      {/* Security notice */}
      <Alert>
        <p className="text-sm">
          Plik konfiguracyjny zawiera tokeny OAuth (refresh tokens).
          Tokeny sa przechowywane w postaci jawnej w R2 -- bucket jest
          kontrolowany przez operatora. W razie potrzeby tokeny mozna
          cofnac w ustawieniach Google kazdego uzytkownika.
        </p>
      </Alert>

      {/* Config preview */}
      <Card>
        <CardHeader>
          <CardTitle>Podglad JSON</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded bg-muted p-4 text-xs text-foreground">
            {JSON.stringify(config, null, 2)}
          </pre>
        </CardContent>
      </Card>

      {/* Export summary */}
      <Card>
        <CardHeader>
          <CardTitle>Podsumowanie</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-muted-foreground">
            Klient: {config?.client_name}
          </div>
          <div className="text-sm text-muted-foreground">
            Pracownicy: {config?.accounts?.length ?? 0}
          </div>
          <div className="text-sm text-muted-foreground">
            Foldery (bez prywatnych):{" "}
            {config?.accounts?.reduce(
              (sum: number, a: { folders: Array<{ category: string }> }) =>
                sum + a.folders.filter((f) => f.category !== "prywatne").length,
              0,
            ) ?? 0}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Update deployment detail page

Add a link to the config page on `apps/user-application/src/routes/_auth/dashboard/$id.tsx`:

```tsx
// Add to the detail page when deployment status is 'ready' or 'active':
{(deployment.status === "ready" || deployment.status === "active") && (
  <Button asChild variant="outline">
    <Link to="/dashboard/$id/config" params={{ id: deployment.id }}>
      {deployment.status === "active" ? "Zobacz konfiguracje" : "Eksportuj konfiguracje"}
    </Link>
  </Button>
)}
```

## Implementation Steps

1. **Create config domain in data-ops**
   - Create `packages/data-ops/src/config/` with `queries.ts`, `schema.ts`, `index.ts`
   - Add `"./config"` export to `package.json`
   - Build: `pnpm --filter @repo/data-ops build`

2. **Add R2 binding to data-service wrangler**
   - Update `apps/data-service/wrangler.jsonc` with `CONFIG_BUCKET` binding in all envs
   - Regenerate types: `cd apps/data-service && pnpm cf-typegen`

3. **Create config service and handler in data-service**
   - Create `hono/services/config-service.ts` with `buildConfigJson` + `previewConfig`
   - Create `hono/handlers/config-handlers.ts` with preview endpoint
   - Update `hono/app.ts` with `/config` route

4. **Create config preview page in user-application**
   - Create `routes/_auth/dashboard/$id/config.tsx`
   - Update `routes/_auth/dashboard/$id.tsx` with link to config page

5. **Regenerate and verify**
   - `cd apps/user-application && npx @tanstack/router-cli generate`
   - `pnpm run lint:fix && pnpm run lint`

## Environment Variables

| Variable | Package | Purpose |
|----------|---------|---------|
| `ENCRYPTION_KEY` | data-service | Decrypt tokens for config assembly |

Already spec'd in doc 001, already used in doc 004a.

## Manual Test Script

1. Ensure a deployment exists in "ready" status (all employees completed folder selection from doc 005)
2. Run both dev servers
3. Sign in as operator
4. Navigate to deployment detail page (`/_auth/dashboard/{id}`)
5. Click "Eksportuj konfiguracje" -- should navigate to `/dashboard/{id}/config`
6. **Test preview:**
   - Config JSON should be displayed in the preview panel
   - Verify structure matches the expected format:
     - `deployment_id`, `client_name`, `domain`, `created_at`
     - `workspace.oauth_refresh_token` (if admin authorized)
     - `accounts[]` with `email`, `name`, `role`, `oauth_refresh_token`, `folders[]`
     - `b2` and `server` (null if not configured)
   - Verify OAuth tokens are decrypted (plaintext refresh tokens visible)
   - Verify folder selections match what employees tagged
7. **Test summary card:**
   - Client name, employee count, folder count (excluding "prywatne") should be correct
8. **Test security notice:**
   - Alert about plaintext tokens should be visible
9. **Test error case:**
   - Try navigating to config page for a non-existent deployment -- should show error
10. **Test API directly:**
    - `curl -H "Authorization: Bearer $TOKEN" http://localhost:8788/config/preview/{id}`
    - Should return the config JSON
