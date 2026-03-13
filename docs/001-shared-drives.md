# 001 - Shared Drives Management

## Overview

Add Google Workspace Shared Drives configuration to the web app so the CLI `grota migrate` command can resolve Shared Drive names to IDs at runtime. The company admin maps each fixed category (dokumenty, projekty, media) to a Shared Drive name per deployment. The config JSON exported to R2 includes `workspace.shared_drives[]`.

## User Roles & Flow

**Operator (grota owner)** — provisions infrastructure, manages deployments
- Creates deployment for a client company in the web app
- Provisions VPS, installs CLI, configures `/etc/grota/grota.env`
- Exports config to R2, runs `grota setup rclone`, `grota timers install`
- Triggers migration when ready: `grota migrate --dry-run`, then `grota migrate`

**Admin (company administrator)** — configures what gets backed up and migrated
- Logs into web app dashboard
- Connects workspace Google account (OAuth) for the workspace_drive remote
- Adds employees by email — generates onboarding links
- Creates Shared Drives in Google Admin console (e.g. "CompanyName-Dokumenty")
- Maps categories → Shared Drive names in the web app *(this feature)*
- Clicks "Export" to push config to R2

**Employee** — self-service onboarding via link from admin
- Receives onboarding link (`/employee/$token`)
- Authorizes Google Drive access (OAuth consent)
- Sees their Drive folders, categorizes each (dokumenty/media/prywatne)
- No further action needed

**Automated (VPS timers)**
- Nightly: `grota backup all` — syncs employee Drive folders → local VPS (→ B2 if configured)
- Weekly: `grota verify remotes` — checks all rclone remotes still work

## Context & Background

The CLI migration script (`apps/cli/lib/migration.sh`) already reads `workspace.shared_drives` from config JSON via `cfg_shared_drives()`. It expects:

```json
{
  "workspace": {
    "oauth_refresh_token": "1//...",
    "shared_drives": [
      { "name": "ClientName-Dokumenty", "category": "dokumenty" },
      { "name": "ClientName-Projekty", "category": "projekty" }
    ]
  }
}
```

Currently, config JSON only has `workspace.oauth_refresh_token` -- no `shared_drives`. This doc covers adding the full stack: DB table, queries, API, config export, and UI.

## Goals & Non-Goals

**Goals:**
- Store Shared Drive mappings (category -> drive name) per deployment
- Expose CRUD API endpoints for shared drives
- Include `shared_drives` in config JSON export
- Provide UI card on deployment detail page for managing mappings

**Non-Goals:**
- Google Drive API integration to list/validate Shared Drive names (operator types name manually)
- Shared Drive ID resolution (CLI does this at runtime via `drives.list` API)
- Changes to the CLI itself

## Design

### Data Model

New `shared_drives` table linked to deployments. Each row maps one category to one Shared Drive name. Unique constraint on `(deployment_id, category)` enforces at most one drive per category per deployment.

Categories reuse the existing `folder_category` pgEnum but restricted to 3 values at the Zod layer: `dokumenty`, `projekty`, `media`. The pgEnum also includes `prywatne` -- Shared Drives never use that category, so the Zod schema excludes it.

### Architecture

Standard handlers -> services -> queries separation across 3 packages:

```
data-ops (shared-drive/)     data-service (hono/)           user-application
  table.ts                     handlers/shared-drive-handlers.ts   core/functions/shared-drives/binding.ts
  schema.ts                    services/shared-drive-service.ts    routes/_auth/dashboard/$id/index.tsx
  queries.ts                                                        (SharedDriveSection component)
  index.ts
```

## Implementation Details

### 1. data-ops: `shared-drive/` domain

**`table.ts`**

```ts
import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { folderCategoryEnum } from "../folder-selection/table";
import { deployments } from "../deployment/table";

export const sharedDrives = pgTable(
  "shared_drives",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: folderCategoryEnum("category").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.deploymentId, t.category)],
);
```

Reuses existing `folderCategoryEnum` from folder-selection to avoid a duplicate pgEnum. The Zod layer restricts to the 3 valid categories.

**`schema.ts`**

