# 008b: Department Rename + Max Limit UI Feedback

## Goal

Two small gaps in department management:
1. No rename/update endpoint -- only create + delete exist
2. API enforces max 10 departments but UI gives no proactive feedback about the limit

## Prerequisites

- Doc 007 (Dynamic Departments) implemented

## Scope

### IN

- PATCH endpoint for department rename
- Inline edit UI (click name -> input -> save)
- "X/10" counter in department section header
- Disable add button at limit with tooltip
- Error toast when API returns `MAX_DEPARTMENTS_REACHED`

### OUT

- Slug rename (auto-derived from name, same as create)
- Reordering departments
- Bulk rename

---

## 1. Department Rename

### 1a. data-ops query

Add `updateDepartment` to `packages/data-ops/src/department/queries.ts`:

```ts
export async function updateDepartment(
  departmentId: string,
  data: { name: string },
): Promise<Department | null> {
  const db = getDb();
  const slug = slugify(data.name);
  const result = await db
    .update(deploymentDepartments)
    .set({ name: data.name, slug })
    .where(eq(deploymentDepartments.id, departmentId))
    .returning();
  return result[0] ?? null;
}
```

### 1b. Zod schema

Add to `packages/data-ops/src/department/schema.ts`:

```ts
export const DepartmentUpdateRequestSchema = z.object({
  name: z.string().min(1, "Nazwa dzialu jest wymagana").max(100),
});

export type DepartmentUpdateInput = z.infer<typeof DepartmentUpdateRequestSchema>;
```

Export from barrel `index.ts`.

### 1c. Service

Add to `apps/data-service/src/hono/services/department-service.ts`:

```ts
export async function updateDeploymentDepartment(
  departmentId: string,
  input: DepartmentUpdateInput,
): Promise<Result<Department>> {
  const updated = await updateDepartment(departmentId, input);
  if (!updated) {
    return {
      ok: false,
      error: {
        code: "DEPARTMENT_NOT_FOUND",
        message: "Dzial nie zostal znaleziony",
        status: 404,
      },
    };
  }
  return { ok: true, data: updated };
}
```

### 1d. Handler

Add PATCH route to `apps/data-service/src/hono/handlers/department-handlers.ts`:

```ts
departmentHandlers.patch(
  "/:id",
  zValidator("param", DepartmentIdParamSchema),
  zValidator("json", DepartmentUpdateRequestSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
    return resultToResponse(c, await departmentService.updateDeploymentDepartment(id, data));
  },
);
```

### 1e. Server function

Add to `apps/user-application/src/core/functions/departments/binding.ts`:

```ts
export const renameDepartment = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      departmentId: z.string().uuid(),
      name: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const response = await fetchDataService(`/departments/${data.departmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.name }),
    });

    if (!response.ok) {
      const body = (await response.json()) as { error?: string; code?: string };
      throw new AppError(
        body.error ?? "Nie udalo sie zmienic nazwy dzialu",
        body.code ?? "DEPARTMENT_RENAME_ERROR",
        response.status,
      );
    }

    return (await response.json()) as Department;
  });
