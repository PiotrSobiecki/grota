# 005b: Folder Tagging, Confirm & Operator Status

## Goal

Enable employees to tag folders by category (step 3), confirm and save selections (step 4), with auto deployment status transition and per-employee completion status on the operator dashboard.

## Prerequisites

- Doc 005a (Folder Schema & Drive Listing)

## Scope

### IN

- `GET /folders/selections/:employeeId` endpoint
- `POST /folders/selections` endpoint (bulk save, replaces existing)
- Employee flow step 3: category tagging UI with dropdowns
- Employee flow step 4: confirm summary and save
- Employee status update: `in_progress` -> `completed` on save
- Auto deployment status transition: when all employees completed -> `employees_pending` -> `ready`
- Operator dashboard detail page: per-employee completion status section

### OUT

- Google Drive file contents or nested folder traversal
- Folder size calculation
- Config export (doc 006)
- Shared Drive operations (Phase 2)

## API Endpoints

### Update: `apps/data-service/src/hono/handlers/folder-handlers.ts`

Add two more routes to the existing folder handlers from doc 005a:

```ts
import { FolderSelectionBulkCreateRequestSchema } from "@repo/data-ops/folder-selection";

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
```

### Update: `apps/data-service/src/hono/services/folder-service.ts`

Add `getSelections`, `saveSelections`, and `checkDeploymentCompletion` to the existing service from doc 005a:

```ts
import { getEmployeesByDeployment } from "@repo/data-ops/employee";
import {
  type FolderSelection,
  type FolderSelectionCreateInput,
  createFolderSelections,
  deleteFolderSelectionsByEmployee,
  getFolderSelectionsByEmployee,
} from "@repo/data-ops/folder-selection";
import { updateDeploymentStatus } from "@repo/data-ops/deployment";

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
```

### Endpoint summary (cumulative with 005a)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/folders/drive/:employeeId` | Public (token-gated in UI) | List Drive top-level folders (005a) |
| `GET` | `/folders/selections/:employeeId` | Public | Get existing folder selections |
| `POST` | `/folders/selections` | Public | Save folder selections |

## UI Pages & Components

### Update: `apps/user-application/src/routes/employee/$token.tsx`

Replace placeholder steps 3-4 with real category tagging and confirm components:

```tsx
// Add to existing imports:
import { useMutation } from "@tanstack/react-query";

// Update EmployeeFlow step 3 and 4 rendering:
// Replace placeholder cards with:
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
      // Include all folders (prywatne included for complete record)
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
        {/* Completion count: "X/Y pracownikow ukonczylo" */}
      </CardContent>
    </Card>
  );
}
```

## Implementation Steps

1. **Add selection endpoints to folder handlers**
   - Add `GET /selections/:employeeId` and `POST /selections` to `folder-handlers.ts`
   - Import `FolderSelectionBulkCreateRequestSchema`

2. **Add save/get services to folder-service**
   - Add `getSelections`, `saveSelections`, `checkDeploymentCompletion` to `folder-service.ts`
   - Import additional queries from data-ops

3. **Replace employee flow step 3-4 placeholders**
   - Replace placeholder cards with `CategoryTaggingStep` and `ConfirmStep` in `routes/employee/$token.tsx`

4. **Add employee status section to operator dashboard**
   - Add `EmployeeStatusSection` component to `routes/_auth/dashboard/$id.tsx`
   - Fetch employees for the deployment and display status badges

5. **Regenerate and verify**
   - `cd apps/user-application && npx @tanstack/router-cli generate`
   - `pnpm run lint:fix && pnpm run lint`

## Environment Variables

No new environment variables.

## Manual Test Script

1. Run both dev servers
2. Ensure doc 005a is implemented and an employee has completed step 2 (folder listing)
3. **Test category tagging (step 3):**
   - After step 2 auto-advances, step 3 should show all folders with dropdowns
   - Each folder shows its name and suggested category (if any)
   - Change some categories using the dropdown
   - Verify counter updates ("X z Y folderow do backupu")
   - If all folders are "Prywatne", "Dalej" button should be disabled
   - Mark at least one folder as non-prywatne to enable "Dalej" button
4. **Test confirmation (step 4):**
   - Click "Dalej" -- step 4 should show summary with counts per category
   - Review category breakdown cards
   - Click "Zatwierdz wybor"
   - Should show success message: "Wybor zapisany pomyslnie"
   - Verify in DB: `folder_selections` rows created for this employee
5. **Test employee status progression:**
   - Employee `selection_status` should be "completed" in DB
6. **Test deployment auto-transition:**
   - Complete folder selection for ALL employees in a deployment
   - Deployment `status` should auto-transition to "ready"
   - Verify on operator dashboard detail page: status badge shows "Gotowe"
7. **Test operator dashboard:**
   - Open deployment detail page
   - Should show employee list with:
     - Name, email
     - OAuth status badge (Autoryzowany/Oczekuje)
     - Selection status badge (Ukonczony/W trakcie/Oczekuje)
   - Should show completion count: "X/Y pracownikow ukonczylo"
8. **Test idempotent save:**
   - Re-open the magic link for the same employee
   - Complete steps again with different category choices
   - Old selections should be replaced (not duplicated)
