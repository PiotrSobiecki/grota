# 005: Employee Folder Selection

## Goal

Enable employees to see their Google Drive top-level folders, tag each folder by category, and confirm their selection -- with auto-suggestion and deployment status progression when all employees complete.

## Prerequisites

- Doc 001 (Bootstrap & Cleanup)
- Doc 002 (Operator Deployment CRUD)
- Doc 003 (Client Onboarding Wizard)
- Doc 004 (Google OAuth & Encryption)

## Scope

### IN

- `folder_selections` table in data-ops (resolves **B9** -- no `size_bytes`)
- Google Drive API integration: list top-level folders via `fetch`
- Folder selection CRUD endpoints in data-service
- Employee flow steps 2-4: folder list, category tagging, confirm
- Auto-suggestion: match folder name to category
- Employee status updates: `pending` -> `in_progress` -> `completed`
- Auto deployment status transition: when all employees completed -> `employees_pending` -> `ready`
- Update operator dashboard detail page: per-employee completion status

### OUT

- Google Drive file contents or nested folder traversal
- Folder size calculation (removed from MVP -- resolves **B9**)
- Config export (doc 006)
- Shared Drive operations (server scripts, Phase 2)

## Decisions

| Blocker | Decision |
|---------|----------|
| **B9** (folder size) | **Remove `size_bytes` from model.** Google Drive API does not return folder sizes. Calculating sizes would require recursively listing all files (expensive, slow). MVP shows folder name only. Future: add file count if needed. |

## Data Model Changes

### New file: `packages/data-ops/src/folder-selection/table.ts`

```ts
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { employees } from "../employee/table";

export const folderCategoryEnum = pgEnum("folder_category", [
  "dokumenty",
  "projekty",
  "media",
  "prywatne",
]);

export const folderSelections = pgTable("folder_selections", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  folderId: text("folder_id").notNull(),
  folderName: text("folder_name").notNull(),
  category: folderCategoryEnum("category").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### New file: `packages/data-ops/src/folder-selection/schema.ts`

```ts
import { z } from "zod";

// ============================================
// Enums
// ============================================

export const FolderCategorySchema = z.enum([
  "dokumenty",
  "projekty",
  "media",
  "prywatne",
]);

// ============================================
// Domain Model
// ============================================

export const FolderSelectionSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  folderId: z.string(),
  folderName: z.string(),
  category: FolderCategorySchema,
  createdAt: z.coerce.date(),
});

// ============================================
// Request Schemas
// ============================================

export const FolderSelectionCreateRequestSchema = z.object({
  folderId: z.string().min(1, "ID folderu jest wymagane"),
  folderName: z.string().min(1, "Nazwa folderu jest wymagana"),
  category: FolderCategorySchema,
});

export const FolderSelectionBulkCreateRequestSchema = z.object({
  employeeId: z.string().uuid(),
  selections: z
    .array(FolderSelectionCreateRequestSchema)
    .min(1, "Wybierz przynajmniej jeden folder"),
});

// ============================================
// Response Schemas
// ============================================

export const FolderSelectionResponseSchema = FolderSelectionSchema;

export const FolderSelectionListResponseSchema = z.object({
  data: z.array(FolderSelectionSchema),
  total: z.number(),
});

/** Google Drive folder item as returned from the API */
export const DriveFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  suggestedCategory: FolderCategorySchema.nullable(),
});

export const DriveFolderListResponseSchema = z.object({
  folders: z.array(DriveFolderSchema),
});

// ============================================
// Types
// ============================================

