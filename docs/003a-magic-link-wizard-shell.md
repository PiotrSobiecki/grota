# 003a: Magic Link & Wizard Shell (Steps 1-3)

## Goal

Set up the employee data model, magic-link utilities, admin magic link generation from the deployment detail page, and the onboarding wizard shell with steps 1-3 -- covering the full vertical slice from data-ops through data-service to user-application.

> Replaces the first half of the original doc 003. Doc 003b depends on this doc for the employee table, magic-link utilities, and wizard route.

## Prerequisites

- Doc 001 (Bootstrap & Cleanup)
- Doc 002a (Deployment Schema, Create & List)
- Doc 002b (Deployment Detail & Update)

## Scope

### IN

- `employees` table in data-ops (without `drive_oauth_token` -- that is doc 004)
- Magic link token utilities: generate, verify, expire (resolves **B2**)
- Magic link expiry: 7 days, resendable (resolves **B8**)
- Resend email integration for magic link delivery (admin emails only in this doc)
- `onboardingStep` column on deployments table (resolves **C3** partially)
- `adminMagicLinkToken` and `adminMagicLinkExpiresAt` columns on deployments table
- Admin magic link generation + verification API endpoints
- Operator triggers magic link generation from deployment detail page
- Client admin wizard route: `/onboard/$token` with steps 1-3 (step 2 is OAuth placeholder for doc 004, step 4 is employee list in doc 003b)
- Deployment status transition: `draft` -> `onboarding` (on link generation)
- Remove `/magic/{token}` route -- links go directly to `/onboard/$token` (resolves **B11** partially)

### OUT

- Employee CRUD endpoints (doc 003b)
- Wizard step 4: employee list form (doc 003b)
- Status page `/status/$token` (doc 003b)
- Employee magic link generation/resend (doc 003b)
- Google OAuth consent step (doc 004)
- Employee Google Drive authorization (doc 004)
- `drive_oauth_token` column on employees (doc 004)
- Folder selection (doc 005)
- Config export (doc 006)

## Decisions

| Blocker | Decision |
|---------|----------|
| **B2** (magic link mechanism) | **Custom tokens, not Better Auth plugin.** Generate 64-char hex random token with `crypto.getRandomValues()`, store in DB, verify in route loader. Client admins and employees do not get Better Auth sessions -- they are identified solely by token validity. |
| **B8** (magic link expiry) | **7-day expiry.** On generation, set `expires_at = now + 7 days`. Resending generates a new token and invalidates the old one. |
| **B11** (`/magic/{token}` route) | **Removed.** Magic links are type-specific URLs: operator generates `/onboard/{token}` for client admin. No ambiguous routing. |
| **C3** (wizard persistence) | Wizard state persisted in DB per step. Each wizard step writes its data on completion. Client admin can close the browser and resume via the same token. The `onboarding_step` field on deployments tracks progress (1-4). |

## Data Model Changes

### New file: `packages/data-ops/src/employee/table.ts`

```ts
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { deployments } from "../deployment/table";

export const employeeRoleEnum = pgEnum("employee_role", [
  "zarzad",
  "ksiegowosc",
  "projekty",
  "media",
]);

export const oauthStatusEnum = pgEnum("oauth_status", [
  "pending",
  "authorized",
  "failed",
]);

export const selectionStatusEnum = pgEnum("selection_status", [
  "pending",
  "in_progress",
  "completed",
]);

export const employees = pgTable("employees", {
  id: uuid("id").defaultRandom().primaryKey(),
  deploymentId: uuid("deployment_id")
    .notNull()
    .references(() => deployments.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: employeeRoleEnum("role").notNull(),
  oauthStatus: oauthStatusEnum("oauth_status").notNull().default("pending"),
  selectionStatus: selectionStatusEnum("selection_status").notNull().default("pending"),

  // OAuth token added in doc 004 (encrypted)
  driveOauthToken: text("drive_oauth_token"),

  // Magic link
  magicLinkToken: text("magic_link_token"),
  magicLinkExpiresAt: timestamp("magic_link_expires_at"),
  magicLinkSentAt: timestamp("magic_link_sent_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
```

