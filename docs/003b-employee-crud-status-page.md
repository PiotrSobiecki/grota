# 003b: Employee CRUD, Wizard Step 4 & Status Page

## Goal

Complete the onboarding wizard with the employee list form (step 4), add employee CRUD endpoints, employee magic link generation/resend with rate limiting, and the client admin status page -- building on the foundation from doc 003a.

## Prerequisites

- Doc 003a (Magic Link & Wizard Shell) must be implemented first.

## Scope

### IN

- Employee list + bulk create API endpoints
- Employee magic link generation (send to all employees in a deployment)
- Single employee magic link resend with 5-minute rate limit (resolves **C4**)
- Employee token verification endpoint
- Wizard step 4: dynamic employee list form with add/remove rows, role dropdown, bulk submit
- Deployment status transition: `onboarding` -> `employees_pending` (on employee list submission)
- Client admin status page: `/status/$token` (resolves **C4**)
- Deployment detail page: employee list section + "Wyslij linki pracownikom" button

### OUT

- Google OAuth consent step (doc 004 -- wizard step 2 remains placeholder)
- Employee Google Drive authorization (doc 004)
- `drive_oauth_token` column on employees (doc 004)
- Folder selection (doc 005)
- Config export (doc 006)

## Decisions

| Blocker | Decision |
|---------|----------|
| **C4** (resend rate limit) | Resend button rate-limited to 1 per 5 minutes per employee. Tracked by `magic_link_sent_at` timestamp on the employees table. Frontend disables button and shows countdown. |

## Data Model Changes

No new tables or columns -- all data model work was done in doc 003a. This doc only adds API endpoints, services, and UI.

## API Endpoints

### Update `apps/data-service/src/hono/handlers/magic-link-handlers.ts`

Add employee-related endpoints to the existing magic-link handlers file from doc 003a:

```ts
// Generate/resend employee magic links for a deployment (operator or system action)
magicLinkHandlers.post(
  "/employees/:deploymentId",
  (c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
  zValidator("param", z.object({ deploymentId: z.string().uuid() })),
  async (c) => {
    const { deploymentId } = c.req.valid("param");
    return resultToResponse(
      c,
      await magicLinkService.generateEmployeeMagicLinks(deploymentId, c.env),
    );
  },
);

// Resend a single employee magic link
magicLinkHandlers.post(
  "/resend/:employeeId",
  zValidator("param", z.object({ employeeId: z.string().uuid() })),
  async (c) => {
    const { employeeId } = c.req.valid("param");
    return resultToResponse(
      c,
      await magicLinkService.resendEmployeeMagicLink(employeeId, c.env),
    );
  },
);

// Verify employee token (public -- no auth required)
magicLinkHandlers.get(
  "/verify/employee/:token",
  zValidator("param", z.object({ token: z.string().min(1) })),
  async (c) => {
    const { token } = c.req.valid("param");
    return resultToResponse(c, await magicLinkService.verifyEmployeeToken(token));
  },
);
```

### Update `apps/data-service/src/hono/services/magic-link-service.ts`

Add employee-related service functions to the existing file from doc 003a:

```ts
import { getEmployeeById, getEmployeesByDeployment, updateEmployeeMagicLink } from "@repo/data-ops/employee";
import { canResendMagicLink } from "@repo/data-ops/magic-link";

export async function generateEmployeeMagicLinks(
  deploymentId: string,
  env: Env,
): Promise<Result<{ sent: number }>> {
  const employeeList = await getEmployeesByDeployment(deploymentId);

  let sent = 0;
  for (const employee of employeeList) {
    const token = generateMagicLinkToken();
    const expiresAt = getMagicLinkExpiry(7);
    await updateEmployeeMagicLink(employee.id, token, expiresAt);
    await sendMagicLinkEmail(employee.email, employee.name, token, "employee", env);
    sent++;
  }

  return { ok: true, data: { sent } };
}

export async function resendEmployeeMagicLink(
  employeeId: string,
  env: Env,
): Promise<Result<{ sent: boolean }>> {
  const employee = await getEmployeeById(employeeId);
  if (!employee) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Pracownik nie znaleziony", status: 404 },
    };
  }

  if (!canResendMagicLink(employee.magicLinkSentAt)) {
    return {
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "Mozna wyslac ponownie za 5 minut",
        status: 429,
      },
    };
  }

  const token = generateMagicLinkToken();
  const expiresAt = getMagicLinkExpiry(7);
  await updateEmployeeMagicLink(employee.id, token, expiresAt);
  await sendMagicLinkEmail(employee.email, employee.name, token, "employee", env);

  return { ok: true, data: { sent: true } };
}

export async function verifyEmployeeToken(
  token: string,
): Promise<Result<{ employeeId: string; deploymentId: string }>> {
  const { getEmployeeByToken } = await import("@repo/data-ops/employee");
  const employee = await getEmployeeByToken(token);

  if (!employee) {
    return {
      ok: false,
      error: { code: "INVALID_TOKEN", message: "Nieprawidlowy lub wygasly link", status: 401 },
    };
  }

  if (!isMagicLinkValid(employee.magicLinkExpiresAt)) {
    return {
      ok: false,
      error: { code: "TOKEN_EXPIRED", message: "Link wygasl. Popros o ponowne wyslanie.", status: 401 },
    };
  }

  return {
    ok: true,
    data: {
      employeeId: employee.id,
      deploymentId: employee.deploymentId,
    },
  };
}
```