```

### 1f. Inline edit UI

In `DepartmentSection` (`$id/index.tsx`), replace static `{dept.name}` with inline-editable badge:

**State**: `editingId: string | null`, `editName: string`

**Behavior**:
- Click dept name (when `canEdit`) -> set `editingId` + `editName`
- Show `<Input>` replacing the name text, auto-focused
- Enter or blur -> call `renameMutation.mutate({ departmentId, name })`
- Escape -> cancel edit
- Disable while mutation pending

```tsx
const renameMutation = useMutation({
  mutationFn: ({ departmentId, name }: { departmentId: string; name: string }) =>
    renameDepartment({ data: { departmentId, name } }),
  onSuccess: () => {
    departmentsQuery.refetch();
    setEditingId(null);
  },
});
```

Badge rendering per dept:

```tsx
{editingId === dept.id ? (
  <Input
    autoFocus
    value={editName}
    onChange={(e) => setEditName(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const trimmed = editName.trim();
        if (trimmed && trimmed !== dept.name) {
          renameMutation.mutate({ departmentId: dept.id, name: trimmed });
        } else {
          setEditingId(null);
        }
      }
      if (e.key === "Escape") setEditingId(null);
    }}
    onBlur={() => {
      const trimmed = editName.trim();
      if (trimmed && trimmed !== dept.name) {
        renameMutation.mutate({ departmentId: dept.id, name: trimmed });
      } else {
        setEditingId(null);
      }
    }}
    className="h-7 w-32 text-sm"
  />
) : (
  <span
    onClick={() => canEdit && (setEditingId(dept.id), setEditName(dept.name))}
    className={canEdit ? "cursor-pointer hover:underline" : ""}
  >
    {dept.name}
  </span>
)}
```

---

## 2. Max Departments Limit UI Feedback

### 2a. Import constant

Import `MAX_DEPARTMENTS_PER_DEPLOYMENT` from `@repo/data-ops/department` in the UI component. Value = 10.

### 2b. Counter in header

Replace current `({departments.length})` with limit-aware counter:

```tsx
<span className="text-sm font-normal text-muted-foreground">
  ({departments.length}/{MAX_DEPARTMENTS_PER_DEPLOYMENT})
</span>
```

Always show (remove the `departments.length > 0` guard) so "0/10" is visible on empty state.

### 2c. Disable add button at limit

Derive `atLimit`:

```ts
const atLimit = departments.length >= MAX_DEPARTMENTS_PER_DEPLOYMENT;
```

Disable input + button when `atLimit`:

```tsx
<Input
  placeholder={atLimit ? "Osiagnieto limit dzialow" : "Nowy dzial..."}
  disabled={atLimit}
  ...
/>
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <span tabIndex={atLimit ? 0 : undefined}>
        <Button
          variant="outline"
          size="icon"
          onClick={handleAdd}
          disabled={atLimit || createMutation.isPending}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </span>
    </TooltipTrigger>
    {atLimit && (
      <TooltipContent>
        Maksymalnie {MAX_DEPARTMENTS_PER_DEPLOYMENT} dzialow na wdrozenie
      </TooltipContent>
    )}
  </Tooltip>
</TooltipProvider>
```

### 2d. Error toast for API limit error

`createMutation` already shows `createMutation.error.message` inline. The API returns `"Maksymalnie 10 dzialow na wdrozenie"` with code `MAX_DEPARTMENTS_REACHED`. Current inline error display is sufficient -- no additional toast needed since the button is disabled proactively.

If user somehow bypasses (race condition, stale data), the existing inline error from `createMutation.isError` already renders the API message.

### 2e. Same treatment on `new.tsx`

The create-deployment form (`/_auth/dashboard/new.tsx`) has a department picker using suggestion checkboxes + custom input. Apply same pattern:
- Show `X/10` counter
- Disable custom department input when at limit
- Disable unchecked suggestion checkboxes when at limit

---

## Implementation Plan

| Step | File | Change |
|------|------|--------|
| 1 | `data-ops/department/schema.ts` | Add `DepartmentUpdateRequestSchema` + type |
| 2 | `data-ops/department/queries.ts` | Add `updateDepartment` |
| 3 | `data-ops/department/index.ts` | Export new schema + query |
| 4 | `data-service/services/department-service.ts` | Add `updateDeploymentDepartment` |
| 5 | `data-service/handlers/department-handlers.ts` | Add PATCH `/:id` route |
| 6 | `user-application/functions/departments/binding.ts` | Add `renameDepartment` server fn |
| 7 | `user-application/routes/_auth/dashboard/$id/index.tsx` | Inline edit + counter + limit disable |
| 8 | `user-application/routes/_auth/dashboard/new.tsx` | Counter + limit disable on suggestions |
| 9 | Rebuild data-ops, lint | `pnpm --filter @repo/data-ops build && pnpm run lint:fix` |

## Decisions

| Question | Decision |
|----------|----------|
| Unique slug conflict on rename | Return error + info "taki dzial juz istnieje, podaj inna nazwe" — catch DB unique constraint, map to `DEPARTMENT_NAME_EXISTS` error code |
| Rename blocked when status > onboarding? | Yes, same rule as create/delete — rename only in draft/onboarding |
