# Remove Hardcoded Categories — Make Shared Drives Dynamic

## Context

Categories (dokumenty, projekty, media, prywatne) are hardcoded as a pgEnum, Zod schemas, CLI loops, and frontend constants. This forces exactly 3 shared drives per deployment and prevents customization. Goal: shared drives ARE the categories — admin creates N drives freely, employee assigns folders to drives (or skips).

## Approach: `folder_selections.category` → `folder_selections.shared_drive_id` FK

- Drop `folderCategoryEnum` pgEnum entirely
- `folder_selections` gets nullable FK `shared_drive_id` → `shared_drives.id` (null = skip/prywatne)
- `shared_drives` drops `category` column, no max-3 limit
- Config JSON uses drive names instead of category strings
- Drop auto-suggestion (CATEGORY_PATTERNS + suggestCategory) — employees pick drives manually
- CLI iterates dynamic drive names from config instead of hardcoded loops
- B2 credentials pulled from config JSON (set by operator separately)

---

## Phase 1: Database (data-ops)

### 1a. `packages/data-ops/src/shared-drive/table.ts`
- Remove import of `folderCategoryEnum`
- Drop `category` column
- Add `retentionDays: integer("retention_days")` (nullable — null = keep forever, e.g. 90 for media-like drives)
- Replace `unique().on(t.deploymentId, t.category)` → `unique().on(t.deploymentId, t.name)`

### 1b. `packages/data-ops/src/folder-selection/table.ts`
- Remove `folderCategoryEnum` definition
- Replace `category: folderCategoryEnum("category").notNull()` → `sharedDriveId: uuid("shared_drive_id").references(() => sharedDrives.id, { onDelete: "set null" })`
- Import `sharedDrives` from shared-drive/table

### 1c. `packages/data-ops/src/drizzle/relations.ts`
- Add relation: folderSelections → sharedDrives (many-to-one)
- Add relation: sharedDrives → folderSelections (one-to-many)

### 1d. Migration SQL (manually edit generated migration)
```sql
ALTER TABLE folder_selections ADD COLUMN shared_drive_id UUID REFERENCES shared_drives(id) ON DELETE SET NULL;

UPDATE folder_selections fs SET shared_drive_id = (
  SELECT sd.id FROM shared_drives sd
  JOIN employees e ON e.deployment_id = sd.deployment_id
  WHERE e.id = fs.employee_id AND sd.category = fs.category
) WHERE fs.category != 'prywatne';

ALTER TABLE folder_selections DROP COLUMN category;
ALTER TABLE shared_drives DROP CONSTRAINT shared_drives_deployment_id_category_unique;
ALTER TABLE shared_drives DROP COLUMN category;
ALTER TABLE shared_drives ADD CONSTRAINT shared_drives_deployment_id_name_unique UNIQUE(deployment_id, name);
DROP TYPE folder_category;
```

## Phase 2: Schemas (data-ops)

### 2a. `packages/data-ops/src/shared-drive/schema.ts`
- Remove `SharedDriveCategorySchema` + `SharedDriveCategory` type
- Remove `category` from `SharedDriveSchema`, `SharedDriveUpsertRequestSchema`
- Add `retentionDays: z.number().int().positive().nullable()` to schemas
- Remove `.max(3)` and category-uniqueness `.refine()` from bulk schemas
- Add name-uniqueness `.refine()` instead

### 2b. `packages/data-ops/src/folder-selection/schema.ts`
- Remove `FolderCategorySchema` + `FolderCategory` type
- `FolderSelectionSchema`: `category` → `sharedDriveId: z.string().uuid().nullable()`
- `FolderSelectionCreateRequestSchema`: same change
- `DriveFolderSchema`: remove `suggestedCategory` field entirely

### 2c. Barrel exports
- Update `shared-drive/index.ts` and `folder-selection/index.ts` — remove old type exports

## Phase 3: Queries (data-ops)

### 3a. `packages/data-ops/src/shared-drive/queries.ts`
- `upsertSharedDrives`: remove `category` from insert/update values

### 3b. `packages/data-ops/src/folder-selection/queries.ts`
- `createFolderSelections`: `category: s.category` → `sharedDriveId: s.sharedDriveId`

### 3c. `packages/data-ops/src/config/queries.ts`
- Config assembly: join `folder_selections` with `shared_drives` to get drive name
- Replace `category` field with `shared_drive_name` (nullable, null = skip)
- `shared_drives` section: drop `category`, keep `name` + `id`

### 3d. `packages/data-ops/src/config/schema.ts`
- `workspace.shared_drives[]`: remove `category`, add `retention_days: z.number().nullable()`
- `accounts[].folders[]`: `category` → `shared_drive_name: z.string().nullable()`
- Add top-level `b2` object to config schema:
  ```ts
  b2: z.object({
    key_id: z.string(),
    app_key: z.string(),
    bucket_prefix: z.string(),
  })
  ```

## Phase 4: API (data-service)

### 4a. `apps/data-service/src/hono/services/folder-service.ts`
- Delete `CATEGORY_PATTERNS` array and `suggestCategory()` function
- `listDriveFolders`: return folders without `suggestedCategory`
- `saveSelections`: pass `sharedDriveId` instead of `category`

### 4b. `apps/data-service/src/hono/services/shared-drive-service.ts`
- `createAndSaveSharedDrives`: type → `Array<{ name: string }>` (no category)
- `existingByCategory` → `existingByName` map