export type FolderCategory = z.infer<typeof FolderCategorySchema>;
export type FolderSelection = z.infer<typeof FolderSelectionSchema>;
export type FolderSelectionCreateInput = z.infer<typeof FolderSelectionCreateRequestSchema>;
export type FolderSelectionBulkCreateInput = z.infer<typeof FolderSelectionBulkCreateRequestSchema>;
export type DriveFolder = z.infer<typeof DriveFolderSchema>;
```

### New file: `packages/data-ops/src/folder-selection/queries.ts`

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { FolderSelection, FolderSelectionCreateInput } from "./schema";
import { folderSelections } from "./table";

export async function getFolderSelectionsByEmployee(
  employeeId: string,
): Promise<FolderSelection[]> {
  const db = getDb();
  return db
    .select()
    .from(folderSelections)
    .where(eq(folderSelections.employeeId, employeeId));
}

export async function createFolderSelections(
  employeeId: string,
  selections: FolderSelectionCreateInput[],
): Promise<FolderSelection[]> {
  const db = getDb();
  const values = selections.map((s) => ({
    employeeId,
    folderId: s.folderId,
    folderName: s.folderName,
    category: s.category,
  }));
  return db.insert(folderSelections).values(values).returning();
}

export async function deleteFolderSelectionsByEmployee(
  employeeId: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(folderSelections)
    .where(eq(folderSelections.employeeId, employeeId));
}
```

### New file: `packages/data-ops/src/folder-selection/index.ts`

```ts
export {
  createFolderSelections,
  deleteFolderSelectionsByEmployee,
  getFolderSelectionsByEmployee,
} from "./queries";
export type {
  DriveFolder,
  FolderCategory,
  FolderSelection,
  FolderSelectionBulkCreateInput,
  FolderSelectionCreateInput,
} from "./schema";
export {
  DriveFolderListResponseSchema,
  DriveFolderSchema,
  FolderCategorySchema,
  FolderSelectionBulkCreateRequestSchema,
  FolderSelectionCreateRequestSchema,
  FolderSelectionListResponseSchema,
  FolderSelectionResponseSchema,
  FolderSelectionSchema,
} from "./schema";
export { folderCategoryEnum, folderSelections } from "./table";
```

### Update `packages/data-ops/package.json` exports

```jsonc
{
  "exports": {
    "./folder-selection": {
      "types": "./dist/folder-selection/index.d.ts",
      "default": "./dist/folder-selection/index.js"
    },
    // ... existing exports
  }
}
```

### Update `packages/data-ops/src/drizzle/relations.ts`

Add folder selection relations:

```ts
import { folderSelections } from "../folder-selection/table";

// Add to existing relations:
export const employeeRelations = relations(employees, ({ one, many }) => ({
  deployment: one(deployments, {
    fields: [employees.deploymentId],
    references: [deployments.id],
  }),
  folderSelections: many(folderSelections),
}));

export const folderSelectionRelations = relations(folderSelections, ({ one }) => ({
  employee: one(employees, {
    fields: [folderSelections.employeeId],
    references: [employees.id],
  }),
}));
```

### Generate migration

```bash
pnpm --filter @repo/data-ops drizzle:dev:generate
pnpm --filter @repo/data-ops drizzle:dev:migrate
pnpm --filter @repo/data-ops build
```

## API Endpoints

### New file: `apps/data-service/src/hono/handlers/folder-handlers.ts`

```ts
import { zValidator } from "@hono/zod-validator";
import { FolderSelectionBulkCreateRequestSchema } from "@repo/data-ops/folder-selection";
import { z } from "zod";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as folderService from "../services/folder-service";
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

const folderHandlers = new Hono<{ Bindings: Env }>();

// List Drive folders for an employee (requires valid OAuth token)
folderHandlers.get(
  "/drive/:employeeId",
  zValidator("param", z.object({ employeeId: z.string().uuid() })),
  async (c) => {
    const { employeeId } = c.req.valid("param");
    return resultToResponse(
      c,
      await folderService.listDriveFolders(employeeId, c.env),
    );
  },
);

// Get existing folder selections for an employee
folderHandlers.get(
  "/selections/:employeeId",
  zValidator("param", z.object({ employeeId: z.string().uuid() })),
  async (c) => {
    const { employeeId } = c.req.valid("param");
    return resultToResponse(
      c,
      await folderService.getSelections(employeeId),
    );
  },
);

// Save folder selections (replaces existing)
folderHandlers.post(
  "/selections",
  zValidator("json", FolderSelectionBulkCreateRequestSchema),
  async (c) => {
    const data = c.req.valid("json");
    return resultToResponse(
      c,
      await folderService.saveSelections(data.employeeId, data.selections, c.env),
      201,
    );
  },
);

export default folderHandlers;
```