```ts
import { z } from "zod";

export const SharedDriveCategorySchema = z.enum(["dokumenty", "projekty", "media"]);

export const SharedDriveSchema = z.object({
  id: z.string().uuid(),
  deploymentId: z.string().uuid(),
  name: z.string(),
  category: SharedDriveCategorySchema,
  createdAt: z.coerce.date(),
});

export const SharedDriveUpsertRequestSchema = z.object({
  name: z.string().min(1, "Nazwa dysku jest wymagana"),
  category: SharedDriveCategorySchema,
});

export const SharedDriveBulkUpsertRequestSchema = z.object({
  drives: z
    .array(SharedDriveUpsertRequestSchema)
    .min(1)
    .max(3)
    .refine(
      (drives) => new Set(drives.map((d) => d.category)).size === drives.length,
      { message: "Kategorie musza byc unikalne" },
    ),
});

export const SharedDriveListResponseSchema = z.object({
  data: z.array(SharedDriveSchema),
});

export const SharedDriveDeploymentParamSchema = z.object({
  deploymentId: z.string().uuid("Nieprawidlowy format ID"),
});

export type SharedDriveCategory = z.infer<typeof SharedDriveCategorySchema>;
export type SharedDrive = z.infer<typeof SharedDriveSchema>;
export type SharedDriveUpsertInput = z.infer<typeof SharedDriveUpsertRequestSchema>;
export type SharedDriveBulkUpsertInput = z.infer<typeof SharedDriveBulkUpsertRequestSchema>;
```

Key decision: bulk upsert (delete-then-insert) as the primary write operation. The UI sends all 3 mappings at once. Simpler than individual PUT/DELETE per category.

**`queries.ts`**

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { SharedDrive, SharedDriveUpsertInput } from "./schema";
import { sharedDrives } from "./table";

export async function getSharedDrivesByDeployment(
  deploymentId: string,
): Promise<SharedDrive[]> {
  const db = getDb();
  return db.select().from(sharedDrives).where(eq(sharedDrives.deploymentId, deploymentId));
}

export async function upsertSharedDrives(
  deploymentId: string,
  drives: SharedDriveUpsertInput[],
): Promise<SharedDrive[]> {
  const db = getDb();
  await db.delete(sharedDrives).where(eq(sharedDrives.deploymentId, deploymentId));
  if (drives.length === 0) return [];
  return db
    .insert(sharedDrives)
    .values(drives.map((d) => ({ deploymentId, name: d.name, category: d.category })))
    .returning();
}

export async function deleteSharedDrivesByDeployment(deploymentId: string): Promise<void> {
  const db = getDb();
  await db.delete(sharedDrives).where(eq(sharedDrives.deploymentId, deploymentId));
}
```

**`index.ts`** -- barrel re-exports queries, schemas, types, and table.

**`package.json`** -- add export entry:

```json
"./shared-drive": {
  "types": "./dist/shared-drive/index.d.ts",
  "default": "./dist/shared-drive/index.js"
}
```

**Relations** -- add to `drizzle/relations.ts`:

```ts
import { sharedDrives } from "../shared-drive/table";

// Add to deploymentRelations:
sharedDrives: many(sharedDrives),

// New:
export const sharedDriveRelations = relations(sharedDrives, ({ one }) => ({
  deployment: one(deployments, {
    fields: [sharedDrives.deploymentId],
    references: [deployments.id],
  }),
}));
```

### 2. data-ops: Config query update

Add shared drives fetch to `config/queries.ts`:

```ts
// In getConfigAssemblyData, after fetching deployment:
import { sharedDrives } from "../shared-drive/table";

const sharedDriveRows = await db
  .select()
  .from(sharedDrives)
  .where(eq(sharedDrives.deploymentId, deploymentId));

// Add to ConfigAssemblyData interface:
sharedDrives: Array<{ name: string; category: string }>;

// Return in result:
sharedDrives: sharedDriveRows.map((sd) => ({
  name: sd.name,
  category: sd.category,
})),
```

### 3. data-ops: Config schema update

Update `config/schema.ts` to include `shared_drives` in workspace:

```ts
export const ConfigJsonSchema = z.object({
  // ... existing fields ...
  workspace: z
    .object({
      oauth_refresh_token: z.string(),
      shared_drives: z.array(
        z.object({
          name: z.string(),
          category: z.string(),
        }),
      ),
    })
    .nullable(),
  // ... rest ...
});
```

### 4. data-service: API endpoints

**Route**: `/shared-drives/:deploymentId`

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/shared-drives/:deploymentId` | -- | List shared drives for deployment |
| PUT | `/shared-drives/:deploymentId` | `{ drives: [...] }` | Bulk upsert (replace all) |
| DELETE | `/shared-drives/:deploymentId` | -- | Remove all shared drives |