### New file: `packages/data-ops/src/employee/schema.ts`

```ts
import { z } from "zod";

// ============================================
// Enums
// ============================================

export const EmployeeRoleSchema = z.enum(["zarzad", "ksiegowosc", "projekty", "media"]);
export const OAuthStatusSchema = z.enum(["pending", "authorized", "failed"]);
export const SelectionStatusSchema = z.enum(["pending", "in_progress", "completed"]);

// ============================================
// Domain Model
// ============================================

export const EmployeeSchema = z.object({
  id: z.string().uuid(),
  deploymentId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: EmployeeRoleSchema,
  oauthStatus: OAuthStatusSchema,
  selectionStatus: SelectionStatusSchema,
  driveOauthToken: z.string().nullable(),
  magicLinkToken: z.string().nullable(),
  magicLinkExpiresAt: z.coerce.date().nullable(),
  magicLinkSentAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ============================================
// Request Schemas
// ============================================

export const EmployeeCreateRequestSchema = z.object({
  email: z.string().email("Nieprawidlowy format email"),
  name: z
    .string()
    .min(1, "Imie i nazwisko jest wymagane")
    .max(100, "Maksymalnie 100 znakow"),
  role: EmployeeRoleSchema,
});

export const EmployeeBulkCreateRequestSchema = z.object({
  deploymentId: z.string().uuid(),
  employees: z
    .array(EmployeeCreateRequestSchema)
    .min(1, "Przynajmniej jeden pracownik jest wymagany"),
});

// ============================================
// Response Schemas
// ============================================

/** Public employee response -- excludes magic link token and OAuth tokens */
export const EmployeeResponseSchema = EmployeeSchema.omit({
  magicLinkToken: true,
  driveOauthToken: true,
});

export const EmployeeListResponseSchema = z.object({
  data: z.array(EmployeeResponseSchema),
  total: z.number(),
});

// ============================================
// Types
// ============================================

export type EmployeeRole = z.infer<typeof EmployeeRoleSchema>;
export type OAuthStatus = z.infer<typeof OAuthStatusSchema>;
export type SelectionStatus = z.infer<typeof SelectionStatusSchema>;
export type Employee = z.infer<typeof EmployeeSchema>;
export type EmployeeCreateInput = z.infer<typeof EmployeeCreateRequestSchema>;
export type EmployeeBulkCreateInput = z.infer<typeof EmployeeBulkCreateRequestSchema>;
export type EmployeeResponse = z.infer<typeof EmployeeResponseSchema>;
export type EmployeeListResponse = z.infer<typeof EmployeeListResponseSchema>;
```

### New file: `packages/data-ops/src/employee/queries.ts`

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { Employee, EmployeeCreateInput } from "./schema";
import { employees } from "./table";

export async function getEmployeesByDeployment(
  deploymentId: string,
): Promise<Employee[]> {
  const db = getDb();
  return db
    .select()
    .from(employees)
    .where(eq(employees.deploymentId, deploymentId));
}

export async function getEmployeeByToken(
  token: string,
): Promise<Employee | null> {
  const db = getDb();
  const result = await db
    .select()
    .from(employees)
    .where(eq(employees.magicLinkToken, token));
  return result[0] ?? null;
}

export async function getEmployeeById(
  employeeId: string,
): Promise<Employee | null> {
  const db = getDb();
  const result = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId));
  return result[0] ?? null;
}

export async function createEmployees(
  deploymentId: string,
  data: EmployeeCreateInput[],
): Promise<Employee[]> {
  const db = getDb();
  const values = data.map((emp) => ({
    deploymentId,
    email: emp.email,
    name: emp.name,
    role: emp.role,
  }));
  return db.insert(employees).values(values).returning();
}

export async function updateEmployeeMagicLink(
  employeeId: string,
  token: string,
  expiresAt: Date,
): Promise<Employee | null> {
  const db = getDb();
  const result = await db
    .update(employees)
    .set({
      magicLinkToken: token,
      magicLinkExpiresAt: expiresAt,
      magicLinkSentAt: new Date(),
    })
    .where(eq(employees.id, employeeId))
    .returning();
  return result[0] ?? null;
}

