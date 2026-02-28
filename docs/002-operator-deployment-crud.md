# 002: Operator Deployment CRUD

## Goal

Enable operators to create and manage deployments through a full vertical slice: Drizzle schema, Hono API endpoints, and TanStack Start dashboard pages.

## Prerequisites

- Doc 001 (Bootstrap & Cleanup) must be implemented first.

## Scope

### IN

- `deployments` table in data-ops with Drizzle + Zod schemas + queries
- Deployment CRUD endpoints in data-service (POST, GET list, GET by id, PUT)
- Operator dashboard pages: list, create form, detail view
- Status enum with documented transition rules
- Client admin fields on deployments table (resolves **B1**)
- `b2_config` JSONB schema (resolves **B5**)
- `server_config` JSONB schema (resolves **B6**)
- Status transition rules (resolves **B7**)

### OUT

- Magic link generation (doc 003)
- Employees table (doc 003)
- Google OAuth (doc 004)
- Config export (doc 006)
- DELETE endpoint for deployments (not needed -- drafts can be edited, active deployments should not be deleted)

## Decisions

| Blocker | Decision |
|---------|----------|
| **B1** (client admin storage) | Add `admin_email`, `admin_name`, `admin_magic_link_token`, `admin_magic_link_expires_at` directly on the `deployments` table. Client admin is not a separate entity -- each deployment has exactly one client admin. |
| **B5** (`b2_config` JSONB) | Schema: `{ key_id: string, app_key: string, bucket_prefix: string }`. Validated with Zod, stored as JSONB. |
| **B6** (`server_config` JSONB) | Schema: `{ backup_path: string, bwlimit: string, ssh_host?: string, ssh_user?: string }`. Validated with Zod, stored as JSONB. |
| **B7** (status transitions) | Five states with explicit transition triggers. See Status Transitions section below. |

## Status Transitions

```
draft ──(operator creates)──> draft
  │
  └──(operator generates magic link)──> onboarding
       │
       └──(client admin submits wizard step 4: employees)──> employees_pending
            │
            └──(all employees completed folder selection)──> ready
                 │
                 └──(operator exports config to R2)──> active
```

**Transition rules:**

| From | To | Trigger | Validation |
|------|----|---------|------------|
| `draft` | `onboarding` | Operator generates magic link (doc 003) | `admin_email` must be set |
| `onboarding` | `employees_pending` | Client admin submits employee list (doc 003) | At least 1 employee created |
| `employees_pending` | `ready` | Last employee completes folder selection (doc 005) | All employees `selection_status = completed` |
| `ready` | `active` | Operator exports config to R2 (doc 006) | Config JSON generated successfully |

**Backward transitions:** Not allowed in MVP. If issues arise, operator can edit deployment details but status only moves forward.

**Initial status:** All new deployments start as `draft`.

## Data Model Changes

### New file: `packages/data-ops/src/deployment/table.ts`

```ts
import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auth_user } from "../drizzle/auth-schema";

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "draft",
  "onboarding",
  "employees_pending",
  "ready",
  "active",
]);

export const deployments = pgTable("deployments", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientName: text("client_name").notNull(),
  domain: text("domain").notNull(),
  status: deploymentStatusEnum("status").notNull().default("draft"),

  // Client admin (resolves B1)
  adminEmail: text("admin_email"),
  adminName: text("admin_name"),
  adminMagicLinkToken: text("admin_magic_link_token"),
  adminMagicLinkExpiresAt: timestamp("admin_magic_link_expires_at"),

  // OAuth token (encrypted, added in doc 004)
  workspaceOauthToken: text("workspace_oauth_token"),

  // Config blobs
  b2Config: jsonb("b2_config"),
  serverConfig: jsonb("server_config"),

  // R2 reference
  r2ConfigKey: text("r2_config_key"),

  // Operator FK
  createdBy: text("created_by")
    .notNull()
    .references(() => auth_user.id, { onDelete: "restrict" }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
```

### New file: `packages/data-ops/src/deployment/schema.ts`

