# 006b: R2 Export, Status Transition & Notifications

## Goal

Export the config JSON to Cloudflare R2, transition deployment status to "active", notify the operator via Telegram, send an email summary to the client admin via Resend, and add export UI to the config page -- completing the onboarding flow.

## Prerequisites

- Doc 006a (Config Assembly & Preview)

## Scope

### IN

- Export endpoint: `POST /config/export/:deploymentId`
- R2 upload to `configs/{deployment_id}/config.json`
- Deployment status transition: `ready` -> `active` after successful export
- Update `r2_config_key` field on deployment after export
- Re-export overwrites existing config (resolves **C2**)
- Telegram notification via Bot API `sendMessage`
- Email summary to client admin via Resend
- Export UI on config page: export button, success state, re-export button
- Exported badge on config page header
- Server access instructions card (S3 API docs for operator) (resolves **C8**)
- Create R2 buckets (staging + production)

### OUT

- Server scripts (Phase 2)
- Terraform B2 bucket provisioning (Phase 2)
- Config versioning (MVP: overwrite on re-export)
- Monitoring dashboard (Phase 3)

## Decisions

| Blocker/Clarification | Decision |
|----------------------|----------|
| **C2** (re-export) | **Re-export overwrites** `configs/{deployment_id}/config.json`. No versioning in MVP. If the operator needs to update (e.g., employee re-authorized), they click "Eksportuj" again. |
| **C8** (server R2 access) | Server scripts access R2 via the **S3-compatible API** using R2 access keys (API token with `Workers R2 Storage:Edit` permission). Endpoint: `https://{account_id}.r2.cloudflarestorage.com`. Documented in the config page for the operator. |

## Data Model Changes

No new tables. Uses existing `r2_config_key` field on deployments to track the R2 object key after export.

## API Endpoints

### Update: `apps/data-service/src/hono/handlers/config-handlers.ts`

Add the export endpoint to the existing config handlers from doc 006a:

```ts
import { EmployeeDeploymentParamSchema } from "@repo/data-ops/employee";
import * as configService from "../services/config-service";

// Export config JSON to R2 + send notifications
configHandlers.post(
  "/export/:deploymentId",
  (c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
  zValidator("param", EmployeeDeploymentParamSchema),
  async (c) => {
    const { deploymentId } = c.req.valid("param");
    return resultToResponse(
      c,
      await configService.exportConfig(deploymentId, c.env),
    );
  },
);
```

### Update: `apps/data-service/src/hono/services/config-service.ts`

Add export, Telegram, and Resend functions to the existing config service from doc 006a:

```ts
import { getDeployment, updateDeploymentStatus } from "@repo/data-ops/deployment";

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

### Create R2 buckets

```bash
# Dev (local -- auto-created by wrangler dev)
# Staging
wrangler r2 bucket create grota-configs-staging
# Production
wrangler r2 bucket create grota-configs-production
```

### Endpoint summary (new in this doc)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/config/export/:deploymentId` | Bearer | Export to R2 + notify |

## UI Pages & Components

### Update: `apps/user-application/src/routes/_auth/dashboard/$id/config.tsx`

Add export UI, badge, and server access instructions to the preview page from doc 006a:

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

      {/* Security notice -- from 006a */}
      <Alert>
        <p className="text-sm">
          Plik konfiguracyjny zawiera tokeny OAuth (refresh tokens).
          Tokeny sa przechowywane w postaci jawnej w R2 -- bucket jest
          kontrolowany przez operatora. W razie potrzeby tokeny mozna
          cofnac w ustawieniach Google kazdego uzytkownika.
        </p>
      </Alert>

      {/* Config preview -- from 006a */}
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

      {/* Export summary -- from 006a */}
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

      {/* Export action -- NEW in 006b */}
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

      {/* Server access instructions -- NEW in 006b */}
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

## Implementation Steps

1. **Add export endpoint to config handlers**
   - Add `POST /export/:deploymentId` to `config-handlers.ts`

2. **Add export service + notifications to config service**
   - Add `exportConfig`, `sendTelegramNotification`, `sendEmailSummary` to `config-service.ts`
   - Import `getDeployment`, `updateDeploymentStatus` from data-ops

3. **Create R2 buckets**
   - `wrangler r2 bucket create grota-configs-staging`
   - `wrangler r2 bucket create grota-configs-production`

4. **Update config page with export UI**
   - Add `useState` for export result, `useMutation` for export
   - Add export card with button, success state, re-export
   - Add `Badge` for exported state
   - Add server access instructions card

5. **Set notification env vars**
   - Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in data-service `.dev.vars`
   - Set `RESEND_API_KEY` in data-service `.dev.vars`
   - To create a bot: message @BotFather on Telegram -> /newbot
   - To get chat ID: message the bot, then `GET https://api.telegram.org/bot{token}/getUpdates`

6. **Regenerate and verify**
   - `pnpm run lint:fix && pnpm run lint`

## Environment Variables

| Variable | Package | Purpose |
|----------|---------|---------|
| `TELEGRAM_BOT_TOKEN` | data-service | Telegram Bot API authentication |
| `TELEGRAM_CHAT_ID` | data-service | Target chat for operator notifications |
| `RESEND_API_KEY` | data-service | Email summary to client admin |

All variables were spec'd in doc 001. First used for Telegram and Resend in this doc.

## Manual Test Script

1. Ensure doc 006a is implemented and preview works
2. Run both dev servers
3. Sign in as operator
4. Navigate to config page (`/_auth/dashboard/{id}/config`)
5. **Test export:**
   - Click "Eksportuj do R2"
   - Should show success message with R2 key path
   - Badge "Wyeksportowano" should appear in header
   - Deployment status should change to "active"
6. **Verify R2 upload:**
   - Using wrangler: `wrangler r2 object get grota-configs-dev/configs/{id}/config.json`
   - Verify JSON content matches the preview
7. **Verify Telegram notification:**
   - Check the Telegram chat -- should receive a message with deployment info
   - If `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` not set, check console for error log (non-blocking)
8. **Verify email summary:**
   - If `RESEND_API_KEY` is set and admin email is real, check inbox
   - Email should contain: client name, employee count, folder count
9. **Test re-export:**
   - Click "Eksportuj ponownie"
   - Should overwrite the existing R2 object
   - Deployment status remains "active"
10. **Test error cases:**
    - Try to export a deployment in "draft" status -- should show error
    - Try to export a deployment in "onboarding" status -- should show error
11. **Verify on dashboard:**
    - Navigate back to deployment list
    - Deployment badge should show "Aktywne"
12. **Test server access instructions:**
    - S3 API instructions card should be visible with correct deployment ID in URLs