**`services/shared-drive-service.ts`**

```ts
import {
  getSharedDrivesByDeployment,
  upsertSharedDrives,
  deleteSharedDrivesByDeployment,
  type SharedDrive,
  type SharedDriveUpsertInput,
} from "@repo/data-ops/shared-drive";
import type { Result } from "../types/result";

export async function listSharedDrives(
  deploymentId: string,
): Promise<Result<{ data: SharedDrive[] }>> {
  const data = await getSharedDrivesByDeployment(deploymentId);
  return { ok: true, data: { data } };
}

export async function saveSharedDrives(
  deploymentId: string,
  drives: SharedDriveUpsertInput[],
): Promise<Result<SharedDrive[]>> {
  const result = await upsertSharedDrives(deploymentId, drives);
  return { ok: true, data: result };
}

export async function removeSharedDrives(
  deploymentId: string,
): Promise<Result<{ deleted: true }>> {
  await deleteSharedDrivesByDeployment(deploymentId);
  return { ok: true, data: { deleted: true } };
}
```

**`handlers/shared-drive-handlers.ts`**

```ts
import { zValidator } from "@hono/zod-validator";
import {
  SharedDriveBulkUpsertRequestSchema,
  SharedDriveDeploymentParamSchema,
} from "@repo/data-ops/shared-drive";
import { Hono } from "hono";
import * as sharedDriveService from "../services/shared-drive-service";
import { resultToResponse } from "../utils/result-to-response";

const sharedDriveHandlers = new Hono<{ Bindings: Env }>();

sharedDriveHandlers.get(
  "/:deploymentId",
  zValidator("param", SharedDriveDeploymentParamSchema),
  async (c) => {
    const { deploymentId } = c.req.valid("param");
    return resultToResponse(c, await sharedDriveService.listSharedDrives(deploymentId));
  },
);

sharedDriveHandlers.put(
  "/:deploymentId",
  zValidator("param", SharedDriveDeploymentParamSchema),
  zValidator("json", SharedDriveBulkUpsertRequestSchema),
  async (c) => {
    const { deploymentId } = c.req.valid("param");
    const { drives } = c.req.valid("json");
    return resultToResponse(c, await sharedDriveService.saveSharedDrives(deploymentId, drives));
  },
);

sharedDriveHandlers.delete(
  "/:deploymentId",
  zValidator("param", SharedDriveDeploymentParamSchema),
  async (c) => {
    const { deploymentId } = c.req.valid("param");
    return resultToResponse(c, await sharedDriveService.removeSharedDrives(deploymentId));
  },
);

export default sharedDriveHandlers;
```

**`app.ts`** -- register route:

```ts
import sharedDriveHandlers from "./handlers/shared-drive-handlers";
App.route("/shared-drives", sharedDriveHandlers);
```

### 5. data-service: Config export update

In `config-service.ts`, update the workspace object construction:

```ts
workspace: workspaceRefreshToken
  ? {
      oauth_refresh_token: workspaceRefreshToken,
      shared_drives: data.sharedDrives,
    }
  : null,
```

This produces the exact structure the CLI expects. If no workspace OAuth token exists, workspace is null and shared drives are omitted (CLI will fail with a clear error about missing token).

### 6. user-application: Server functions

**`core/functions/shared-drives/binding.ts`**

```ts
import type { SharedDrive, SharedDriveUpsertInput } from "@repo/data-ops/shared-drive";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { fetchDataService } from "@/lib/data-service";

export const getSharedDrives = createServerFn({ method: "GET" })
  .inputValidator(z.object({ deploymentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const response = await fetchDataService(`/shared-drives/${data.deploymentId}`);
    if (!response.ok) {
      const body = (await response.json()) as { error?: string; code?: string };
      throw new AppError(
        body.error ?? "Nie udalo sie pobrac dysków wspoldzielonych",
        body.code ?? "SHARED_DRIVES_LIST_ERROR",
        response.status,
      );
    }
    return (await response.json()) as { data: SharedDrive[] };
  });

export const saveSharedDrives = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      deploymentId: z.string().uuid(),
      drives: z.array(z.object({ name: z.string().min(1), category: z.enum(["dokumenty", "projekty", "media"]) })),
    }),
  )
  .handler(async ({ data }) => {
    const response = await fetchDataService(`/shared-drives/${data.deploymentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drives: data.drives }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string; code?: string };
      throw new AppError(
        body.error ?? "Nie udalo sie zapisac dysków wspoldzielonych",
        body.code ?? "SHARED_DRIVES_SAVE_ERROR",
        response.status,
      );
    }
    return (await response.json()) as SharedDrive[];
  });