### New file: `apps/data-service/src/hono/services/folder-service.ts`

```ts
import { decrypt } from "@repo/data-ops/encryption";
import { getDriveOAuthToken } from "@repo/data-ops/employee";
import { getEmployeeById, getEmployeesByDeployment, updateEmployeeSelectionStatus } from "@repo/data-ops/employee";
import {
  type DriveFolder,
  type FolderSelection,
  type FolderSelectionCreateInput,
  createFolderSelections,
  deleteFolderSelectionsByEmployee,
  getFolderSelectionsByEmployee,
} from "@repo/data-ops/folder-selection";
import { updateDeploymentStatus } from "@repo/data-ops/deployment";
import type { Result } from "../types/result";

// ============================================
// Auto-suggestion rules
// ============================================

const CATEGORY_PATTERNS: Array<{
  category: "dokumenty" | "projekty" | "media" | "prywatne";
  patterns: RegExp[];
}> = [
  {
    category: "dokumenty",
    patterns: [
      /faktur/i,
      /umow/i,
      /dokument/i,
      /ksieg/i,
      /admin/i,
      /szablon/i,
      /rachunk/i,
      /pit/i,
      /vat/i,
    ],
  },
  {
    category: "projekty",
    patterns: [/projekt/i, /praca/i, /zlecen/i, /brief/i],
  },
  {
    category: "media",
    patterns: [
      /zdj/i,
      /foto/i,
      /photo/i,
      /film/i,
      /video/i,
      /media/i,
      /galeri/i,
      /image/i,
    ],
  },
];

function suggestCategory(folderName: string): "dokumenty" | "projekty" | "media" | "prywatne" | null {
  for (const rule of CATEGORY_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(folderName)) {
        return rule.category;
      }
    }
  }
  return null;
}

// ============================================
// Service functions
// ============================================

export async function listDriveFolders(
  employeeId: string,
  env: Env,
): Promise<Result<{ folders: DriveFolder[] }>> {
  // 1. Get employee + check OAuth status
  const employee = await getEmployeeById(employeeId);
  if (!employee) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Pracownik nie znaleziony", status: 404 },
    };
  }

  // 2. Decrypt OAuth token
  const encryptedToken = await getDriveOAuthToken(employeeId);
  if (!encryptedToken) {
    return {
      ok: false,
      error: {
        code: "NO_OAUTH_TOKEN",
        message: "Brak autoryzacji Google Drive. Przejdz przez krok 1.",
        status: 401,
      },
    };
  }

  let tokenPayload: { access_token: string; refresh_token: string | null; expiry_date: number };
  try {
    const decrypted = await decrypt(encryptedToken, env.ENCRYPTION_KEY);
    tokenPayload = JSON.parse(decrypted);
  } catch {
    return {
      ok: false,
      error: {
        code: "TOKEN_DECRYPT_FAILED",
        message: "Nie udalo sie odszyfrowac tokenu. Prosimy o ponowna autoryzacje.",
        status: 500,
      },
    };
  }

  // 3. Check if access token is expired and refresh if needed
  let accessToken = tokenPayload.access_token;
  if (Date.now() > tokenPayload.expiry_date && tokenPayload.refresh_token) {
    const refreshResult = await refreshAccessToken(tokenPayload.refresh_token, env);
    if (!refreshResult.ok) {
      return refreshResult;
    }
    accessToken = refreshResult.data.access_token;

    // Update stored token with new access token
    const { encrypt } = await import("@repo/data-ops/encryption");
    const { setDriveOAuthToken } = await import("@repo/data-ops/employee");
    const updatedPayload = {
      ...tokenPayload,
      access_token: accessToken,
      expiry_date: refreshResult.data.expiry_date,
    };
    const encrypted = await encrypt(JSON.stringify(updatedPayload), env.ENCRYPTION_KEY);
    await setDriveOAuthToken(employeeId, encrypted);
  }

  // 4. Fetch top-level folders from Google Drive API
  const driveResponse = await fetch(
    "https://www.googleapis.com/drive/v3/files?" +
      new URLSearchParams({
        q: "'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        fields: "files(id,name,mimeType)",
        pageSize: "100",
        orderBy: "name",
      }),
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!driveResponse.ok) {
    const errorText = await driveResponse.text();
    console.error("Drive API error:", errorText);

    if (driveResponse.status === 401) {
      return {
        ok: false,
        error: {
          code: "OAUTH_EXPIRED",
          message: "Token Google wygasl. Prosimy o ponowna autoryzacje.",
          status: 401,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: "DRIVE_API_ERROR",
        message: "Blad API Google Drive",
        status: 502,
      },
    };
  }

  const driveData = (await driveResponse.json()) as {
    files: Array<{ id: string; name: string; mimeType: string }>;
  };

  // 5. Map folders with auto-suggestions
  const folders: DriveFolder[] = driveData.files.map((file) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    suggestedCategory: suggestCategory(file.name),
  }));

  // 6. Update employee status to in_progress
  if (employee.selectionStatus === "pending") {
    await updateEmployeeSelectionStatus(employeeId, "in_progress");
  }

  return { ok: true, data: { folders } };
}

export async function getSelections(
  employeeId: string,
): Promise<Result<{ data: FolderSelection[]; total: number }>> {
  const selections = await getFolderSelectionsByEmployee(employeeId);
  return { ok: true, data: { data: selections, total: selections.length } };
}

export async function saveSelections(
  employeeId: string,
  selections: FolderSelectionCreateInput[],
  env: Env,
): Promise<Result<FolderSelection[]>> {
  const employee = await getEmployeeById(employeeId);
  if (!employee) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Pracownik nie znaleziony", status: 404 },
    };
  }

  // Replace existing selections (idempotent)
  await deleteFolderSelectionsByEmployee(employeeId);
  const created = await createFolderSelections(employeeId, selections);

  // Mark employee as completed
  await updateEmployeeSelectionStatus(employeeId, "completed");

  // Check if all employees in the deployment are completed
  await checkDeploymentCompletion(employee.deploymentId);

  return { ok: true, data: created };
}

/** When all employees have completed, transition deployment to 'ready'. */
async function checkDeploymentCompletion(deploymentId: string): Promise<void> {
  const allEmployees = await getEmployeesByDeployment(deploymentId);

  const allCompleted = allEmployees.every(
    (emp) => emp.selectionStatus === "completed",
  );

  if (allCompleted && allEmployees.length > 0) {
    await updateDeploymentStatus(deploymentId, "ready");
  }
}

/** Refresh an expired Google access token using the refresh token. */
async function refreshAccessToken(
  refreshToken: string,
  env: Env,
): Promise<Result<{ access_token: string; expiry_date: number }>> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: "TOKEN_REFRESH_FAILED",
        message: "Nie udalo sie odswiezyc tokenu Google. Prosimy o ponowna autoryzacje.",
        status: 401,
      },
    };
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    ok: true,
    data: {
      access_token: data.access_token,
      expiry_date: Date.now() + data.expires_in * 1000,
    },
  };
}
```