### 4c. `apps/data-service/src/hono/services/config-service.ts`
- `f.category !== "prywatne"` → `f.shared_drive_name !== null`

### 4d. `apps/data-service/src/hono/services/notification-service.ts`
- Same prywatne filter change

### 4e. `apps/data-service/src/hono/services/google-drive-api-service.ts`
- `createSharedDrivesBulk`: remove `category` from drives param type

### 4f. Employee verification endpoint — `GET /magic-links/verify/employee/:token`
- In `magic-link-service.ts:verifyEmployeeToken()`: after fetching employee, call `getSharedDrivesByDeployment(employee.deploymentId)` and include in response
- Response shape becomes: `{ employeeId: string; deploymentId: string; sharedDrives: Array<{ id: string; name: string }> }`
- Frontend consumer in `core/functions/employees/binding.ts`: update return type to include `sharedDrives`
- Employee flow uses these to populate the folder assignment dropdown

## Phase 5: Frontend (user-application)

### 5a. `apps/user-application/src/routes/onboard/$token.tsx` — SharedDriveStep
- Remove `SHARED_DRIVE_CATEGORIES`, `SHARED_DRIVE_CATEGORY_LABELS`
- Dynamic form: start with 3 default rows (`${clientName}-Dokumenty`, `-Projekty`, `-Media`) but admin can add/remove/rename
- `clientName` already available as prop from loader data (admin token verification)
- Each drive row: name + optional retention days input (null = forever)
- Submit: `Array<{ name: string; retentionDays?: number }>` (no category)

### 5b. `apps/user-application/src/routes/employee/$token.tsx`
- Remove `CATEGORY_INFO`
- Shared drives come from employee verification endpoint response (see 4f)
- Dropdown: deployment's shared drives + "Pomijane" (null = skip)
- `selectedCategory` → `selectedSharedDriveId: string | null`
- ConfirmStep: group by drive name dynamically

### 5c. `apps/user-application/src/core/functions/shared-drives/binding.ts`
- Remove `z.enum(["dokumenty", "projekty", "media"])` → `z.object({ name: z.string().min(1) })`

### 5d. `apps/user-application/src/routes/_auth/dashboard/$id/config.tsx`
- Update any prywatne checks to null checks

## Phase 6: CLI (bash scripts)

### 6a. `apps/cli/lib/config.sh`
- `cfg_shared_drive_category()` → remove
- `cfg_account_folders_by_category()` → `cfg_account_folders_by_drive()` — filter by `shared_drive_name`
- Add `cfg_shared_drive_names()` — returns list of all drive names from config
- Add `cfg_b2_key_id()`, `cfg_b2_app_key()`, `cfg_b2_bucket_prefix()` — read from config JSON `.b2` object

### 6b. `apps/cli/lib/setup.sh`
- Replace `for category in dokumenty projekty media` → iterate `cfg_shared_drive_names`
- B2 remote naming: `b2_${sanitized_drive_name}`
- Bucket naming: `${cfg_b2_bucket_prefix}-${sanitized_drive_name}`
- Remove hardcoded `B2_DOKUMENTY_KEY_ID` etc. — use `cfg_b2_key_id` / `cfg_b2_app_key` from config JSON

### 6c. `apps/cli/lib/backup.sh`
- `sync_gdrive_to_local`: replace `category == "prywatne"` → `shared_drive_name == null`
- Local dir: `${backup_root}/${email}/${shared_drive_name}/`
- `sync_local_to_b2`: iterate dynamic drive names, not hardcoded 3
- Media retention: use per-drive `retention_days` from config (null = keep forever). `find ... -mtime +${retention_days} -delete`

### 6d. `apps/cli/lib/audit.sh`
- Replace all 3 hardcoded `for category in` loops → iterate config drive names

### 6e. `apps/cli/lib/migration.sh`
- Replace category case statement → match by shared_drive_name from config
- Iterate all drives, not just dokumenty/projekty

### 6f. `apps/cli/uninstall.sh`
- Replace hardcoded `b2_dokumenty|b2_projekty|b2_media` grep → dynamic from rclone config

### 6g. `apps/cli/test/sample-config.json`
- Update structure: drives without `category`, folders with `shared_drive_name`
- Add `b2` object with test credentials

### 6h. `apps/cli/test/test-migration.sh` + `test-audit.sh`
- Update tests to use new config shape

## Phase 7: Verify

1. `pnpm --filter @repo/data-ops build`
2. `pnpm run drizzle:dev:generate` → manually insert data migration UPDATE
3. `pnpm run drizzle:dev:migrate`
4. `pnpm run dev:data-service` + `pnpm run dev:user-application`
5. Test: create deployment → onboard (dynamic drives) → employee flow (dynamic dropdown) → export config
6. CLI: run `grota backup` against new config shape
7. `pnpm run lint`

---

## Decisions (resolved)

1. **Media retention** → per-drive `retention_days` column in shared_drives. Admin sets during onboarding. null = keep forever.
2. **Existing B2 buckets** → no production data yet, do simplest (no backward compat needed).
3. **Employee shared drives** → add `sharedDrives` array to `GET /magic-links/verify/employee/:token` response via `getSharedDrivesByDeployment(deploymentId)`.
4. **B2 credentials** → pulled from config JSON `b2` object (set by operator separately, not during onboard).
5. **Auto-suggestion** → dropped entirely. Employees pick drives manually.