export async function updateEmployeeOAuthStatus(
  employeeId: string,
  status: "pending" | "authorized" | "failed",
): Promise<Employee | null> {
  const db = getDb();
  const result = await db
    .update(employees)
    .set({ oauthStatus: status })
    .where(eq(employees.id, employeeId))
    .returning();
  return result[0] ?? null;
}

export async function updateEmployeeSelectionStatus(
  employeeId: string,
  status: "pending" | "in_progress" | "completed",
): Promise<Employee | null> {
  const db = getDb();
  const result = await db
    .update(employees)
    .set({ selectionStatus: status })
    .where(eq(employees.id, employeeId))
    .returning();
  return result[0] ?? null;
}
```

### New file: `packages/data-ops/src/employee/index.ts`

```ts
export {
  createEmployees,
  getEmployeeById,
  getEmployeeByToken,
  getEmployeesByDeployment,
  updateEmployeeMagicLink,
  updateEmployeeOAuthStatus,
  updateEmployeeSelectionStatus,
} from "./queries";
export type {
  Employee,
  EmployeeBulkCreateInput,
  EmployeeCreateInput,
  EmployeeListResponse,
  EmployeeResponse,
  EmployeeRole,
  OAuthStatus,
  SelectionStatus,
} from "./schema";
export {
  EmployeeBulkCreateRequestSchema,
  EmployeeCreateRequestSchema,
  EmployeeListResponseSchema,
  EmployeeResponseSchema,
  EmployeeRoleSchema,
  EmployeeSchema,
  OAuthStatusSchema,
  SelectionStatusSchema,
} from "./schema";
export {
  employeeRoleEnum,
  employees,
  oauthStatusEnum,
  selectionStatusEnum,
} from "./table";
```

### New file: `packages/data-ops/src/magic-link/index.ts`

Magic link token utilities (resolves **B2**):

```ts
/** Generate a cryptographically random 64-char hex token. */
export function generateMagicLinkToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Default expiry: 7 days from now. */
export function getMagicLinkExpiry(daysFromNow = 7): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + daysFromNow);
  return expiry;
}

/** Check if a token is still valid (not expired). */
export function isMagicLinkValid(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return new Date() < expiresAt;
}

/** Rate limit check: at least 5 minutes since last send. */
export function canResendMagicLink(sentAt: Date | null): boolean {
  if (!sentAt) return true;
  const fiveMinutesAgo = new Date();
  fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
  return sentAt < fiveMinutesAgo;
}
```

### Update `packages/data-ops/package.json` exports

```jsonc
{
  "exports": {
    "./deployment": { "types": "./dist/deployment/index.d.ts", "default": "./dist/deployment/index.js" },
    "./employee": { "types": "./dist/employee/index.d.ts", "default": "./dist/employee/index.js" },
    "./magic-link": { "types": "./dist/magic-link/index.d.ts", "default": "./dist/magic-link/index.js" },
    // ... existing exports
  }
}
```

### Add columns to deployments table

Update `packages/data-ops/src/deployment/table.ts`:

```ts
import { integer } from "drizzle-orm/pg-core";

// Add to deployments table definition:
onboardingStep: integer("onboarding_step").notNull().default(0),
adminMagicLinkToken: text("admin_magic_link_token"),
adminMagicLinkExpiresAt: timestamp("admin_magic_link_expires_at"),
```

Update deployment Zod schema and types to include these new fields.

### Update `packages/data-ops/src/drizzle/relations.ts`

```ts
import { relations } from "drizzle-orm/relations";
import { auth_user } from "./auth-schema";
import { deployments } from "../deployment/table";
import { employees } from "../employee/table";

export const deploymentRelations = relations(deployments, ({ one, many }) => ({
  operator: one(auth_user, {
    fields: [deployments.createdBy],
    references: [auth_user.id],
  }),
  employees: many(employees),
}));