```ts
import { z } from "zod";

// ============================================
// Enums
// ============================================

export const DeploymentStatusSchema = z.enum([
  "draft",
  "onboarding",
  "employees_pending",
  "ready",
  "active",
]);

// ============================================
// JSONB sub-schemas (resolves B5, B6)
// ============================================

export const B2ConfigSchema = z.object({
  key_id: z.string().min(1, "B2 Key ID is required"),
  app_key: z.string().min(1, "B2 App Key is required"),
  bucket_prefix: z.string().min(1, "Bucket prefix is required"),
});

export const ServerConfigSchema = z.object({
  backup_path: z.string().min(1, "Backup path is required"),
  bwlimit: z.string().min(1, "Bandwidth limit is required"),
  ssh_host: z.string().optional(),
  ssh_user: z.string().optional(),
});

// ============================================
// Domain Model
// ============================================

export const DeploymentSchema = z.object({
  id: z.string().uuid(),
  clientName: z.string(),
  domain: z.string(),
  status: DeploymentStatusSchema,
  adminEmail: z.string().email().nullable(),
  adminName: z.string().nullable(),
  adminMagicLinkToken: z.string().nullable(),
  adminMagicLinkExpiresAt: z.coerce.date().nullable(),
  workspaceOauthToken: z.string().nullable(),
  b2Config: B2ConfigSchema.nullable(),
  serverConfig: ServerConfigSchema.nullable(),
  r2ConfigKey: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ============================================
// Request Schemas
// ============================================

export const DeploymentCreateRequestSchema = z.object({
  clientName: z
    .string()
    .min(1, "Nazwa klienta jest wymagana")
    .max(100, "Nazwa klienta moze miec maksymalnie 100 znakow"),
  domain: z
    .string()
    .min(1, "Domena jest wymagana")
    .max(253, "Domena moze miec maksymalnie 253 znaki"),
  adminEmail: z.string().email("Nieprawidlowy format email").optional(),
  adminName: z
    .string()
    .min(1)
    .max(100)
    .optional(),
});

export const DeploymentUpdateRequestSchema = z
  .object({
    clientName: z.string().min(1).max(100).optional(),
    domain: z.string().min(1).max(253).optional(),
    adminEmail: z.string().email().optional(),
    adminName: z.string().min(1).max(100).optional(),
    b2Config: B2ConfigSchema.optional(),
    serverConfig: ServerConfigSchema.optional(),
  })
  .refine(
    (data) =>
      data.clientName ||
      data.domain ||
      data.adminEmail ||
      data.adminName ||
      data.b2Config ||
      data.serverConfig,
    { message: "Przynajmniej jedno pole jest wymagane" },
  );

export const DeploymentIdParamSchema = z.object({
  id: z.string().uuid("Nieprawidlowy format ID"),
});

export const DeploymentListRequestSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  status: DeploymentStatusSchema.optional(),
});

// ============================================
// Response Schemas
// ============================================

/** Public deployment response -- excludes magic link tokens and encrypted OAuth tokens */
export const DeploymentResponseSchema = DeploymentSchema.omit({
  adminMagicLinkToken: true,
  adminMagicLinkExpiresAt: true,
  workspaceOauthToken: true,
});

export const DeploymentListResponseSchema = z.object({
  data: z.array(DeploymentResponseSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

// ============================================
// Types
// ============================================

export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;
export type B2Config = z.infer<typeof B2ConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;
export type DeploymentCreateInput = z.infer<typeof DeploymentCreateRequestSchema>;
export type DeploymentUpdateInput = z.infer<typeof DeploymentUpdateRequestSchema>;
export type DeploymentResponse = z.infer<typeof DeploymentResponseSchema>;
export type DeploymentListResponse = z.infer<typeof DeploymentListResponseSchema>;
export type DeploymentListRequest = z.infer<typeof DeploymentListRequestSchema>;
```

### New file: `packages/data-ops/src/deployment/queries.ts`

