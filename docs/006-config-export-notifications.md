# 006: Config Export & Notifications

## Goal

Generate the deployment config JSON, upload it to Cloudflare R2, notify the operator via Telegram, and send an email summary to the client admin -- completing the onboarding flow and transitioning the deployment to "active" status.

## Prerequisites

- Doc 001 (Bootstrap & Cleanup)
- Doc 002 (Operator Deployment CRUD)
- Doc 003 (Client Onboarding Wizard)
- Doc 004 (Google OAuth & Encryption)
- Doc 005 (Employee Folder Selection)

## Scope

### IN

- Config JSON assembly: join deployments + employees + folder_selections, decrypt OAuth tokens
- R2 bucket binding in data-service `wrangler.jsonc`
- Config generation endpoint
- R2 upload to `configs/{deployment_id}/config.json`
- Re-export overwrites existing config (resolves **C2**)
- Telegram notification via Bot API `sendMessage`
- Email summary to client admin via Resend
- Operator config preview page: `/_auth/dashboard/$id/config`
- Deployment status transition: `ready` -> `active` after successful export
- R2 access from server scripts: S3-compatible API with R2 access keys (resolves **C8**)
- Plaintext in R2 -- operator-controlled bucket, tokens are revocable refresh tokens (resolves **B10**)

### OUT

- Server scripts (Phase 2)
- Terraform B2 bucket provisioning (Phase 2)
- Config versioning (MVP: overwrite on re-export)
- Monitoring dashboard (Phase 3)

## Decisions

| Blocker/Clarification | Decision |
|----------------------|----------|
| **B10** (R2 config JSON security) | **Accept plaintext in R2.** The R2 bucket is operator-controlled (our Cloudflare account). The config contains OAuth refresh tokens which are revocable. If a token is compromised, the user revokes it via Google Account settings and re-authorizes. A note is added to the operator config page. |
| **C2** (re-export) | **Re-export overwrites** `configs/{deployment_id}/config.json`. No versioning in MVP. If the operator needs to update (e.g., employee re-authorized), they click "Eksportuj" again. |
| **C8** (server R2 access) | Server scripts access R2 via the **S3-compatible API** using R2 access keys (API token with `Workers R2 Storage:Edit` permission). Endpoint: `https://{account_id}.r2.cloudflarestorage.com`. Documented in the config page for the operator. |

## Data Model Changes

No new tables. Uses existing `r2_config_key` field on deployments to track the R2 object key after export.

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
import { z } from "zod";
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
  zValidator("param", z.object({ deploymentId: z.string().uuid() })),
  async (c) => {
    const { deploymentId } = c.req.valid("param");
    return resultToResponse(
      c,
      await configService.previewConfig(deploymentId, c.env),
    );
  },
);

// Export config JSON to R2 + send notifications
configHandlers.post(
  "/export/:deploymentId",
  (c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
  zValidator("param", z.object({ deploymentId: z.string().uuid() })),
  async (c) => {
    const { deploymentId } = c.req.valid("param");
    return resultToResponse(
      c,
      await configService.exportConfig(deploymentId, c.env),
    );
  },
);

export default configHandlers;
```

### New file: `apps/data-service/src/hono/services/config-service.ts`

```ts
import { getConfigAssemblyData, type ConfigJson } from "@repo/data-ops/config";
import { getDeployment, updateDeploymentStatus } from "@repo/data-ops/deployment";
import { decrypt } from "@repo/data-ops/encryption";
import type { Result } from "../types/result";

/** Build the config JSON from assembly data, decrypting tokens. */
async function buildConfigJson(
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

/** Export config to R2, update status, send notifications. */
export async function exportConfig(
  deploymentId: string,
  env: Env,
): Promise<Result<{ r2Key: string; status: string }>> {
  // 1. Verify deployment is in 'ready' state (or allow re-export from 'active')
  const deployment = await getDeployment(deploymentId);
  if (!deployment) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Wdrozenie nie znalezione", status: 404 },
    };
  }

  if (deployment.status !== "ready" && deployment.status !== "active") {
    return {
      ok: false,
      error: {
        code: "INVALID_STATUS",
        message: `Eksport mozliwy tylko ze statusu 'ready' lub 'active'. Obecny status: ${deployment.status}`,
        status: 400,
      },
    };
  }

  // 2. Build config JSON
  const configResult = await buildConfigJson(deploymentId, env.ENCRYPTION_KEY);
  if (!configResult.ok) return configResult;

  // 3. Upload to R2
  const r2Key = `configs/${deploymentId}/config.json`;
  const configJson = JSON.stringify(configResult.data, null, 2);

  await env.CONFIG_BUCKET.put(r2Key, configJson, {
    httpMetadata: { contentType: "application/json" },
  });

  // 4. Update deployment: set r2_config_key and status to 'active'
  const { getDb } = await import("@repo/data-ops/database/setup");
  const { eq } = await import("drizzle-orm");
  const { deployments } = await import("@repo/data-ops/deployment");
  const db = getDb();
  await db
    .update(deployments)
    .set({ r2ConfigKey: r2Key })
    .where(eq(deployments.id, deploymentId));

  if (deployment.status === "ready") {
    await updateDeploymentStatus(deploymentId, "active");
  }

  // 5. Send Telegram notification (non-blocking)
  sendTelegramNotification(deployment.clientName, deploymentId, env).catch(
    (err) => console.error("Telegram notification failed:", err),
  );

  // 6. Send email summary to client admin (non-blocking)
  if (deployment.adminEmail) {
    sendEmailSummary(
      deployment.adminEmail,
      deployment.adminName ?? "Administrator",
      deployment.clientName,
      configResult.data.accounts.length,
      configResult.data.accounts.reduce(
        (sum, a) => sum + a.folders.filter((f) => f.category !== "prywatne").length,
        0,
      ),
      env,
    ).catch((err) => console.error("Email summary failed:", err));
  }

  return {
    ok: true,
    data: {
      r2Key,
      status: "active",
    },
  };
}

