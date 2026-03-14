# Auto-Grant Shared Drive Access After Migration

## Context

After rclone migration copies employee folders from personal Google Drive to Workspace Shared Drives, employees have no access to the drives and don't know their files were migrated. Adding employees as readers via Google Drive Permissions API makes the Shared Drive appear in their sidebar automatically — solving both access and awareness.

## Approach

New API endpoint `POST /shared-drives/:deploymentId/grant-access` (API_TOKEN protected). CLI calls it after successful migration. All data already in DB — no request body needed.

## Changes

### 1. `apps/data-service/src/hono/services/google-drive-api-service.ts`

Add two functions following existing `createSharedDrive`/`createSharedDrivesBulk` pattern:

- `grantDrivePermission(accessToken, driveId, email)` — calls `POST /drive/v3/files/{driveId}/permissions?supportsAllDrives=true&sendNotificationEmail=true` with `{type:"user", role:"reader", emailAddress}`. Returns `Result<{permissionId, alreadyExisted}>`. Treats 409 as success (already exists).
- `grantDrivePermissionsBulk(accessToken, grants[])` — batched `Promise.allSettled` (batch size 10 to respect Google rate limits). Returns `Result<{granted, skipped, failures[]}>`.

### 2. `apps/data-service/src/hono/services/shared-drive-service.ts`

Add `grantAccessToMigratedDrives(deploymentId, env)`:

1. Call existing `getConfigAssemblyData(deploymentId)` — already returns employees + folders + sharedDrives
2. Build `category → googleDriveId` map from `data.sharedDrives`
3. For each employee: extract unique categories from their folders, filter out `"prywatne"`, only include `"dokumenty"` and `"projekty"` (matching migration's category filter)
4. Collect `{driveId, email}` pairs, deduplicate
5. Call `getValidWorkspaceAccessToken(deploymentId, env)` (existing, handles refresh)
6. Call `grantDrivePermissionsBulk(accessToken, grants)`
7. Return `Result<{granted, skipped, failed, total, failures[]}>`

### 3. `apps/data-service/src/hono/handlers/shared-drive-handlers.ts`

Add route after existing `/:deploymentId/create`:

```ts
sharedDriveHandlers.post(
  "/:deploymentId/grant-access",
  (c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
  zValidator("param", SharedDriveDeploymentParamSchema),
  async (c) => { ... resultToResponse(...grantAccessToMigratedDrives...) }
)
```

Pattern matches `cli-notify-handlers.ts:12` for auth.

### 4. `apps/cli/lib/migration.sh`

After line 155 (`notify_info "Migration complete:..."`), add non-fatal API call:

```bash
deployment_id=$(cfg_deployment_id)
if [[ -n "${DATA_SERVICE_URL:-}" ]]; then
  local grant_response
  grant_response=$(curl -s -X POST \
    "${DATA_SERVICE_URL}/shared-drives/${deployment_id}/grant-access" \
    -H "Authorization: Bearer ${API_TOKEN:-}")
  log_info "Grant access response: ${grant_response}"
  if [[ $? -ne 0 ]]; then
    notify_error "Grant shared drive access failed (non-fatal)" "$deployment_id"
  fi
fi
```

Non-fatal: migration success stands even if grant fails. Idempotent: safe to re-run (Google 409 = already granted).

## Key Files (read-only reference)

- `packages/data-ops/src/config/queries.ts` — `getConfigAssemblyData()` reused, no changes
- `packages/data-ops/src/shared-drive/schema.ts` — `SharedDriveDeploymentParamSchema` reused, no changes
- `apps/data-service/src/hono/services/google-token-service.ts` — `getValidWorkspaceAccessToken()` reused
- `apps/data-service/src/hono/middleware/auth.ts` — `authMiddleware` import

## Verification

1. `pnpm run lint` after all changes
2. Manual test against staging: run `grota migrate --account test@example.com`, verify employee sees Shared Drive in Google Drive sidebar + receives "X shared with you" email
3. Test idempotency: run grant-access twice, second call should show all "skipped"
4. Test partial failure: use invalid email, verify summary reports it + other grants succeed

## Decisions (resolved)

- `sendNotificationEmail=true` — Google sends "X shared with you" email to employee for awareness.
- CF Worker 30s CPU limit: batching by 10 handles ~100 grants fine. 200+ employees may need `waitUntil()` or queue-based async pattern — unlikely for current scale.
- `deployment_id` obtained via `cfg_deployment_id` in CLI (same pattern as orchestrator.sh).