export const employeeRelations = relations(employees, ({ one }) => ({
  deployment: one(deployments, {
    fields: [employees.deploymentId],
    references: [deployments.id],
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

### New file: `apps/data-service/src/hono/handlers/magic-link-handlers.ts`

Only admin-related endpoints in this doc:

```ts
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authMiddleware } from "../middleware/auth";
import * as magicLinkService from "../services/magic-link-service";
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

const magicLinkHandlers = new Hono<{ Bindings: Env }>();

// Generate admin magic link for a deployment (operator action)
magicLinkHandlers.post(
  "/admin/:deploymentId",
  (c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
  zValidator("param", z.object({ deploymentId: z.string().uuid() })),
  async (c) => {
    const { deploymentId } = c.req.valid("param");
    return resultToResponse(
      c,
      await magicLinkService.generateAdminMagicLink(deploymentId, c.env),
    );
  },
);

// Verify admin token (public -- no auth required)
magicLinkHandlers.get(
  "/verify/admin/:token",
  zValidator("param", z.object({ token: z.string().min(1) })),
  async (c) => {
    const { token } = c.req.valid("param");
    return resultToResponse(c, await magicLinkService.verifyAdminToken(token));
  },
);

export default magicLinkHandlers;
```

### New file: `apps/data-service/src/hono/services/magic-link-service.ts`

Only admin-related service functions in this doc:

```ts
import { getDeployment, updateDeploymentStatus } from "@repo/data-ops/deployment";
import { generateMagicLinkToken, getMagicLinkExpiry, isMagicLinkValid } from "@repo/data-ops/magic-link";
import type { Result } from "../types/result";

interface MagicLinkResult {
  token: string;
  url: string;
}

export async function generateAdminMagicLink(
  deploymentId: string,
  env: Env,
): Promise<Result<MagicLinkResult>> {
  const deployment = await getDeployment(deploymentId);
  if (!deployment) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Wdrozenie nie znalezione", status: 404 },
    };
  }

  if (!deployment.adminEmail) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Email administratora klienta jest wymagany",
        status: 400,
        field: "adminEmail",
      },
    };
  }

  const token = generateMagicLinkToken();
  const expiresAt = getMagicLinkExpiry(7);

  // Direct DB update for admin token fields
  const { getDb } = await import("@repo/data-ops/database/setup");
  const { eq } = await import("drizzle-orm");
  const { deployments } = await import("@repo/data-ops/deployment");
  const db = getDb();
  await db
    .update(deployments)
    .set({
      adminMagicLinkToken: token,
      adminMagicLinkExpiresAt: expiresAt,
    })
    .where(eq(deployments.id, deploymentId));

  // Transition status to onboarding
  if (deployment.status === "draft") {
    await updateDeploymentStatus(deploymentId, "onboarding");
  }

  // Send email via Resend
  await sendMagicLinkEmail(
    deployment.adminEmail,
    deployment.adminName ?? "Administrator",
    token,
    "onboard",
    env,
  );

  return {
    ok: true,
    data: {
      token,
      url: `/onboard/${token}`,
    },
  };
}

export async function verifyAdminToken(
  token: string,
): Promise<Result<{ deploymentId: string; step: number }>> {
  const { getDb } = await import("@repo/data-ops/database/setup");
  const { eq } = await import("drizzle-orm");
  const { deployments } = await import("@repo/data-ops/deployment");
  const db = getDb();

  const result = await db
    .select()
    .from(deployments)
    .where(eq(deployments.adminMagicLinkToken, token));

  const deployment = result[0];
  if (!deployment) {
    return {
      ok: false,
      error: { code: "INVALID_TOKEN", message: "Nieprawidlowy lub wygasly link", status: 401 },
    };
  }

  if (!isMagicLinkValid(deployment.adminMagicLinkExpiresAt)) {
    return {
      ok: false,
      error: { code: "TOKEN_EXPIRED", message: "Link wygasl. Popros operatora o nowy.", status: 401 },
    };
  }

  return {
    ok: true,
    data: {
      deploymentId: deployment.id,
      step: deployment.onboardingStep ?? 0,
    },
  };
}

/** Send magic link email via Resend API. */
export async function sendMagicLinkEmail(
  to: string,
  name: string,
  token: string,
  type: "onboard" | "employee",
  env: Env,
): Promise<void> {
  const baseUrl = env.ALLOWED_ORIGINS?.split(",")[0] ?? "http://localhost:3000";
  const path = type === "onboard" ? `/onboard/${token}` : `/employee/${token}`;
  const url = `${baseUrl}${path}`;

  const subject =
    type === "onboard"
      ? "Grota: Rozpocznij onboarding"
      : "Grota: Autoryzuj dostep do Google Drive";

  const html = `
    <p>Czesc ${name},</p>
    <p>${
      type === "onboard"
        ? "Zostales zaproszony do konfiguracji onboardingu w Grota."
        : "Zostales zaproszony do autoryzacji dostepu do Google Drive w Grota."
    }</p>
    <p><a href="${url}">Kliknij tutaj aby rozpoczac</a></p>
    <p>Link wazny przez 7 dni.</p>
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
      subject,
      html,
    }),
  });
}
```

### Update `apps/data-service/src/hono/app.ts`

```ts
import { Hono } from "hono";
import deployments from "./handlers/deployment-handlers";
import health from "./handlers/health-handlers";
import magicLinkHandlers from "./handlers/magic-link-handlers";
import { createCorsMiddleware } from "./middleware/cors";
import { onErrorHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";

export const App = new Hono<{ Bindings: Env }>();

App.use("*", requestId());
App.onError(onErrorHandler);
App.use("*", createCorsMiddleware());

App.route("/health", health);
App.route("/deployments", deployments);
App.route("/magic-links", magicLinkHandlers);
```

### Endpoint summary (this doc only)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/magic-links/admin/:deploymentId` | Bearer | Generate admin magic link |
| `GET` | `/magic-links/verify/admin/:token` | Public | Verify admin token, return deploymentId + step |

## UI Pages & Components

### Update deployment detail page

Update `apps/user-application/src/routes/_auth/dashboard/$id.tsx` to add:

- "Generuj link" button (triggers admin magic link generation via server function -> API call)
- Display generated link URL (copyable) after generation
- Show current deployment status badge reflecting `onboarding` transition

### Route: `apps/user-application/src/routes/onboard/$token.tsx`

Client admin onboarding wizard (steps 1-3 only, step 4 added in doc 003b):

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/onboard/$token")({
  component: OnboardingWizard,
});