### Update `apps/data-service/src/hono/app.ts`

```ts
import folderHandlers from "./handlers/folder-handlers";

// Add to route registration:
App.route("/folders", folderHandlers);
```

### Endpoint summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/folders/drive/:employeeId` | Public (token-gated in UI) | List Drive top-level folders |
| `GET` | `/folders/selections/:employeeId` | Public | Get existing folder selections |
| `POST` | `/folders/selections` | Public | Save folder selections |

## UI Pages & Components

### Update: `apps/user-application/src/routes/employee/$token.tsx`

Replace the placeholder steps 2-4 with real folder selection UI:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/employee/$token")({
  component: EmployeeFlow,
});

// Category metadata for display
const CATEGORY_INFO: Record<string, { label: string; description: string }> = {
  dokumenty: {
    label: "Dokumenty",
    description: "Faktury, umowy, ksiegowosc",
  },
  projekty: {
    label: "Projekty",
    description: "Dokumentacja projektowa",
  },
  media: {
    label: "Media",
    description: "Zdjecia, filmy",
  },
  prywatne: {
    label: "Prywatne (pomijane)",
    description: "Nie bedzie backupowane",
  },
};

interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
  suggestedCategory: string | null;
}

interface FolderWithCategory extends DriveFolder {
  selectedCategory: string;
}

