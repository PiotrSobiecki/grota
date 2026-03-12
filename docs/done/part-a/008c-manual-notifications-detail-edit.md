# 008c: Manual Notification Trigger & Deployment Detail Edit

## Overview

Two gaps in current implementation:

1. **Notifications only fire on config export.** Operator cannot re-send Telegram/email without re-exporting.
2. **Detail page is read-only.** `PUT /deployments/:id` exists and `updateExistingDeployment` server fn exists, but the detail page (`$id/index.tsx`) has no edit UI.

## Scope

### IN

- Manual notification trigger button on config page AND detail page (status=active only)
- New endpoint `POST /notifications/:deploymentId/send`
- Confirmation dialog before sending
- Inline edit mode on detail page for: clientName, domain, adminEmail, adminName
- b2Config/serverConfig editable in draft + onboarding status
- Uses existing `updateExistingDeployment` server fn + `PUT /deployments/:id` endpoint

### OUT

- Notification history/logs
- New notification channels
- Bulk edit across deployments

## Current State Analysis

### Notifications

`config-service.ts` has `sendTelegramNotification()` and `sendEmailSummary()` as private functions called only inside `exportConfig()`. No standalone endpoint exists.

### Detail Page

`$id/index.tsx` renders deployment data read-only in cards. The `updateExistingDeployment` server fn exists in `core/functions/deployments/direct.ts` but is never called from the detail page. `DeploymentUpdateRequestSchema` supports optional fields: clientName, domain, adminEmail, adminName, b2Config, serverConfig.

---

## Part 1: Manual Notification Trigger

### API

#### New service: `apps/data-service/src/hono/services/notification-service.ts`

Extract and reuse Telegram/email logic from config-service.

```ts
import { getDeployment } from "@repo/data-ops/deployment";
import { getConfigAssemblyData } from "@repo/data-ops/config";
import type { Result } from "../types/result";

interface NotificationResult {
  telegram: boolean;
  email: boolean;
}

export async function sendDeploymentNotifications(
  deploymentId: string,
  env: Env,
): Promise<Result<NotificationResult>> {
  const deployment = await getDeployment(deploymentId);
  if (!deployment) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Wdrozenie nie znalezione", status: 404 } };
  }

  if (deployment.status !== "active") {
    return {
      ok: false,
      error: { code: "INVALID_STATUS", message: "Powiadomienia mozliwe tylko dla statusu 'active'", status: 400 },
    };
  }

  const configData = await getConfigAssemblyData(deploymentId);
  const accountCount = configData?.accounts.length ?? 0;
  const folderCount = configData?.accounts.reduce(
    (sum, a) => sum + a.folders.filter((f) => f.category !== "prywatne").length, 0,
  ) ?? 0;

  let telegramOk = false;
  let emailOk = false;

  try {
    await sendTelegramNotification(deployment.clientName, deploymentId, env);
    telegramOk = true;
  } catch (err) {
    console.error("Telegram notification failed:", err);
  }

  if (deployment.adminEmail) {
    try {
      await sendEmailSummary(
        deployment.adminEmail,
        deployment.adminName ?? "Administrator",
        deployment.clientName,
        accountCount,
        folderCount,
        env,
      );
      emailOk = true;
    } catch (err) {
      console.error("Email notification failed:", err);
    }
  }

  return { ok: true, data: { telegram: telegramOk, email: emailOk } };
}
```

Move `sendTelegramNotification` and `sendEmailSummary` to this file (exported). Update `config-service.ts` to import from here.

#### New handler: `apps/data-service/src/hono/handlers/notification-handlers.ts`

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { EmployeeDeploymentParamSchema } from "@repo/data-ops/employee";
import { authMiddleware } from "../middleware/auth";
import { resultToResponse } from "../utils/result-response";
import * as notificationService from "../services/notification-service";

export const notificationHandlers = new Hono<{ Bindings: Env }>();