```ts
import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type {
  Deployment,
  DeploymentCreateInput,
  DeploymentListRequest,
  DeploymentListResponse,
  DeploymentStatus,
  DeploymentUpdateInput,
} from "./schema";
import { deployments } from "./table";

export async function getDeployment(deploymentId: string): Promise<Deployment | null> {
  const db = getDb();
  const result = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId));
  return result[0] ?? null;
}

export async function getDeployments(
  params: DeploymentListRequest,
  operatorId: string,
): Promise<DeploymentListResponse> {
  const db = getDb();
  const conditions = [eq(deployments.createdBy, operatorId)];

  if (params.status) {
    conditions.push(eq(deployments.status, params.status));
  }

  const whereClause = and(...conditions);

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(deployments)
      .where(whereClause)
      .limit(params.limit)
      .offset(params.offset)
      .orderBy(deployments.createdAt),
    db.select({ total: count() }).from(deployments).where(whereClause),
  ]);

  const total = countResult[0]?.total ?? 0;

  return {
    data,
    pagination: {
      total,
      limit: params.limit,
      offset: params.offset,
      hasMore: params.offset + data.length < total,
    },
  };
}

export async function createDeployment(
  data: DeploymentCreateInput & { createdBy: string },
): Promise<Deployment> {
  const db = getDb();
  const [deployment] = await db
    .insert(deployments)
    .values({
      clientName: data.clientName,
      domain: data.domain,
      adminEmail: data.adminEmail ?? null,
      adminName: data.adminName ?? null,
      createdBy: data.createdBy,
    })
    .returning();
  return deployment!;
}

export async function updateDeployment(
  deploymentId: string,
  data: DeploymentUpdateInput,
): Promise<Deployment | null> {
  const db = getDb();
  const result = await db
    .update(deployments)
    .set(data)
    .where(eq(deployments.id, deploymentId))
    .returning();
  return result[0] ?? null;
}

export async function updateDeploymentStatus(
  deploymentId: string,
  status: DeploymentStatus,
): Promise<Deployment | null> {
  const db = getDb();
  const result = await db
    .update(deployments)
    .set({ status })
    .where(eq(deployments.id, deploymentId))
    .returning();
  return result[0] ?? null;
}
```

### New file: `packages/data-ops/src/deployment/index.ts`

```ts
export {
  createDeployment,
  getDeployment,
  getDeployments,
  updateDeployment,
  updateDeploymentStatus,
} from "./queries";
export type {
  B2Config,
  Deployment,
  DeploymentCreateInput,
  DeploymentListRequest,
  DeploymentListResponse,
  DeploymentResponse,
  DeploymentStatus,
  DeploymentUpdateInput,
  ServerConfig,
} from "./schema";
export {
  B2ConfigSchema,
  DeploymentCreateRequestSchema,
  DeploymentIdParamSchema,
  DeploymentListRequestSchema,
  DeploymentListResponseSchema,
  DeploymentResponseSchema,
  DeploymentSchema,
  DeploymentStatusSchema,
  DeploymentUpdateRequestSchema,
  ServerConfigSchema,
} from "./schema";
export { deployments, deploymentStatusEnum } from "./table";
```

### Update `packages/data-ops/package.json` exports

Add the new deployment export:

```jsonc
{
  "exports": {
    "./deployment": {
      "types": "./dist/deployment/index.d.ts",
      "default": "./dist/deployment/index.js"
    },
    // ... existing exports (health, auth/*, database/*, drizzle/*)
  }
}
```

### Update `packages/data-ops/src/drizzle/relations.ts`

```ts
import { relations } from "drizzle-orm/relations";
import { auth_user } from "./auth-schema";
import { deployments } from "../deployment/table";

export const deploymentRelations = relations(deployments, ({ one }) => ({
  operator: one(auth_user, {
    fields: [deployments.createdBy],
    references: [auth_user.id],
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

All endpoints require operator authentication via Better Auth session (accessed through service binding from user-application). The operator ID comes from the session.

### New file: `apps/data-service/src/hono/handlers/deployment-handlers.ts`

```ts
import { zValidator } from "@hono/zod-validator";
import {
  DeploymentCreateRequestSchema,
  DeploymentIdParamSchema,
  DeploymentListRequestSchema,
  DeploymentUpdateRequestSchema,
} from "@repo/data-ops/deployment";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authMiddleware } from "../middleware/auth";
import * as deploymentService from "../services/deployment-service";
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

const deploymentHandlers = new Hono<{ Bindings: Env }>();