function OnboardingWizard() {
  const { token } = Route.useParams();
  // Step management: fetch current step from backend via verify/admin/:token
  // Steps: 1 = Company info, 2 = OAuth (placeholder, doc 004),
  //        3 = Delegate checklist, 4 = Employee list (doc 003b)
  const [currentStep, setCurrentStep] = useState(1);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-foreground">
          Grota — Onboarding
        </h1>

        {/* Step indicator */}
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
          <CompanyInfoStep token={token} onNext={() => setCurrentStep(2)} />
        )}
        {currentStep === 2 && (
          <OAuthPlaceholderStep onNext={() => setCurrentStep(3)} />
        )}
        {currentStep === 3 && (
          <DelegateChecklistStep onNext={() => setCurrentStep(4)} />
        )}
        {currentStep === 4 && (
          <EmployeePlaceholderStep />
        )}
      </div>
    </div>
  );
}

// Step 1: Company info (domain auto-filled from deployment)
function CompanyInfoStep({
  token,
  onNext,
}: { token: string; onNext: () => void }) {
  // Form for additional company details (Workspace info)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Krok 1: Dane firmy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          Potwierdz dane firmy i uzupelnij informacje o Google Workspace.
        </p>
        {/* Form fields: workspace admin email, additional notes */}
        <Button onClick={onNext}>Dalej</Button>
      </CardContent>
    </Card>
  );
}

// Step 2: OAuth placeholder (implemented in doc 004)
function OAuthPlaceholderStep({ onNext }: { onNext: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Krok 2: Autoryzacja Google (wkrotce)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          Ten krok zostanie udostepniony w kolejnej aktualizacji.
          Na razie przejdz dalej.
        </p>
        <Button onClick={onNext}>Dalej</Button>
      </CardContent>
    </Card>
  );
}

