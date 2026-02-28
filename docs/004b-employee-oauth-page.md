# 004b: Employee Token Queries & OAuth Page

## Goal

Add employee-specific token queries in data-ops and create the employee OAuth page in user-application -- enabling end-to-end browser testing of employee Google Drive authorization via magic link.

## Prerequisites

- Doc 003b (Employee CRUD, Wizard Step 4 & Status Page)
- Doc 004a (Encryption, OAuth Backend & Admin Consent Step)

## Scope

### IN

- `drive_oauth_token` column on employees table (already defined in doc 003b schema but unused)
- Employee token queries: `setDriveOAuthToken`, `getDriveOAuthToken`
- Employee OAuth page: `/employee/$token` with trust panel + Google Drive consent button
- Step progress bar (4 steps -- steps 2-4 are placeholders for doc 005)

### OUT

- Google Drive API folder listing (doc 005)
- Folder selection UI (doc 005)
- Category tagging (doc 005)
- Config export (doc 006)

## Data Model Changes

No new tables or columns. Uses existing:

- `employees.drive_oauth_token` -- already defined in doc 003b as `text` (nullable). Stores encrypted JSON: `{ access_token, refresh_token, scope, token_type, expiry_date }`.
- `employees.oauth_status` -- already defined in doc 003b. Updated to `"authorized"` on successful OAuth.

### New file: `packages/data-ops/src/employee/token-queries.ts`

Queries for encrypted token storage/retrieval on employees:

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import { employees } from "./table";

export async function setDriveOAuthToken(
  employeeId: string,
  encryptedToken: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(employees)
    .set({
      driveOauthToken: encryptedToken,
      oauthStatus: "authorized",
    })
    .where(eq(employees.id, employeeId));
}

export async function getDriveOAuthToken(
  employeeId: string,
): Promise<string | null> {
  const db = getDb();
  const result = await db
    .select({ driveOauthToken: employees.driveOauthToken })
    .from(employees)
    .where(eq(employees.id, employeeId));
  return result[0]?.driveOauthToken ?? null;
}
```

Update barrel export in `employee/index.ts` to include the new token query functions.

## UI Pages & Components

### New file: `apps/user-application/src/routes/employee/$token.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/employee/$token")({
  component: EmployeeFlow,
});

function EmployeeFlow() {
  const { token } = Route.useParams();
  // Steps: 1 = OAuth authorization, 2 = Folder list (doc 005), 3 = Category tagging (doc 005), 4 = Confirm (doc 005)
  const [currentStep, setCurrentStep] = useState(1);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-foreground">
          Grota — Autoryzacja Drive
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
            onNext={() => setCurrentStep(2)}
          />
        )}
        {currentStep >= 2 && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">
                Autoryzacja zakonczona. Wybor folderow zostanie udostepniony wkrotce.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function DriveOAuthStep({
  token,
  onNext,
}: { token: string; onNext: () => void }) {
  const [oauthCompleted, setOauthCompleted] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth") === "success") {
      setOauthCompleted(true);
    }
  }, []);

  const handleAuthorize = () => {
    // Need to resolve employeeId from token first via API
    // Then redirect to OAuth initiation
    const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
    // The token verification returns employeeId -- fetch it first
    window.location.href = `${dataServiceUrl}/api/oauth/google/authorize?type=employee&id=${token}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Krok 1: Autoryzacja Google Drive</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Trust panel */}
        <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
          <p className="font-medium text-foreground">Co zobaczy aplikacja:</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            <li>Nazwy folderow najwyzszego poziomu</li>
          </ul>
          <p className="font-medium text-foreground">Czego NIE zobaczy:</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            <li>Tresci plikow</li>
            <li>Plikow wewnatrz folderow</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Mozesz cofnac dostep w dowolnym momencie w ustawieniach Google
            (myaccount.google.com/permissions).
          </p>
        </div>

        {oauthCompleted ? (
          <div className="space-y-2">
            <p className="text-sm text-green-600 dark:text-green-400">
              Autoryzacja zakonczona pomyslnie.
            </p>
            <Button onClick={onNext}>Dalej</Button>
          </div>
        ) : (
          <Button onClick={handleAuthorize}>Autoryzuj Google Drive</Button>
        )}
      </CardContent>
    </Card>
  );
}
```

## Implementation Steps

1. **Create employee token queries in data-ops**
   - Create `packages/data-ops/src/employee/token-queries.ts`
   - Update barrel export in `employee/index.ts`

2. **Build data-ops**
   - `pnpm --filter @repo/data-ops build`

3. **Create employee OAuth page**
   - Create `apps/user-application/src/routes/employee/$token.tsx`

4. **Regenerate and verify**
   - `cd apps/user-application && npx @tanstack/router-cli generate`
   - `pnpm run lint:fix && pnpm run lint`

## Manual Test Script

1. Ensure doc 004a is fully implemented and GCP OAuth app is configured
2. Run both dev servers
3. **Test employee OAuth:**
   - From the onboarding wizard, create an employee (via doc 003b)
   - Open employee magic link: `/employee/{token}`
   - Should see step progress bar (step 1 active)
   - Should see trust panel listing what the app will/won't see
   - Click "Autoryzuj Google Drive"
   - Should redirect to Google consent screen (Drive readonly scope)
   - Grant access
   - Should redirect back with `?oauth=success`
   - Should see success message + "Dalej" button
   - Verify token in DB: `SELECT drive_oauth_token, oauth_status FROM employees WHERE id = '{id}'`
   - Token should be encrypted (hex format with colon separator)
   - `oauth_status` should be `"authorized"`
4. **Test error case:**
   - Click "Autoryzuj" then deny consent on Google -> should redirect with error