// List deployments for the authenticated operator
deploymentHandlers.get(
  "/",
  (c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
  zValidator("query", DeploymentListRequestSchema),
  async (c) => {
    const query = c.req.valid("query");
    // In MVP, operator ID comes from API_TOKEN header.
    // Future: extract from Better Auth session via service binding.
    const operatorId = c.req.header("X-Operator-Id") ?? "";
    return resultToResponse(c, await deploymentService.getDeployments(query, operatorId));
  },
);

// Get deployment by ID
deploymentHandlers.get(
  "/:id",
  (c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
  zValidator("param", DeploymentIdParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    return resultToResponse(c, await deploymentService.getDeploymentById(id));
  },
);

// Create deployment
deploymentHandlers.post(
  "/",
  (c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
  zValidator("json", DeploymentCreateRequestSchema),
  async (c) => {
    const data = c.req.valid("json");
    const operatorId = c.req.header("X-Operator-Id") ?? "";
    return resultToResponse(
      c,
      await deploymentService.createDeployment(data, operatorId),
      201,
    );
  },
);

// Update deployment
deploymentHandlers.put(
  "/:id",
  (c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
  zValidator("param", DeploymentIdParamSchema),
  zValidator("json", DeploymentUpdateRequestSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
    return resultToResponse(c, await deploymentService.updateDeployment(id, data));
  },
);

export default deploymentHandlers;
```

### New file: `apps/data-service/src/hono/services/deployment-service.ts`

```ts
import {
  type Deployment,
  type DeploymentCreateInput,
  type DeploymentListRequest,
  type DeploymentListResponse,
  type DeploymentUpdateInput,
  createDeployment as createDeploymentQuery,
  getDeployment,
  getDeployments as getDeploymentsQuery,
  updateDeployment as updateDeploymentQuery,
} from "@repo/data-ops/deployment";
import type { Result } from "../types/result";

export async function getDeployments(
  params: DeploymentListRequest,
  operatorId: string,
): Promise<Result<DeploymentListResponse>> {
  const data = await getDeploymentsQuery(params, operatorId);
  return { ok: true, data };
}

export async function getDeploymentById(id: string): Promise<Result<Deployment>> {
  const deployment = await getDeployment(id);
  if (!deployment) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Wdrozenie nie zostalo znalezione", status: 404 },
    };
  }
  return { ok: true, data: deployment };
}

export async function createDeployment(
  data: DeploymentCreateInput,
  operatorId: string,
): Promise<Result<Deployment>> {
  const deployment = await createDeploymentQuery({ ...data, createdBy: operatorId });
  return { ok: true, data: deployment };
}

export async function updateDeployment(
  id: string,
  data: DeploymentUpdateInput,
): Promise<Result<Deployment>> {
  const deployment = await updateDeploymentQuery(id, data);
  if (!deployment) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Wdrozenie nie zostalo znalezione", status: 404 },
    };
  }
  return { ok: true, data: deployment };
}
```

### Update `apps/data-service/src/hono/app.ts`

```ts
import { Hono } from "hono";
import deployments from "./handlers/deployment-handlers";
import health from "./handlers/health-handlers";
import { createCorsMiddleware } from "./middleware/cors";
import { onErrorHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";

export const App = new Hono<{ Bindings: Env }>();

App.use("*", requestId());
App.onError(onErrorHandler);
App.use("*", createCorsMiddleware());

App.route("/health", health);
App.route("/deployments", deployments);
```

### Endpoint summary

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| `GET` | `/deployments` | Bearer token | `?limit=20&offset=0&status=draft` | `DeploymentListResponse` |
| `GET` | `/deployments/:id` | Bearer token | Param: uuid | `Deployment` |
| `POST` | `/deployments` | Bearer token | `DeploymentCreateRequestSchema` body | `Deployment` (201) |
| `PUT` | `/deployments/:id` | Bearer token | `DeploymentUpdateRequestSchema` body | `Deployment` |

## UI Pages & Components

### Server functions: `apps/user-application/src/core/functions/deployments/direct.ts`

Uses direct DB access via data-ops (preferred for SSR):

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  DeploymentCreateRequestSchema,
  DeploymentListRequestSchema,
  DeploymentUpdateRequestSchema,
} from "@repo/data-ops/deployment";
import {
  createDeployment,
  getDeployment,
  getDeployments,
  updateDeployment,
} from "@repo/data-ops/deployment";
import { AppError } from "@/core/errors";

export const listDeployments = createServerFn({ method: "GET" })
  .validator(DeploymentListRequestSchema)
  .handler(async ({ data, context }) => {
    // context.session.user.id from auth middleware
    const operatorId = ""; // TODO: extract from auth context in doc 003+
    return getDeployments(data, operatorId);
  });

export const getDeploymentById = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const deployment = await getDeployment(data.id);
    if (!deployment) {
      throw new AppError("Wdrozenie nie zostalo znalezione", "NOT_FOUND", 404);
    }
    return deployment;
  });

export const createNewDeployment = createServerFn({ method: "POST" })
  .validator(DeploymentCreateRequestSchema)
  .handler(async ({ data }) => {
    const operatorId = ""; // TODO: extract from auth context
    return createDeployment({ ...data, createdBy: operatorId });
  });

export const updateExistingDeployment = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().uuid(),
      updates: DeploymentUpdateRequestSchema,
    }),
  )
  .handler(async ({ data }) => {
    const deployment = await updateDeployment(data.id, data.updates);
    if (!deployment) {
      throw new AppError("Wdrozenie nie zostalo znalezione", "NOT_FOUND", 404);
    }
    return deployment;
  });
```

### Route: `apps/user-application/src/routes/_auth/dashboard/index.tsx`

Deployment list page:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listDeployments } from "@/core/functions/deployments/direct";