/** Send a Telegram notification to the operator chat. */
async function sendTelegramNotification(
  clientName: string,
  deploymentId: string,
  env: Env,
): Promise<void> {
  const message = [
    `Grota: Eksport konfiguracji zakonczony`,
    `Klient: ${clientName}`,
    `Deployment: ${deploymentId}`,
    `Plik: configs/${deploymentId}/config.json`,
    `Status: active`,
  ].join("\n");

  await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
      }),
    },
  );
}

/** Send an email summary to the client admin via Resend. */
async function sendEmailSummary(
  to: string,
  name: string,
  clientName: string,
  employeeCount: number,
  folderCount: number,
  env: Env,
): Promise<void> {
  const html = `
    <p>Czesc ${name},</p>
    <p>Onboarding dla <strong>${clientName}</strong> zostal zakonczony.</p>
    <ul>
      <li>Liczba pracownikow: ${employeeCount}</li>
      <li>Liczba folderow do backupu: ${folderCount}</li>
    </ul>
    <p>Operator rozpocznie konfiguracje backupu wkrotce.</p>
    <p>-- Grota</p>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Grota <noreply@grota.app>",
      to: [to],
      subject: `Grota: Onboarding ${clientName} zakonczony`,
      html,
    }),
  });
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

### Create R2 buckets

```bash
# Dev (local -- auto-created by wrangler dev)
# Staging
wrangler r2 bucket create grota-configs-staging
# Production
wrangler r2 bucket create grota-configs-production
```

### Endpoint summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/config/preview/:deploymentId` | Bearer | Preview config JSON (no R2 upload) |
| `POST` | `/config/export/:deploymentId` | Bearer | Export to R2 + notify |

## UI Pages & Components

### New route: `apps/user-application/src/routes/_auth/dashboard/$id/config.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_auth/dashboard/$id/config")({
  component: ConfigPage,
});

