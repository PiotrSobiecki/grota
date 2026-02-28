# 003: Client Onboarding Wizard

## Goal

Enable the client admin to receive a magic link, complete a multi-step onboarding wizard, and add employees who then receive their own magic links via email -- covering the `employees` table, magic link mechanism, Resend email integration, and the client admin progress page.

## Prerequisites

- Doc 001 (Bootstrap & Cleanup)
- Doc 002 (Operator Deployment CRUD)

## Scope

### IN

- `employees` table in data-ops (without `drive_oauth_token` -- that is doc 004)
- Magic link token utilities: generate, verify, expire (resolves **B2**)
- Magic link expiry: 7 days, resendable (resolves **B8**)
- Resend email integration for magic link delivery
- Operator triggers magic link generation from deployment detail page
- Client admin wizard route: `/onboard/$token` with steps 1, 3, 4 (step 2 is OAuth in doc 004, step 5 is B2/server config filled by operator on detail page)
- Wizard state persistence in DB per step (resolves **C3**)
- Client admin progress page: `/status/$token` (resolves **C4** with rate limit)
- Remove `/magic/{token}` route -- links go directly to `/onboard/$token` or `/employee/$token` (resolves **B11**)
- Deployment status transitions: `draft` -> `onboarding` (on link generation) and `onboarding` -> `employees_pending` (on employee list submission)

### OUT

- Google OAuth consent step (doc 004 -- wizard step 2 skipped with placeholder)
- Employee Google Drive authorization (doc 004)
- Folder selection (doc 005)
- `drive_oauth_token` column on employees (doc 004)
- Config export (doc 006)

## Decisions

| Blocker | Decision |
|---------|----------|
| **B2** (magic link mechanism) | **Custom tokens, not Better Auth plugin.** Generate 64-char hex random token with `crypto.getRandomValues()`, store in DB, verify in route loader. Client admins and employees do not get Better Auth sessions -- they are identified solely by token validity. |
| **B8** (magic link expiry) | **7-day expiry.** On generation, set `expires_at = now + 7 days`. Resending generates a new token and invalidates the old one. |
| **B11** (`/magic/{token}` route) | **Removed.** Magic links are type-specific URLs: operator generates `/onboard/{token}` for client admin, `/employee/{token}` for employees. No ambiguous routing. |
| **C3** (wizard persistence) | Wizard state persisted in DB per step. Each wizard step writes its data on completion. Client admin can close the browser and resume via the same token. The `onboarding_step` field on deployments tracks progress (1-4). |
| **C4** (resend rate limit) | Resend button rate-limited to 1 per 5 minutes per employee. Tracked by `magic_link_sent_at` timestamp on the employees table. |

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

### Add `onboardingStep` to deployments table

Update `packages/data-ops/src/deployment/table.ts` to add a wizard progress tracker:

```ts
import { integer } from "drizzle-orm/pg-core";

// Add to deployments table definition:
onboardingStep: integer("onboarding_step").notNull().default(0),
```

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

// Verify admin token (public -- no auth required)
magicLinkHandlers.get(
  "/verify/admin/:token",
  zValidator("param", z.object({ token: z.string().min(1) })),
  async (c) => {
    const { token } = c.req.valid("param");
    return resultToResponse(c, await magicLinkService.verifyAdminToken(token));
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

export default magicLinkHandlers;
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

### New file: `apps/data-service/src/hono/services/magic-link-service.ts`

```ts
import { getDeployment, updateDeploymentStatus } from "@repo/data-ops/deployment";
import { getEmployeeById, getEmployeesByDeployment, updateEmployeeMagicLink } from "@repo/data-ops/employee";
import { canResendMagicLink, generateMagicLinkToken, getMagicLinkExpiry, isMagicLinkValid } from "@repo/data-ops/magic-link";
import type { Deployment } from "@repo/data-ops/deployment";
import type { Employee } from "@repo/data-ops/employee";
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

  // Update deployment with admin magic link token
  const { updateDeployment } = await import("@repo/data-ops/deployment");
  await updateDeployment(deploymentId, {});
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

/** Send magic link email via Resend API. */
async function sendMagicLinkEmail(
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

### New file: `apps/data-service/src/hono/services/employee-service.ts`

```ts
import {
  type Employee,
  type EmployeeCreateInput,
  createEmployees,
  getEmployeesByDeployment as getEmployeesQuery,
} from "@repo/data-ops/employee";
import { updateDeploymentStatus } from "@repo/data-ops/deployment";
import { generateMagicLinkToken, getMagicLinkExpiry } from "@repo/data-ops/magic-link";
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

```ts
import { Hono } from "hono";
import deployments from "./handlers/deployment-handlers";
import employeeHandlers from "./handlers/employee-handlers";
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
App.route("/employees", employeeHandlers);
App.route("/magic-links", magicLinkHandlers);
```

### Endpoint summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/magic-links/admin/:deploymentId` | Bearer | Generate admin magic link |
| `POST` | `/magic-links/employees/:deploymentId` | Bearer | Send magic links to all employees |
| `POST` | `/magic-links/resend/:employeeId` | Public | Resend single employee link (rate-limited) |
| `GET` | `/magic-links/verify/admin/:token` | Public | Verify admin token, return deploymentId + step |
| `GET` | `/magic-links/verify/employee/:token` | Public | Verify employee token |
| `GET` | `/employees/deployment/:deploymentId` | Public | List employees for deployment |
| `POST` | `/employees/bulk` | Public | Bulk create employees (from wizard) |

## UI Pages & Components

### Route: `apps/user-application/src/routes/onboard/$token.tsx`

Client admin onboarding wizard:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/onboard/$token")({
  component: OnboardingWizard,
});