export const Route = createFileRoute("/_auth/dashboard/")({
  loader: () => listDeployments({ data: { limit: 20, offset: 0 } }),
  component: DeploymentListPage,
});

const STATUS_LABELS: Record<string, string> = {
  draft: "Szkic",
  onboarding: "Onboarding",
  employees_pending: "Oczekuje na pracownikow",
  ready: "Gotowe",
  active: "Aktywne",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  onboarding: "secondary",
  employees_pending: "secondary",
  ready: "default",
  active: "default",
};

function DeploymentListPage() {
  const deployments = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Wdrozenia</h1>
        <Button asChild>
          <Link to="/dashboard/new">Nowe wdrozenie</Link>
        </Button>
      </div>

      {deployments.data.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Brak wdrozen. Utworz nowe wdrozenie aby rozpoczac.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {deployments.data.map((deployment) => (
            <Link
              key={deployment.id}
              to="/dashboard/$id"
              params={{ id: deployment.id }}
              className="block"
            >
              <Card className="hover:border-primary transition-colors">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">{deployment.clientName}</CardTitle>
                  <Badge variant={STATUS_VARIANTS[deployment.status] ?? "outline"}>
                    {STATUS_LABELS[deployment.status] ?? deployment.status}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{deployment.domain}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Route: `apps/user-application/src/routes/_auth/dashboard/new.tsx`

Create deployment form:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createNewDeployment } from "@/core/functions/deployments/direct";

export const Route = createFileRoute("/_auth/dashboard/new")({
  component: CreateDeploymentPage,
});

function CreateDeploymentPage() {
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: (data: { clientName: string; domain: string; adminEmail?: string; adminName?: string }) =>
      createNewDeployment({ data }),
  });

  const form = useForm({
    defaultValues: {
      clientName: "",
      domain: "",
      adminEmail: "",
      adminName: "",
    },
    onSubmit: async ({ value }) => {
      mutation.reset();
      const result = await mutation.mutateAsync({
        clientName: value.clientName,
        domain: value.domain,
        adminEmail: value.adminEmail || undefined,
        adminName: value.adminName || undefined,
      });
      navigate({ to: "/dashboard/$id", params: { id: result.id } });
    },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Nowe wdrozenie</h1>

      <Card>
        <CardHeader>
          <CardTitle>Dane klienta</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            {mutation.isError && (
              <Alert variant="destructive">{mutation.error.message}</Alert>
            )}

            <form.Field
              name="clientName"
              validators={{
                onChange: ({ value }) =>
                  !value ? "Nazwa klienta jest wymagana" : undefined,
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <label
                    htmlFor="clientName"
                    className="text-sm font-medium text-foreground"
                  >
                    Nazwa klienta
                  </label>
                  <Input
                    id="clientName"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="FirmaXYZ Sp. z o.o."
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field
              name="domain"
              validators={{
                onChange: ({ value }) =>
                  !value ? "Domena jest wymagana" : undefined,
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <label
                    htmlFor="domain"
                    className="text-sm font-medium text-foreground"
                  >
                    Domena
                  </label>
                  <Input
                    id="domain"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="firma.pl"
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="adminEmail">
              {(field) => (
                <div className="space-y-2">
                  <label
                    htmlFor="adminEmail"
                    className="text-sm font-medium text-foreground"
                  >
                    Email administratora klienta (opcjonalnie)
                  </label>
                  <Input
                    id="adminEmail"
                    type="email"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="admin@firma.pl"
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="adminName">
              {(field) => (
                <div className="space-y-2">
                  <label
                    htmlFor="adminName"
                    className="text-sm font-medium text-foreground"
                  >
                    Imie i nazwisko administratora (opcjonalnie)
                  </label>
                  <Input
                    id="adminName"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Jan Kowalski"
                  />
                </div>
              )}
            </form.Field>

            <form.Subscribe selector={(s) => s.canSubmit}>
              {(canSubmit) => (
                <Button
                  type="submit"
                  disabled={!canSubmit || mutation.isPending}
                  className="w-full"
                >
                  {mutation.isPending ? "Tworzenie..." : "Utworz wdrozenie"}
                </Button>
              )}
            </form.Subscribe>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Route: `apps/user-application/src/routes/_auth/dashboard/$id.tsx`

Deployment detail page:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDeploymentById } from "@/core/functions/deployments/direct";

export const Route = createFileRoute("/_auth/dashboard/$id")({
  loader: ({ params }) => getDeploymentById({ data: { id: params.id } }),
  component: DeploymentDetailPage,
});

const STATUS_LABELS: Record<string, string> = {
  draft: "Szkic",
  onboarding: "Onboarding",
  employees_pending: "Oczekuje na pracownikow",
  ready: "Gotowe",
  active: "Aktywne",
};

function DeploymentDetailPage() {
  const deployment = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">
          {deployment.clientName}
        </h1>
        <Badge>{STATUS_LABELS[deployment.status] ?? deployment.status}</Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dane klienta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <span className="text-sm text-muted-foreground">Domena: </span>
              <span className="text-foreground">{deployment.domain}</span>
            </div>
            {deployment.adminEmail && (
              <div>
                <span className="text-sm text-muted-foreground">Admin: </span>
                <span className="text-foreground">
                  {deployment.adminName ?? ""} ({deployment.adminEmail})
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status wdrozenia</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Utworzone: {new Date(deployment.createdAt).toLocaleDateString("pl-PL")}
            </p>
            {/* Employee progress and magic link generation added in doc 003 */}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

### Update sidebar navigation

Update `apps/user-application/src/components/layout/sidebar.tsx` to include a "Wdrozenia" link pointing to `/_auth/dashboard/`.

## Implementation Steps

1. **Create deployment domain in data-ops**
   - Create `packages/data-ops/src/deployment/` directory
   - Create `table.ts`, `schema.ts`, `queries.ts`, `index.ts`
   - Add `"./deployment"` export to `package.json`
   - Update `drizzle/relations.ts` with deployment relations
   - Generate and run migration
   - Rebuild: `pnpm --filter @repo/data-ops build`

2. **Create deployment API in data-service**
   - Create `hono/handlers/deployment-handlers.ts`
   - Create `hono/services/deployment-service.ts`
   - Update `hono/app.ts` to register `/deployments` route

3. **Create server functions in user-application**
   - Create `core/functions/deployments/direct.ts`

4. **Create dashboard pages**
   - Update `routes/_auth/dashboard/index.tsx` (deployment list)
   - Create `routes/_auth/dashboard/new.tsx` (create form)
   - Create `routes/_auth/dashboard/$id.tsx` (detail view)
   - Update sidebar navigation

5. **Regenerate and verify**
   - Regenerate route tree: `cd apps/user-application && npx @tanstack/router-cli generate`
   - Run `pnpm run lint:fix`
   - Run `pnpm run lint`
   - Run `pnpm run setup`

## Environment Variables

No new environment variables required for this doc. All existing env vars from doc 001 are sufficient.

## Manual Test Script

1. Run `pnpm run setup` -- ensure data-ops builds with new deployment domain
2. Run `pnpm run dev:data-service` -- confirm starts without errors
3. Run `pnpm run dev:user-application` -- confirm starts without errors
4. Sign in as operator at `/signin`
5. Navigate to `/_auth/dashboard/` -- should show "Wdrozenia" heading with empty state
6. Click "Nowe wdrozenie" -- should navigate to `/dashboard/new`
7. Fill in form:
   - Nazwa klienta: "FirmaXYZ"
   - Domena: "firma.pl"
   - Email administratora: "admin@firma.pl" (optional)
   - Imie i nazwisko: "Jan Kowalski" (optional)
8. Click "Utworz wdrozenie" -- should create and redirect to `/dashboard/{id}`
9. On detail page, verify:
   - Title shows "FirmaXYZ"
   - Status badge shows "Szkic"
   - Domain shows "firma.pl"
   - Admin email/name shown if provided
10. Navigate back to `/_auth/dashboard/` -- deployment should appear in the list
11. Click the deployment card -- should navigate back to detail page
12. Test API directly: `curl http://localhost:8788/deployments` with valid Bearer token -- should return list