function ConfigPage() {
  const { id: deploymentId } = Route.useParams();
  const [exportResult, setExportResult] = useState<{
    r2Key: string;
    status: string;
  } | null>(null);

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

  const exportMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `${dataServiceUrl}/config/export/${deploymentId}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}` },
        },
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Eksport nie powiodl sie");
      }
      return response.json() as Promise<{ r2Key: string; status: string }>;
    },
    onSuccess: (data) => setExportResult(data),
  });

  const config = previewQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">
          Konfiguracja eksportu
        </h1>
        {exportResult && (
          <Badge variant="default">Wyeksportowano</Badge>
        )}
      </div>

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

      {/* Export action */}
      <Card>
        <CardHeader>
          <CardTitle>Eksport do R2</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {exportResult ? (
            <div className="space-y-2">
              <p className="text-sm text-green-600 dark:text-green-400">
                Konfiguracja wyeksportowana pomyslnie.
              </p>
              <p className="text-sm text-muted-foreground">
                Klucz R2: <code className="text-foreground">{exportResult.r2Key}</code>
              </p>
              <p className="text-sm text-muted-foreground">
                Status wdrozenia: {exportResult.status}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setExportResult(null);
                  exportMutation.reset();
                }}
              >
                Eksportuj ponownie
              </Button>
            </div>
          ) : (
            <>
              {exportMutation.isError && (
                <Alert variant="destructive">
                  {exportMutation.error.message}
                </Alert>
              )}
              <p className="text-sm text-muted-foreground">
                Plik zostanie zapisany w R2 jako:{" "}
                <code className="text-foreground">configs/{deploymentId}/config.json</code>
              </p>
              <Button
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
              >
                {exportMutation.isPending
                  ? "Eksportowanie..."
                  : "Eksportuj do R2"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Server access instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Dostep z serwera (S3 API)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Skrypty serwerowe moga pobrac konfiguracje z R2 za pomoca
            S3-compatible API:
          </p>
          <pre className="overflow-x-auto rounded bg-muted p-4 text-xs text-foreground">
{`# Ustaw zmienne srodowiskowe:
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."
export R2_ENDPOINT="https://{account_id}.r2.cloudflarestorage.com"

# Pobierz konfiguracje za pomoca rclone:
rclone copy r2:grota-configs/configs/${deploymentId}/config.json ./

# Lub za pomoca curl + AWS Signature V4:
curl "$R2_ENDPOINT/grota-configs/configs/${deploymentId}/config.json" \\
  --aws-sigv4 "aws:amz:auto:s3" \\
  --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY"`}
          </pre>
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
   - Create R2 buckets: `wrangler r2 bucket create grota-configs-dev` (etc.)
   - Regenerate types: `cd apps/data-service && pnpm cf-typegen`

3. **Create config handlers and service in data-service**
   - Create `hono/handlers/config-handlers.ts`
   - Create `hono/services/config-service.ts`
   - Update `hono/app.ts` with `/config` route

4. **Create config page in user-application**
   - Create `routes/_auth/dashboard/$id/config.tsx`
   - Update `routes/_auth/dashboard/$id.tsx` with link to config page

5. **Set Telegram env vars**
   - Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in data-service `.dev.vars`
   - To create a bot: message @BotFather on Telegram -> /newbot
   - To get chat ID: message the bot, then `GET https://api.telegram.org/bot{token}/getUpdates`

6. **Regenerate and verify**
   - `cd apps/user-application && npx @tanstack/router-cli generate`
   - `pnpm run lint:fix && pnpm run lint`

## Environment Variables

| Variable | Package | Purpose |
|----------|---------|---------|
| `TELEGRAM_BOT_TOKEN` | data-service | Telegram Bot API authentication |
| `TELEGRAM_CHAT_ID` | data-service | Target chat for operator notifications |
| `RESEND_API_KEY` | data-service | Email summary to client admin |
| `ENCRYPTION_KEY` | data-service | Decrypt tokens for config assembly |

All variables were spec'd in doc 001. First used for Telegram in this doc.

## Manual Test Script

1. Ensure a deployment exists in "ready" status (all employees completed folder selection from doc 005)
2. Run both dev servers
3. Sign in as operator
4. Navigate to deployment detail page (`/_auth/dashboard/{id}`)
5. Click "Eksportuj konfiguracje" -- should navigate to `/dashboard/{id}/config`
6. **Test preview:**
   - Config JSON should be displayed in the preview panel
   - Verify structure matches the expected format from PLAN.md:
     - `deployment_id`, `client_name`, `domain`, `created_at`
     - `workspace.oauth_refresh_token` (if admin authorized)
     - `accounts[]` with `email`, `name`, `role`, `oauth_refresh_token`, `folders[]`
     - `b2` and `server` (null if not configured)
   - Verify OAuth tokens are decrypted (plaintext refresh tokens visible)
   - Verify folder selections match what employees tagged
7. **Test export:**
   - Click "Eksportuj do R2"
   - Should show success message with R2 key path
   - Deployment status should change to "active"
8. **Verify R2 upload:**
   - Using wrangler: `wrangler r2 object get grota-configs-dev/configs/{id}/config.json`
   - Verify JSON content matches the preview
9. **Verify Telegram notification:**
   - Check the Telegram chat -- should receive a message with deployment info
   - If `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` not set, check console for error log (non-blocking)
10. **Verify email summary:**
    - If `RESEND_API_KEY` is set and admin email is real, check inbox
    - Email should contain: client name, employee count, folder count
11. **Test re-export:**
    - Click "Eksportuj ponownie"
    - Should overwrite the existing R2 object
    - Deployment status remains "active"
12. **Test error cases:**
    - Try to export a deployment in "draft" status -- should show error
    - Try to export a deployment in "onboarding" status -- should show error
13. **Verify on dashboard:**
    - Navigate back to deployment list
    - Deployment badge should show "Aktywne"
