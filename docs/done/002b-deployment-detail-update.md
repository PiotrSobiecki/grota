# 002b: Deployment Detail & Update

## Goal

Enable operators to view deployment details and update deployment data, completing the deployment CRUD vertical slice started in doc 002a.

## Prerequisites

- Doc 002a (Deployment Schema, Create & List) must be implemented first.

## Scope

### IN

- GET `/deployments/:id` endpoint in data-service
- PUT `/deployments/:id` endpoint in data-service
- Deployment detail page (`/_auth/dashboard/$id`)
- Server functions for get-by-id and update
- Update create form to redirect to detail page instead of list
- Make deployment cards in list page clickable (link to detail)

### OUT

- Magic link generation (doc 003)
- Employees table (doc 003)
- Google OAuth (doc 004)
- Config export (doc 006)

## Data Model Changes

None -- all data-ops files were created in doc 002a. This doc only adds data-service endpoints and user-application pages.

## API Endpoints

### Update: `apps/data-service/src/hono/handlers/deployment-handlers.ts`

Add GET /:id and PUT /:id handlers to the existing file from doc 002a. Also add the missing import for `DeploymentIdParamSchema` and `DeploymentUpdateRequestSchema`.

Add these imports:

```ts
import {
  DeploymentCreateRequestSchema,
  DeploymentIdParamSchema,
  DeploymentListRequestSchema,
  DeploymentUpdateRequestSchema,
} from "@repo/data-ops/deployment";
```

Add these handlers after the existing POST handler:

```ts
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
```

### Update: `apps/data-service/src/hono/services/deployment-service.ts`

Add these imports and functions to the existing file from doc 002a:

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
```

```ts
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

### Endpoint summary (new in this doc)

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| `GET` | `/deployments/:id` | Bearer token | Param: uuid | `Deployment` |
| `PUT` | `/deployments/:id` | Bearer token | `DeploymentUpdateRequestSchema` body | `Deployment` |

## UI Pages & Components

### Update server functions: `apps/user-application/src/core/functions/deployments/direct.ts`

Add these imports and functions to the existing file from doc 002a:

```ts
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
```

```ts
export const getDeploymentById = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const deployment = await getDeployment(data.id);
    if (!deployment) {
      throw new AppError("Wdrozenie nie zostalo znalezione", "NOT_FOUND", 404);
    }
    return deployment;
  });

export const updateExistingDeployment = createServerFn({ method: "POST" })
  .inputValidator(
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

### New route: `apps/user-application/src/routes/_auth/dashboard/$id.tsx`

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

### Update: `apps/user-application/src/routes/_auth/dashboard/index.tsx`

Make deployment cards clickable by wrapping them in `<Link>`:

```tsx
// Change import to include Link
import { createFileRoute, Link } from "@tanstack/react-router";

// Replace the Card inside the map with a Link-wrapped version:
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
```

### Update: `apps/user-application/src/routes/_auth/dashboard/new.tsx`

Change the post-creation redirect from list page to detail page:

```tsx
// Before (doc 002a):
navigate({ to: "/dashboard" });

// After (doc 002b):
navigate({ to: "/dashboard/$id", params: { id: result.id } });
```

This requires capturing the mutation result:

```tsx
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
```

## Implementation Steps

1. **Extend data-service handlers**
   - Add GET /:id and PUT /:id handlers to `deployment-handlers.ts`
   - Add `getDeploymentById` and `updateDeployment` to `deployment-service.ts`

2. **Add server functions**
   - Add `getDeploymentById` and `updateExistingDeployment` to `direct.ts`

3. **Create detail page**
   - Create `routes/_auth/dashboard/$id.tsx`

4. **Update existing pages**
   - Make list page cards clickable (add `<Link>` wrapper)
   - Change create form redirect to detail page

5. **Regenerate and verify**
   - Regenerate route tree: `cd apps/user-application && npx @tanstack/router-cli generate`
   - Run `pnpm run lint:fix`
   - Run `pnpm run lint`
   - Run `pnpm run setup`

## Environment Variables

No new environment variables required.

## Manual Test Script

1. **Prerequisite:** Doc 002a is implemented and at least one deployment exists in the database.
2. Run `pnpm run dev:data-service` and `pnpm run dev:user-application`
3. Sign in as operator at `/signin`
4. Navigate to `/_auth/dashboard/` -- should show deployment list
5. Click a deployment card -- should navigate to `/dashboard/{id}`
6. On detail page, verify:
   - Title shows client name
   - Status badge shows "Szkic"
   - Domain is displayed
   - Admin email/name shown if provided
   - Created date is formatted in Polish locale
7. Navigate back to `/_auth/dashboard/` -- click "Nowe wdrozenie"
8. Fill form and submit -- should redirect to `/dashboard/{id}` (detail page of new deployment)
9. Verify detail page shows the just-created deployment data
10. Test API: `curl http://localhost:8788/deployments/{id}` with valid Bearer token -- should return deployment
11. Test API: `curl -X PUT http://localhost:8788/deployments/{id} -H "Content-Type: application/json" -d '{"clientName":"Updated Name"}'` with valid Bearer token -- should return updated deployment