// Step 3: Admin delegate checklist
function DelegateChecklistStep({ onNext }: { onNext: () => void }) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Krok 3: Delegat administracyjny</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          Aby przeprowadzic migracje, potrzebujemy dostepu jako delegat
          administracyjny w Twoim Google Workspace.
        </p>
        <ol className="list-decimal list-inside space-y-2 text-foreground">
          <li>Zaloguj sie do Google Admin Console (admin.google.com)</li>
          <li>Przejdz do Konto &rarr; Role administratora</li>
          <li>Dodaj operatora jako delegata z dostepem do katalogu</li>
        </ol>
        <label className="flex items-center gap-2 text-foreground">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="rounded"
          />
          Dodalem/am delegata
        </label>
        <Button onClick={onNext} disabled={!confirmed}>
          Dalej
        </Button>
      </CardContent>
    </Card>
  );
}

// Step 4: Placeholder -- replaced with real employee form in doc 003b
function EmployeePlaceholderStep() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Krok 4: Lista pracownikow (wkrotce)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          Ten krok zostanie udostepniony w kolejnej aktualizacji.
        </p>
      </CardContent>
    </Card>
  );
}
```

## Implementation Steps

1. **Create employee domain in data-ops**
   - Create `packages/data-ops/src/employee/` with `table.ts`, `schema.ts`, `queries.ts`, `index.ts`
   - Add `"./employee"` export to `package.json`

2. **Create magic-link utilities in data-ops**
   - Create `packages/data-ops/src/magic-link/index.ts`
   - Add `"./magic-link"` export to `package.json`

3. **Update deployment table**
   - Add `onboardingStep`, `adminMagicLinkToken`, `adminMagicLinkExpiresAt` columns
   - Update deployment schema and types

4. **Update relations**
   - Add employee relations to `drizzle/relations.ts`

5. **Generate migration and build**
   - `pnpm --filter @repo/data-ops drizzle:dev:generate`
   - `pnpm --filter @repo/data-ops drizzle:dev:migrate`
   - `pnpm --filter @repo/data-ops build`

6. **Create data-service endpoints**
   - Create `handlers/magic-link-handlers.ts` (admin endpoints only)
   - Create `services/magic-link-service.ts` (admin functions + email helper)
   - Update `app.ts` with `/magic-links` route

7. **Create user-application pages**
   - Create `routes/onboard/$token.tsx` (wizard with steps 1-3 + step 4 placeholder)
   - Update `routes/_auth/dashboard/$id.tsx` ("Generuj link" button + link display)

8. **Regenerate and verify**
   - `cd apps/user-application && npx @tanstack/router-cli generate`
   - `pnpm run lint:fix && pnpm run lint`

## Environment Variables

| Variable | Package | Required |
|----------|---------|----------|
| `RESEND_API_KEY` | data-service | Yes -- for sending magic link emails |

The `RESEND_API_KEY` was spec'd in doc 001 but first used here. Must be set in `.dev.vars` (data-service) before testing email delivery.

For local development without Resend, the magic link token is returned in the API response -- copy the `/onboard/{token}` URL manually.

## Manual Test Script

1. Run both dev servers
2. Sign in as operator, navigate to `/_auth/dashboard/`
3. Create a new deployment (if none exists): "FirmaXYZ", domain "firma.pl", admin email "admin@firma.pl", admin name "Jan Kowalski"
4. Open deployment detail page
5. Click "Generuj link" -- should display a URL like `/onboard/abc123...`
6. Deployment status should change to "Onboarding"
7. Copy the URL and open in a new browser tab (or incognito)
8. Should see onboarding wizard with step indicator (1 of 4)
9. **Step 1**: Confirm company info, click "Dalej"
10. **Step 2**: OAuth placeholder, click "Dalej"
11. **Step 3**: Read delegate instructions, check "Dodalem/am delegata", click "Dalej"
12. **Step 4**: Should see placeholder message "Ten krok zostanie udostepniony w kolejnej aktualizacji"
13. Close browser, re-open the same `/onboard/{token}` URL -- wizard should resume at last completed step