notificationHandlers.post(
  "/:deploymentId/send",
  (c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
  zValidator("param", EmployeeDeploymentParamSchema),
  async (c) => {
    const { deploymentId } = c.req.valid("param");
    return resultToResponse(c, await notificationService.sendDeploymentNotifications(deploymentId, c.env));
  },
);
```

Register in `app.ts`: `app.route("/notifications", notificationHandlers)`

#### Endpoint summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/notifications/:deploymentId/send` | Bearer | Send Telegram + email manually |

### UI: Config Page Button

Add to `$id/config.tsx` -- "Wyslij powiadomienia" button visible only when deployment is active.

```tsx
// New server fn in core/functions/notifications/binding.ts
export const sendNotifications = createServerFn({ method: "POST" })
  .inputValidator(z.object({ deploymentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const response = await fetchDataService(`/notifications/${data.deploymentId}/send`, {
      method: "POST",
    });
    if (!response.ok) {
      const body = await response.json() as { error?: string };
      throw new AppError(body.error ?? "Wysylanie powiadomien nie powiodlo sie", "NOTIFICATION_FAILED", 500);
    }
    return response.json() as Promise<{ telegram: boolean; email: boolean }>;
  });
```

Config page additions:

```tsx
// Inside ConfigPage, after export card
const notifyMutation = useMutation({
  mutationFn: () => sendNotifications({ data: { deploymentId } }),
});

const [showConfirmDialog, setShowConfirmDialog] = useState(false);

// Render (only when exportResult or deployment already active)
<Card>
  <CardHeader>
    <CardTitle>Powiadomienia</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    {notifyMutation.isSuccess && (
      <p className="text-sm text-green-600 dark:text-green-400">
        Wyslano: Telegram {notifyMutation.data.telegram ? "OK" : "BLAD"},
        Email {notifyMutation.data.email ? "OK" : "BLAD"}
      </p>
    )}
    {notifyMutation.isError && (
      <Alert variant="destructive"><p className="text-sm">{notifyMutation.error.message}</p></Alert>
    )}
    <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={notifyMutation.isPending}>
          {notifyMutation.isPending ? "Wysylanie..." : "Wyslij powiadomienia"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Wyslac powiadomienia?</AlertDialogTitle>
          <AlertDialogDescription>
            Telegram + email (do admina klienta) zostana wyslane ponownie.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction onClick={() => { notifyMutation.mutate(); setShowConfirmDialog(false); }}>
            Wyslij
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </CardContent>
</Card>
```

Requires: `AlertDialog` components from shadcn/ui.

---

## Part 2: Deployment Detail Edit Form

### Approach

Toggle-based inline edit. "Edytuj" button switches "Dane klienta" card from display to form mode. Uses `useForm` + `useMutation` per form-patterns.md.

### UI Changes to `$id/index.tsx`

#### State & mutations

```tsx
const [isEditing, setIsEditing] = useState(false);
const router = useRouter();

const updateMutation = useMutation({
  mutationFn: (updates: DeploymentUpdateInput) =>
    updateExistingDeployment({ data: { id: deployment.id, updates } }),
  onSuccess: () => {
    setIsEditing(false);
    router.invalidate();
  },
});
```

#### Edit form (replaces "Dane klienta" card content when isEditing=true)

```tsx
const form = useForm({
  defaultValues: {
    clientName: deployment.clientName,
    domain: deployment.domain,
    adminEmail: deployment.adminEmail ?? "",
    adminName: deployment.adminName ?? "",
  },
  onSubmit: async ({ value }) => {
    updateMutation.reset();
    updateMutation.mutate({
      clientName: value.clientName,
      domain: value.domain,
      adminEmail: value.adminEmail || undefined,
      adminName: value.adminName || undefined,
    });
  },
});
```

#### Editable fields

| Field | Input type | Always editable |
|-------|-----------|----------------|
| clientName | text | yes |
| domain | text | yes |
| adminEmail | email | yes |
| adminName | text | yes |
| b2Config | JSON sub-form (key_id, app_key, bucket_prefix) | draft + onboarding |
| serverConfig | JSON sub-form (backup_path, bwlimit, ssh_host?, ssh_user?) | draft + onboarding |

#### b2Config / serverConfig

Separate card: "Konfiguracja serwera" with its own edit toggle. Only rendered + editable when `deployment.status === "draft" || deployment.status === "onboarding"`. Uses nested form fields matching `B2ConfigSchema` and `ServerConfigSchema`.

```tsx
{(deployment.status === "draft" || deployment.status === "onboarding") && (
  <ServerConfigCard
    deployment={deployment}
    onSave={(updates) => updateMutation.mutate(updates)}
    isPending={updateMutation.isPending}
  />
)}
```

#### Edit button placement

"Dane klienta" card header gets an "Edytuj" / "Anuluj" button:

```tsx
<CardHeader className="flex flex-row items-center justify-between">
  <CardTitle>Dane klienta</CardTitle>
  <Button variant="ghost" size="sm" onClick={() => setIsEditing(!isEditing)}>
    {isEditing ? "Anuluj" : "Edytuj"}
  </Button>
</CardHeader>
```

---

## Implementation Steps

1. **Extract notification functions** -- create `notification-service.ts`, move Telegram/email fns from `config-service.ts`, update imports
2. **Add notification handler** -- create `notification-handlers.ts`, register in `app.ts`
3. **Add notification server fn** -- create `core/functions/notifications/binding.ts`
4. **Add notification UI to config page** -- button + AlertDialog confirmation + result display
5. **Add edit mode to detail page** -- `isEditing` state, `useForm`, inline form fields in "Dane klienta" card
6. **Add server config card** -- separate card for b2Config/serverConfig, draft-only
7. **Ensure AlertDialog components exist** -- `npx shadcn@latest add alert-dialog` if missing
8. **Lint** -- `pnpm run lint:fix && pnpm run lint`

## Environment Variables

No new env vars. Uses existing: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RESEND_API_KEY`.

## Manual Test Script

1. **Notification trigger:**
   - Navigate to config page of an active deployment
   - "Wyslij powiadomienia" button should be visible
   - Click it -- confirmation dialog appears
   - Confirm -- shows Telegram OK/BLAD, Email OK/BLAD
   - Check Telegram chat for message
   - Check admin email inbox
   - Try on non-active deployment -- button hidden or endpoint returns 400

2. **Detail edit:**
   - Navigate to deployment detail page
   - Click "Edytuj" on "Dane klienta" card
   - Fields become editable inputs with current values
   - Change clientName, save -- page refreshes with updated name
   - Verify header title updates
   - For draft deployment: "Konfiguracja serwera" card appears with b2/server fields
   - For non-draft: server config card hidden

3. **API test:**
   - `curl -X POST localhost:8788/notifications/{id}/send -H "Authorization: Bearer ..."` -- returns `{ telegram: true, email: true }`

## Decisions

| Question | Decision |
|----------|----------|
| Notification button placement | Both detail page AND config page |
| Rate-limit manual notifications | No — operator panel, trust the operator |
| Last notification timestamp | No — not needed for MVP |
| b2Config/serverConfig editable beyond draft | Yes — as user suggested, editable in draft + onboarding |