function EmployeeFlow() {
  const { token } = Route.useParams();
  const [currentStep, setCurrentStep] = useState(1);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderWithCategory[]>([]);

  // Steps:
  // 1 = OAuth (from doc 004)
  // 2 = Folder list (fetch + display)
  // 3 = Category tagging
  // 4 = Confirm

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-foreground">
          Grota — Wybor folderow
        </h1>

        <div className="flex gap-2">
          {[1, 2, 3, 4].map((step) => (
            <div
              key={step}
              className={`h-2 flex-1 rounded ${
                step <= currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {currentStep === 1 && (
          <DriveOAuthStep
            token={token}
            onNext={(resolvedEmployeeId) => {
              setEmployeeId(resolvedEmployeeId);
              setCurrentStep(2);
            }}
          />
        )}
        {currentStep === 2 && employeeId && (
          <FolderListStep
            employeeId={employeeId}
            onFoldersLoaded={(loaded) => {
              setFolders(loaded);
              setCurrentStep(3);
            }}
          />
        )}
        {currentStep === 3 && employeeId && (
          <CategoryTaggingStep
            folders={folders}
            onFoldersUpdated={setFolders}
            onNext={() => setCurrentStep(4)}
          />
        )}
        {currentStep === 4 && employeeId && (
          <ConfirmStep
            employeeId={employeeId}
            folders={folders}
          />
        )}
      </div>
    </div>
  );
}

// Step 1: OAuth (from doc 004 -- DriveOAuthStep remains the same)
function DriveOAuthStep({
  token,
  onNext,
}: { token: string; onNext: (employeeId: string) => void }) {
  // ... same as doc 004 implementation
  // After OAuth success, resolve employeeId from token and call onNext(employeeId)
  return null; // Implementation from doc 004
}

// Step 2: Fetch and display Drive folders
function FolderListStep({
  employeeId,
  onFoldersLoaded,
}: {
  employeeId: string;
  onFoldersLoaded: (folders: FolderWithCategory[]) => void;
}) {
  const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;

  const foldersQuery = useQuery({
    queryKey: ["drive-folders", employeeId],
    queryFn: async () => {
      const response = await fetch(
        `${dataServiceUrl}/folders/drive/${employeeId}`,
      );
      if (!response.ok) throw new Error("Nie udalo sie pobrac folderow");
      return response.json() as Promise<{ folders: DriveFolder[] }>;
    },
  });

  useEffect(() => {
    if (foldersQuery.data) {
      const withCategories = foldersQuery.data.folders.map((f) => ({
        ...f,
        selectedCategory: f.suggestedCategory ?? "prywatne",
      }));
      onFoldersLoaded(withCategories);
    }
  }, [foldersQuery.data, onFoldersLoaded]);

  if (foldersQuery.isPending) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">
            Pobieranie folderow z Google Drive...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (foldersQuery.isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-destructive">{foldersQuery.error.message}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => foldersQuery.refetch()}
          >
            Sprobuj ponownie
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null; // Will auto-advance via useEffect
}

// Step 3: Category tagging UI
function CategoryTaggingStep({
  folders,
  onFoldersUpdated,
  onNext,
}: {
  folders: FolderWithCategory[];
  onFoldersUpdated: (folders: FolderWithCategory[]) => void;
  onNext: () => void;
}) {
  const handleCategoryChange = (folderId: string, category: string) => {
    const updated = folders.map((f) =>
      f.id === folderId ? { ...f, selectedCategory: category } : f,
    );
    onFoldersUpdated(updated);
  };

  const nonPrivateCount = folders.filter(
    (f) => f.selectedCategory !== "prywatne",
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Krok 3: Przypisz kategorie</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          Dla kazdego folderu wybierz kategorie. Foldery oznaczone jako
          "Prywatne" nie beda backupowane.
        </p>

        <div className="space-y-3">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">
                  {folder.name}
                </p>
                {folder.suggestedCategory && (
                  <p className="text-xs text-muted-foreground">
                    Sugerowana: {CATEGORY_INFO[folder.suggestedCategory]?.label}
                  </p>
                )}
              </div>
              <select
                value={folder.selectedCategory}
                onChange={(e) =>
                  handleCategoryChange(folder.id, e.target.value)
                }
                className="rounded border border-input bg-background px-3 py-1.5 text-sm text-foreground"
              >
                {Object.entries(CATEGORY_INFO).map(([value, info]) => (
                  <option key={value} value={value}>
                    {info.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-4">
          <p className="text-sm text-muted-foreground">
            {nonPrivateCount} z {folders.length} folderow do backupu
          </p>
          <Button onClick={onNext} disabled={nonPrivateCount === 0}>
            Dalej
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Step 4: Confirm and save
function ConfirmStep({
  employeeId,
  folders,
}: {
  employeeId: string;
  folders: FolderWithCategory[];
}) {
  const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const selections = folders
        .filter((f) => f.selectedCategory !== "prywatne")
        .map((f) => ({
          folderId: f.id,
          folderName: f.name,
          category: f.selectedCategory,
        }));

      // Also include prywatne folders so we have a complete record
      const allSelections = folders.map((f) => ({
        folderId: f.id,
        folderName: f.name,
        category: f.selectedCategory,
      }));

      const response = await fetch(`${dataServiceUrl}/folders/selections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          selections: allSelections,
        }),
      });

      if (!response.ok) throw new Error("Nie udalo sie zapisac wyboru");
      return response.json();
    },
    onSuccess: () => setSaved(true),
  });

  const categoryCounts = folders.reduce<Record<string, number>>(
    (acc, f) => {
      acc[f.selectedCategory] = (acc[f.selectedCategory] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Krok 4: Potwierdzenie</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {saved ? (
          <div className="text-center space-y-4">
            <p className="text-lg font-medium text-green-600 dark:text-green-400">
              Wybor zapisany pomyslnie.
            </p>
            <p className="text-muted-foreground">
              Dziekujemy! Mozesz zamknac ta strone.
            </p>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground">
              Sprawdz podsumowanie przed zatwierdzeniem:
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(CATEGORY_INFO).map(([category, info]) => {
                const count = categoryCounts[category] ?? 0;
                if (count === 0) return null;
                return (
                  <div
                    key={category}
                    className="rounded-lg border border-border p-3"
                  >
                    <p className="font-medium text-foreground">{info.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {count} {count === 1 ? "folder" : "folderow"}
                    </p>
                  </div>
                );
              })}
            </div>

            {saveMutation.isError && (
              <p className="text-sm text-destructive">
                {saveMutation.error.message}
              </p>
            )}

            <Button
              className="w-full"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Zapisywanie..." : "Zatwierdz wybor"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

### Update operator dashboard detail page

Update `apps/user-application/src/routes/_auth/dashboard/$id.tsx` to show per-employee completion status:

```tsx
// Add an employee status section to the detail page:

function EmployeeStatusSection({ deploymentId }: { deploymentId: string }) {
  // Fetch employees for this deployment
  // Show: name, email, OAuth status, selection status

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pracownicy</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Employee table/list with status badges */}
        {/* Status badges:
          - oauthStatus: pending (gray), authorized (green), failed (red)
          - selectionStatus: pending (gray), in_progress (yellow), completed (green)
        */}
      </CardContent>
    </Card>
  );
}

// Status badge mapping:
const OAUTH_STATUS_LABELS: Record<string, string> = {
  pending: "Oczekuje",
  authorized: "Autoryzowany",
  failed: "Blad",
};

const SELECTION_STATUS_LABELS: Record<string, string> = {
  pending: "Oczekuje",
  in_progress: "W trakcie",
  completed: "Ukonczony",
};
```

## Implementation Steps

1. **Create folder-selection domain in data-ops**
   - Create `packages/data-ops/src/folder-selection/` with `table.ts`, `schema.ts`, `queries.ts`, `index.ts`
   - Add `"./folder-selection"` export to `package.json`

2. **Update relations**
   - Add folder selection relations to `drizzle/relations.ts`

3. **Generate migration and build**
   - `pnpm --filter @repo/data-ops drizzle:dev:generate`
   - `pnpm --filter @repo/data-ops drizzle:dev:migrate`
   - `pnpm --filter @repo/data-ops build`

4. **Create folder handlers and service in data-service**
   - Create `hono/handlers/folder-handlers.ts`
   - Create `hono/services/folder-service.ts`
   - Update `hono/app.ts` with `/folders` route

5. **Update employee flow UI**
   - Replace placeholder steps 2-4 in `routes/employee/$token.tsx` with real folder selection UI

6. **Update operator dashboard detail page**
   - Add employee completion status section to `routes/_auth/dashboard/$id.tsx`

7. **Regenerate and verify**
   - `cd apps/user-application && npx @tanstack/router-cli generate`
   - `pnpm run lint:fix && pnpm run lint`

## Environment Variables

No new environment variables. Uses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ENCRYPTION_KEY` from doc 004.

## Manual Test Script

1. Run both dev servers
2. Ensure at least one deployment exists with employees who have authorized Google Drive (from doc 004 testing)
3. **Test folder listing:**
   - Open employee magic link: `/employee/{token}`
   - Complete OAuth step (if not already done)
   - Step 2 should auto-fetch and display top-level Drive folders
   - Verify folders match what's in the employee's Google Drive root
4. **Test auto-suggestion:**
   - If the employee has a folder named "Faktury" -- should suggest "Dokumenty"
   - If the employee has a folder named "Projekty" -- should suggest "Projekty"
   - If the employee has a folder named "Film" or "Zdjecia" -- should suggest "Media"
   - Folders without matches should default to "Prywatne"
5. **Test category selection:**
   - Step 3: change some categories using the dropdown
   - Verify counter updates ("X z Y folderow do backupu")
   - Mark at least one folder as non-prywatne to enable "Dalej" button
6. **Test confirmation:**
   - Step 4: review summary, verify counts per category
   - Click "Zatwierdz wybor"
   - Should show success message: "Wybor zapisany pomyslnie"
   - Verify in DB: `folder_selections` rows created for this employee
7. **Test employee status progression:**
   - Employee `selection_status` should be "completed" in DB
   - Employee `oauth_status` should be "authorized"
8. **Test deployment auto-transition:**
   - Complete folder selection for ALL employees in a deployment
   - Deployment `status` should auto-transition to "ready"
   - Verify on operator dashboard detail page: status badge shows "Gotowe"
9. **Test operator dashboard:**
   - Open deployment detail page
   - Should show employee list with:
     - Name, email
     - OAuth status badge (Autoryzowany/Oczekuje)
     - Selection status badge (Ukonczony/W trakcie/Oczekuje)
   - Should show completion count: "X/Y pracownikow ukonczylo"
