# 005a: Folder Schema & Drive Listing

## Goal

Create the `folder_selections` data model and enable employees to fetch and view their Google Drive top-level folders with auto-suggested categories (employee flow step 2).

## Prerequisites

- Doc 001 (Bootstrap & Cleanup)
- Doc 002a/b (Operator Deployment CRUD)
- Doc 003a/b (Client Onboarding Wizard)
- Doc 004a/b (Google OAuth & Encryption)

## Scope

### IN

- `folder_selections` table in data-ops (resolves **B9** -- no `size_bytes`)
- Zod schemas for folder selections and Drive folder responses
- Folder selection CRUD queries in data-ops
- Google Drive API integration: list top-level folders via `fetch`
- Auto-suggestion: match folder name to category
- `GET /folders/drive/:employeeId` endpoint (decrypt token, call Drive API, return folders)
- Employee flow step 2: fetch and display folder list with loading/error states
- Employee status update: `pending` -> `in_progress` on first folder fetch

### OUT

- Category tagging UI (doc 005b)
- Folder selection save/confirm (doc 005b)
- Deployment auto-transition (doc 005b)
- Operator dashboard employee status (doc 005b)
- Google Drive file contents or nested folder traversal
- Folder size calculation (removed from MVP -- resolves **B9**)

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
import { EmployeeIdParamSchema } from "@repo/data-ops/employee";
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
  zValidator("param", EmployeeIdParamSchema),
  async (c) => {
    const { employeeId } = c.req.valid("param");
    return resultToResponse(
      c,
      await folderService.listDriveFolders(employeeId, c.env),
    );
  },
);

export default folderHandlers;
```

### New file: `apps/data-service/src/hono/services/folder-service.ts`

```ts
import { decrypt } from "@repo/data-ops/encryption";
import { getDriveOAuthToken } from "@repo/data-ops/employee";
import { getEmployeeById, updateEmployeeSelectionStatus } from "@repo/data-ops/employee";
import type { DriveFolder } from "@repo/data-ops/folder-selection";
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
| `GET` | `/folders/drive/:employeeId` | Public (token-gated in UI) | List Drive top-level folders with auto-suggestions |

## UI Pages & Components

### Update: `apps/user-application/src/routes/employee/$token.tsx`

Add step 2 (folder fetching) to the existing employee flow. Step 1 (OAuth) is from doc 004b. Steps 3-4 will be placeholder cards pointing to doc 005b.

```tsx
// Add to existing imports:
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

// Category metadata for display (used by step 2 loading and later by 005b)
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

// Update EmployeeFlow to add step 2 state and rendering:
function EmployeeFlow() {
  const { token } = Route.useParams();
  const [currentStep, setCurrentStep] = useState(1);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderWithCategory[]>([]);

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
        {currentStep === 3 && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">
                Krok 3: Przypisywanie kategorii (doc 005b)
              </p>
            </CardContent>
          </Card>
        )}
        {currentStep === 4 && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">
                Krok 4: Potwierdzenie (doc 005b)
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
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

4. **Create folder service in data-service**
   - Create `hono/services/folder-service.ts` (only `listDriveFolders` + `refreshAccessToken` + `suggestCategory`)
   - Create `hono/handlers/folder-handlers.ts` (only `GET /drive/:employeeId`)
   - Update `hono/app.ts` with `/folders` route

5. **Update employee flow UI**
   - Add `FolderListStep` component to `routes/employee/$token.tsx`
   - Wire step 2 into the existing step flow
   - Add placeholder cards for steps 3-4

6. **Regenerate and verify**
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
   - Verify loading spinner appears while fetching
   - Verify folders match what's in the employee's Google Drive root
4. **Test auto-suggestion:**
   - If the employee has a folder named "Faktury" -- should suggest "Dokumenty"
   - If the employee has a folder named "Projekty" -- should suggest "Projekty"
   - If the employee has a folder named "Film" or "Zdjecia" -- should suggest "Media"
   - Folders without matches should default to "Prywatne"
5. **Test error handling:**
   - With an invalid/expired token: should show error message and retry button
   - Retry button should re-attempt the fetch
6. **Test employee status update:**
   - After step 2 loads, employee `selection_status` should be "in_progress" in DB
7. **Test auto-advance:**
   - After folders load, the flow should auto-advance to step 3 (placeholder card)