```

### 7. user-application: UI component

Add a `SharedDriveSection` component to the deployment detail page (`routes/_auth/dashboard/$id/index.tsx`). Renders as a Card alongside existing sections.

**Behavior:**
- Fetches current shared drives via `useQuery`
- Shows 3 rows (one per category) with Input fields for drive name
- Empty input = no mapping for that category
- Save button triggers `useMutation` with bulk upsert
- Read-only when deployment status is `active`

**Component sketch:**

```tsx
function SharedDriveSection({ deploymentId, deploymentStatus }: {
  deploymentId: string;
  deploymentStatus: string;
}) {
  const [isEditing, setIsEditing] = useState(false);

  const query = useQuery({
    queryKey: ["shared-drives", deploymentId],
    queryFn: () => getSharedDrives({ data: { deploymentId } }),
  });

  const mutation = useMutation({
    mutationFn: (drives: Array<{ name: string; category: string }>) =>
      saveSharedDrives({ data: { deploymentId, drives } }),
    onSuccess: () => { query.refetch(); setIsEditing(false); },
  });

  const categories = ["dokumenty", "projekty", "media"] as const;
  const currentDrives = query.data?.data ?? [];
  const canEdit = deploymentStatus !== "active";

  const form = useForm({
    defaultValues: {
      dokumenty: currentDrives.find((d) => d.category === "dokumenty")?.name ?? "",
      projekty: currentDrives.find((d) => d.category === "projekty")?.name ?? "",
      media: currentDrives.find((d) => d.category === "media")?.name ?? "",
    },
    onSubmit: async ({ value }) => {
      const drives = categories
        .filter((cat) => value[cat].trim())
        .map((cat) => ({ name: value[cat].trim(), category: cat }));
      mutation.reset();
      mutation.mutate(drives);
    },
  });

  // Renders Card with category labels + inputs, save/cancel buttons
  // Follows existing pattern from ServerConfigCard / DepartmentSection
}
```

**Category labels** (Polish UI):
- dokumenty -> "Dokumenty"
- projekty -> "Projekty"
- media -> "Media"

**Placement**: between `ServerConfigCard` and `DepartmentSection` on the deployment detail page. Only visible when deployment has a workspace OAuth token (otherwise Shared Drives are irrelevant).

## Migration Steps

1. Create `packages/data-ops/src/shared-drive/` domain (table, schema, queries, index)
2. Add relations to `drizzle/relations.ts`
3. Run `pnpm run drizzle:dev:generate` + `pnpm run drizzle:dev:migrate`
4. Update `config/queries.ts` + `config/schema.ts`
5. Add export to `packages/data-ops/package.json`
6. `pnpm --filter @repo/data-ops build`
7. Add handler + service in data-service, register route in `app.ts`
8. Add server functions in user-application
9. Add UI component to deployment detail page
10. Run `pnpm run lint:fix`

## Alternatives Considered

**Storing shared drives as JSONB on deployments table** -- simpler (no new table) but loses referential integrity and makes querying individual drives harder. Separate table is consistent with how folder_selections work.

**Individual CRUD per category (POST/PUT/DELETE per drive)** -- more REST-pure but adds complexity for a max-3-item collection. Bulk upsert is simpler for both API and UI.

**Validating drive names against Google API** -- would require workspace token + API call during save. Adds latency and failure modes. CLI already resolves names at runtime and gives clear errors if not found.

## Decisions

- **Auth**: Follow existing pattern — endpoints accessed via service binding, same as folder/department endpoints. No additional auth middleware needed.
- **Re-export**: Manual re-export only. Admin saves shared drive mappings, then clicks "Export" to push updated config to R2. Same flow as any other config change. Auto-export adds complexity for a rare operation.