function OnboardingWizard() {
  const { token } = Route.useParams();
  // Step management: fetch current step from backend
  // Steps: 1 = Company info, 2 = OAuth (placeholder, doc 004),
  //        3 = Delegate checklist, 4 = Employee list
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
          <EmployeeListStep token={token} />
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

// Step 4: Employee list form
function EmployeeListStep({ token }: { token: string }) {
  // Dynamic form: add/remove employee rows
  // Each row: email, name, role (dropdown)
  // On submit: POST /employees/bulk, then send magic links
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
        {/* Submit button */}
      </CardContent>
    </Card>
  );
}
```

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
  // Verify token, fetch deployment + employee data
  // Show completion count: "X/Y pracownikow ukonczylo"
  // Per-employee: name, email, status, "Wyslij ponownie" button

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-foreground">
          Status onboardingu
        </h1>
        {/* Employee completion list */}
        {/* Resend buttons with 5-min rate limit feedback */}
      </div>
    </div>
  );
}
```

### Update deployment detail page

Update `apps/user-application/src/routes/_auth/dashboard/$id.tsx` to add:

- "Generuj link" button (triggers admin magic link generation)
- Display generated link URL (copyable)
- Employee list section (shows employees with their statuses)
- "Wyslij linki pracownikom" button (sends magic links to all employees)

## Implementation Steps

1. **Create employee domain in data-ops**
   - Create `packages/data-ops/src/employee/` with `table.ts`, `schema.ts`, `queries.ts`, `index.ts`
   - Add `"./employee"` export to `package.json`

2. **Create magic-link utilities in data-ops**
   - Create `packages/data-ops/src/magic-link/index.ts`
   - Add `"./magic-link"` export to `package.json`

3. **Update deployment table**
   - Add `onboardingStep` column to `deployments` table
   - Update deployment schema and types

4. **Update relations**
   - Add employee relations to `drizzle/relations.ts`

5. **Generate migration and build**
   - `pnpm --filter @repo/data-ops drizzle:dev:generate`
   - `pnpm --filter @repo/data-ops drizzle:dev:migrate`
   - `pnpm --filter @repo/data-ops build`

6. **Create data-service endpoints**
   - Create `handlers/magic-link-handlers.ts`
   - Create `handlers/employee-handlers.ts`
   - Create `services/magic-link-service.ts`
   - Create `services/employee-service.ts`
   - Update `app.ts` with new routes

7. **Create user-application pages**
   - Create `routes/onboard/$token.tsx` (wizard)
   - Create `routes/status/$token.tsx` (progress page)
   - Update `routes/_auth/dashboard/$id.tsx` (magic link button, employee list)

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
6. Copy the URL and open in a new browser tab (or incognito)
7. Should see onboarding wizard with step indicator (1 of 4)
8. **Step 1**: Confirm company info, click "Dalej"
9. **Step 2**: OAuth placeholder, click "Dalej"
10. **Step 3**: Read delegate instructions, check "Dodalem/am delegata", click "Dalej"
11. **Step 4**: Add 3 employees:
    - jan@gmail.com, Jan Nowak, ksiegowosc
    - anna@gmail.com, Anna Wisniewska, zarzad
    - piotr@gmail.com, Piotr Zielinski, projekty
12. Click "Wyslij" -- employees created in DB
13. Go back to operator dashboard, open deployment detail
14. Should see 3 employees listed with status "Oczekuje"
15. Deployment status should be "Oczekuje na pracownikow"
16. Open `/status/{admin-token}` in new tab
17. Should see "0/3 pracownikow ukonczylo" with list of employees
18. Click "Wyslij ponownie" on one employee -- should succeed
19. Click "Wyslij ponownie" again immediately -- should show rate limit message
20. Wait 5 minutes, click again -- should succeed