### New file: `apps/data-service/src/hono/handlers/employee-handlers.ts`

```ts
import { zValidator } from "@hono/zod-validator";
import { EmployeeBulkCreateRequestSchema } from "@repo/data-ops/employee";
import { z } from "zod";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as employeeService from "../services/employee-service";
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

const employeeHandlers = new Hono<{ Bindings: Env }>();

// List employees for a deployment (public -- token-gated in the frontend)
employeeHandlers.get(
  "/deployment/:deploymentId",
  zValidator("param", z.object({ deploymentId: z.string().uuid() })),
  async (c) => {
    const { deploymentId } = c.req.valid("param");
    return resultToResponse(c, await employeeService.getEmployeesByDeployment(deploymentId));
  },
);

// Bulk create employees (called from onboarding wizard step 4)
employeeHandlers.post(
  "/bulk",
  zValidator("json", EmployeeBulkCreateRequestSchema),
  async (c) => {
    const data = c.req.valid("json");
    return resultToResponse(
      c,
      await employeeService.bulkCreateEmployees(data.deploymentId, data.employees, c.env),
      201,
    );
  },
);

export default employeeHandlers;
```

### New file: `apps/data-service/src/hono/services/employee-service.ts`

```ts
import {
  type Employee,
  type EmployeeCreateInput,
  createEmployees,
  getEmployeesByDeployment as getEmployeesQuery,
} from "@repo/data-ops/employee";
import { updateDeploymentStatus } from "@repo/data-ops/deployment";
import type { Result } from "../types/result";

export async function getEmployeesByDeployment(
  deploymentId: string,
): Promise<Result<{ data: Employee[]; total: number }>> {
  const data = await getEmployeesQuery(deploymentId);
  return { ok: true, data: { data, total: data.length } };
}

export async function bulkCreateEmployees(
  deploymentId: string,
  employeeData: EmployeeCreateInput[],
  env: Env,
): Promise<Result<Employee[]>> {
  const created = await createEmployees(deploymentId, employeeData);

  // Transition deployment status
  await updateDeploymentStatus(deploymentId, "employees_pending");

  return { ok: true, data: created };
}
```

### Update `apps/data-service/src/hono/app.ts`

Add the employee route:

```ts
import employeeHandlers from "./handlers/employee-handlers";

// Add alongside existing routes:
App.route("/employees", employeeHandlers);
```

### Endpoint summary (this doc)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/magic-links/employees/:deploymentId` | Bearer | Send magic links to all employees |
| `POST` | `/magic-links/resend/:employeeId` | Public | Resend single employee link (rate-limited) |
| `GET` | `/magic-links/verify/employee/:token` | Public | Verify employee token |
| `GET` | `/employees/deployment/:deploymentId` | Public | List employees for deployment |
| `POST` | `/employees/bulk` | Public | Bulk create employees (from wizard) |

## UI Pages & Components

### Replace wizard step 4 placeholder in `apps/user-application/src/routes/onboard/$token.tsx`

Replace `EmployeePlaceholderStep` from doc 003a with the real employee list form:

```tsx
// Step 4: Employee list form
function EmployeeListStep({ token }: { token: string }) {
  // Dynamic form: add/remove employee rows
  // Each row: email, name, role (dropdown)
  // On submit: POST /employees/bulk, then transition to confirmation
  return (
    <Card>
      <CardHeader>
        <CardTitle>Krok 4: Lista pracownikow</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          Dodaj pracownikow, ktorzy powinni autoryzowac dostep do Google Drive.
          Kazdy otrzyma link email z instrukcjami.
        </p>
        {/* Dynamic employee row form */}
        {/* Role dropdown: zarzad, ksiegowosc, projekty, media */}
        {/* Add row / remove row buttons */}
        {/* Submit button: "Wyslij" */}
      </CardContent>
    </Card>
  );
}
```

Implementation details:
- Use `@tanstack/react-form` for dynamic row management
- Add row button appends empty row `{ email: "", name: "", role: "projekty" }`
- Remove row button (X icon) removes a row (minimum 1 row)
- Role dropdown with Polish labels: Zarzad, Ksiegowosc, Projekty, Media
- Submit calls `POST /employees/bulk` then shows success state
- On success, deployment status transitions to `employees_pending`

### Route: `apps/user-application/src/routes/status/$token.tsx`

Client admin progress page:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/status/$token")({
  component: StatusPage,
});

function StatusPage() {
  const { token } = Route.useParams();
  // 1. Verify admin token via GET /magic-links/verify/admin/:token
  // 2. Fetch employees via GET /employees/deployment/:deploymentId
  // 3. Display completion count: "X/Y pracownikow ukonczylo"
  // 4. Per-employee row: name, email, oauthStatus badge, "Wyslij ponownie" button
  // 5. "Wyslij ponownie" calls POST /magic-links/resend/:employeeId
  //    - Disabled for 5 min after last send (use magicLinkSentAt)
  //    - Shows rate limit error message on 429

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-foreground">
          Status onboardingu
        </h1>
        {/* Summary card: X/Y completed */}
        {/* Employee list with status badges and resend buttons */}
      </div>
    </div>
  );
}
```

### Update deployment detail page

Update `apps/user-application/src/routes/_auth/dashboard/$id.tsx` to add:

- Employee list section (shows employees with their statuses: name, email, oauthStatus badge)
- "Wyslij linki pracownikom" button (calls `POST /magic-links/employees/:deploymentId` to send magic links to all employees)
- Employee count indicator: "X pracownikow" with link to expand

## Implementation Steps

1. **Create data-service employee endpoints**
   - Create `handlers/employee-handlers.ts`
   - Create `services/employee-service.ts`
   - Update `app.ts` with `/employees` route

2. **Add employee magic link endpoints to magic-link handlers**
   - Add `POST /employees/:deploymentId` handler
   - Add `POST /resend/:employeeId` handler
   - Add `GET /verify/employee/:token` handler
   - Add corresponding service functions to `magic-link-service.ts`

3. **Replace wizard step 4 placeholder**
   - Replace `EmployeePlaceholderStep` with `EmployeeListStep` in `onboard/$token.tsx`
   - Implement dynamic form with add/remove rows
   - Wire up `POST /employees/bulk` submission

4. **Create status page**
   - Create `routes/status/$token.tsx`
   - Implement token verification + employee list fetch
   - Add resend buttons with rate limit feedback

5. **Update deployment detail page**
   - Add employee list section
   - Add "Wyslij linki pracownikom" button

6. **Regenerate and verify**
   - `cd apps/user-application && npx @tanstack/router-cli generate`
   - `pnpm run lint:fix && pnpm run lint`

## Manual Test Script

1. Run both dev servers (assumes doc 003a is already implemented)
2. Sign in as operator, open a deployment that is in `onboarding` status
3. The deployment should already have a magic link from doc 003a testing
4. Open `/onboard/{token}` and navigate to step 4
5. **Step 4**: Add 3 employees:
   - jan@gmail.com, Jan Nowak, ksiegowosc
   - anna@gmail.com, Anna Wisniewska, zarzad
   - piotr@gmail.com, Piotr Zielinski, projekty
6. Click "Wyslij" -- employees created in DB
7. Go back to operator dashboard, open deployment detail
8. Should see 3 employees listed with status "Oczekuje"
9. Deployment status should be "Oczekuje na pracownikow" (`employees_pending`)
10. Click "Wyslij linki pracownikom" -- magic links generated and emails sent
11. Open `/status/{admin-token}` in new tab
12. Should see "0/3 pracownikow ukonczylo" with list of employees
13. Click "Wyslij ponownie" on one employee -- should succeed
14. Click "Wyslij ponownie" again immediately -- should show rate limit message ("Mozna wyslac ponownie za 5 minut")
15. Wait 5 minutes, click again -- should succeed
