# Drill-in File/Folder Selection for Employee Backup Flow

## Context

Employees currently select whole top-level Drive folders for backup/migration. They need to browse into folders and select individual files or subfolders too. This enables finer-grained control -- e.g. picking 3 files from a large folder instead of backing up everything.

**Key decisions**: Navigator pattern (one level at a time, not tree), whole-folder semantics preserved, per-item drive assignment (no auto-suggestion — employee picks manually), auto-deselect children when parent selected, updated trust panel text, file size shown when available.

**Prerequisite**: Doc 003 (Dynamic Shared Drives) -- already implemented (migration 0008). `shared_drive_id` FK already exists on `folder_selections`. Departments and `retentionDays` already removed (migration 0009).

---

## Current State (verified against codebase)

**`folder_selections` table columns**: `id`, `employee_id`, `folder_id`, `folder_name`, `shared_drive_id` (FK), `created_at`

**`shared_drives` table columns**: `id`, `deployment_id`, `name`, `google_drive_id`, `created_at` (unique on `deployment_id + name`)

**`FolderSelectionCreateRequestSchema` fields**: `folderId`, `folderName`, `sharedDriveId`

**`FolderSelectionBulkCreateRequestSchema`**: `employeeId` + `selections` array (min 1)

**`DriveFolderSchema` fields**: `id`, `name`, `mimeType`

**`DriveFolderListResponseSchema`**: `{ folders: DriveFolder[] }`

**`listDriveFolders` signature**: `(employeeId: string, env: Env) => Promise<Result<{ folders: DriveFolder[] }>>`
- Queries Google Drive API with: `'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
- Fields: `files(id,name,mimeType)`, pageSize 100

**`ConfigAssemblyData.accounts[].folders[]`**: `{ folderId, folderName, shared_drive_name }`

**`ConfigJsonSchema.accounts[].folders[]`**: `{ id, name, shared_drive_name }`

**Frontend `$token.tsx`**: ~464 lines, 4-step flow (OAuth -> FolderList -> DriveAssignment -> Confirm), uses `FolderWithDrive` interface (not `FolderWithCategory`), state var `folders: FolderWithDrive[]`

**CLI `backup.sh`**: reads `.id`, `.name`, `.shared_drive_name` from `folders_json` via jq

**CLI `migration.sh`**: same fields, plus reads `.type` is NOT present yet

---

## 1. DB Migration -- `packages/data-ops/src/folder-selection/table.ts`

Rename columns + add 3 new:
- `folder_id` -> `item_id`, `folder_name` -> `item_name`
- Add `item_type` pgEnum(`folder`, `file`), NOT NULL, default `'folder'`
- Add `parent_folder_id` text, nullable (null = root)
- Add `mime_type` text, nullable

Generate + apply migration: `pnpm run drizzle:dev:generate && pnpm run drizzle:dev:migrate`

Safe: `saveSelections` does delete-all + re-insert, no data migration concerns for renames.

## 2. Schemas & Types -- `packages/data-ops/src/folder-selection/schema.ts`

- Add `ItemTypeSchema = z.enum(["folder", "file"])`
- Rename fields in `FolderSelectionSchema`: `folderId` -> `itemId`, `folderName` -> `itemName`, add `itemType`, `parentFolderId`, `mimeType`
- Update `FolderSelectionCreateRequestSchema`: rename `folderId` -> `itemId`, `folderName` -> `itemName`, add `itemType: ItemTypeSchema`, `parentFolderId: z.string().nullable()`, `mimeType: z.string().nullable()` (keep existing `sharedDriveId`)
- Rename `DriveFolderSchema` -> `DriveItemSchema`, add `type: z.enum(["folder", "file"])`, add `size: z.number().nullable()` (null for native Google Docs)
- Add `DriveItemListQuerySchema` for `parentId` + `pageToken` query params
- Update `DriveFolderListResponseSchema` -> `DriveItemListResponseSchema`: `items` array + `nextPageToken: z.string().nullable()`

Update barrel: `packages/data-ops/src/folder-selection/index.ts` -- rename exported types/schemas (`DriveFolder` -> `DriveItem`, `DriveFolderSchema` -> `DriveItemSchema`, `DriveFolderListResponseSchema` -> `DriveItemListResponseSchema`, add `DriveItemListQuerySchema`, `ItemTypeSchema`)

## 3. Queries -- `packages/data-ops/src/folder-selection/queries.ts`

Update `createFolderSelections` value mapping:
```ts
const values = selections.map((s) => ({
  employeeId,
  itemId: s.itemId,
  itemName: s.itemName,
  itemType: s.itemType,
  parentFolderId: s.parentFolderId,
  mimeType: s.mimeType,
  sharedDriveId: s.sharedDriveId,
}));
```

Update `getFolderSelectionsByEmployee` -- no query changes needed (returns all columns).

## 4. Config Assembly -- `packages/data-ops/src/config/`

**`queries.ts`** -- Update `ConfigAssemblyData.accounts[].folders[]` type:
```ts
folders: Array<{
  itemId: string;      // was folderId
  itemName: string;    // was folderName
  shared_drive_name: string | null;
  itemType: string;    // new
  parentFolderId: string | null;  // new
  mimeType: string | null;       // new
}>;
```
Update the `selections.map()` to read from renamed columns: `s.itemId`, `s.itemName`, `s.itemType`, `s.parentFolderId`, `s.mimeType`.

**`schema.ts`** -- Update `ConfigJsonSchema.accounts[].folders[]`:
```ts
z.object({
  id: z.string(),
  name: z.string(),
  shared_drive_name: z.string().nullable(),
  type: z.enum(["folder", "file"]).default("folder"),
  parentId: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
})
```

## 5. API Service -- `apps/data-service/src/hono/services/folder-service.ts`

**`listDriveItems(employeeId, parentId, pageToken, env)`** (rename from `listDriveFolders`):
- Signature adds `parentId: string` (default `"root"`) and `pageToken: string | undefined`
- Query: `'${parentId}' in parents and trashed = false` (remove `mimeType = 'application/vnd.google-apps.folder'` filter)
- Fields: `files(id,name,mimeType,size),nextPageToken`, pageSize 200
- Add `pageToken` to URLSearchParams if provided
- Sort: folders first, then files, alphabetical within each group
- Derive `type` from `mimeType === "application/vnd.google-apps.folder"`
- `size`: Google returns `size` as string for non-native files, absent for native Google Docs (`application/vnd.google-apps.*`). Parse to number, default null.
- Return `{ items: DriveItem[], nextPageToken: string | null }`
- No auto-suggestion — employee picks shared drive manually

Keep status update logic (mark `in_progress` on first call -- currently checks `employee.selectionStatus === "pending"`).

**`saveSelections`** -- No logic change, just updated types from schema (fields renamed).

**Import changes**: `DriveFolder` -> `DriveItem`, `FolderSelectionCreateInput` stays same name but has new fields.

## 6. API Handler -- `apps/data-service/src/hono/handlers/folder-handlers.ts`

- `GET /drive/:employeeId` -> add `zValidator("query", DriveItemListQuerySchema)`, pass `parentId`/`pageToken` to `folderService.listDriveItems(employeeId, parentId, pageToken, c.env)`
- `POST /selections` -> no handler changes needed, `FolderSelectionBulkCreateRequestSchema` schema update propagates automatically

## 7. Config Service -- `apps/data-service/src/hono/services/config-service.ts`

Update `buildConfigJson` folder mapping (line ~53-56):
```ts
folders: account.folders.map((f) => ({
  id: f.itemId,
  name: f.itemName,
  shared_drive_name: f.shared_drive_name,
  type: f.itemType,
  parentId: f.parentFolderId,
  mimeType: f.mimeType,
})),
```

## 8. Frontend -- Split `$token.tsx` into components

Current file is ~464 lines; navigator adds ~200. Split:

### `apps/user-application/src/components/employee/drive-navigator.tsx` (NEW, ~250 lines)

Core browsing component:
- **Props**: `employeeId: string`, `dataServiceUrl: string`, `sharedDrives: Array<{ id: string; name: string }>`, `selections: SelectedItem[]`, `onSelectionsChange: (items: SelectedItem[]) => void`
- **State**: `currentParentId` (default "root"), `breadcrumb: {id, name}[]`
- **Fetch**: `useQuery` -> `GET /folders/drive/{employeeId}?parentId={currentParentId}`
- **Loading**: spinner inside folder content area while fetching
- **UI**: Breadcrumb bar -> item list -> "load more" if paginated

**Item row layout**:
```
[ checkbox ] [ folder-icon/file-icon ] ItemName     [ size ]     [ shared drive dropdown ]
```
- Folder name clickable -> navigates into it (appends to breadcrumb)
- Checkbox toggles selection
- File size displayed when available (formatted: KB/MB/GB). Native Google Docs show no size.
- Shared drive dropdown visible only when item checked — populated from `sharedDrives` prop + "Pomijane" (null = skip)
- If inside a selected-parent folder: banner "Ten folder jest juz wybrany -- wszystkie elementy sa uwzglednione" + items shown greyed, checkboxes disabled

**Overlap logic** (auto-remove children):
- On selecting a folder -> filter out any selections whose `parentFolderId` chain includes this folder
- Simple approach: when selecting folder X, remove all selections where `parentFolderId === X.id` (direct children only -- deeper descendants can't exist because you can't select inside a selected folder via the UI)

**Breadcrumb navigation**:
- Track in frontend state as user clicks through (no extra API calls)
- Clicking breadcrumb segment -> sets `currentParentId` to that segment, truncates breadcrumb

### `apps/user-application/src/components/employee/confirm-step.tsx` (EXTRACTED)

Move `ConfirmStep` from `$token.tsx`. Update payload to include `itemType`, `parentFolderId`, `mimeType`. Update field names in POST body: `itemId` (was `folderId`), `itemName` (was `folderName`). Group by shared drive name dynamically (current grouping logic in `ConfirmStep` already does this via `driveIdToName` map).

### Update `apps/user-application/src/routes/employee/$token.tsx`

- Import new components
- **Revised 3-step flow**: OAuth -> Browse & Select -> Confirm (collapse current steps 2+3 into one navigator step)
- State: `selections: SelectedItem[]` instead of `folders: FolderWithDrive[]`
- Remove `FolderListStep` and `DriveAssignmentStep` inline components (replaced by `DriveNavigator`)
- Pass `sharedDrives` from verification response (`verifyEmployeeToken` returns `{ employeeId, deploymentId, sharedDrives }`) to `DriveNavigator`
- Update trust panel text: "Nazwy folderow i plikow na poziomach, ktore przegladasz" (was "Nazwy folderow najwyzszego poziomu") / "Tresci plikow" (keep)
- Update step progress bar from 4 steps to 3

**Interface**:
```ts
interface SelectedItem {
  id: string
  name: string
  mimeType: string
  size: number | null
  type: "folder" | "file"
  selectedSharedDriveId: string | null
  parentFolderId: string | null
}
```

## 9. CLI -- `apps/cli/lib/backup.sh`

In `sync_gdrive_to_local()` loop (line ~52-97), add type check after reading folder fields:
```bash
item_type=$(echo "$folders_json" | jq -r ".[$f].type // \"folder\"")
parent_id=$(echo "$folders_json" | jq -r ".[$f].parentId // empty")
```

- `type: "folder"` -> unchanged `rclone sync` with `--drive-root-folder-id "$folder_id"`
- `type: "file"` -> `rclone copy` with `--drive-root-folder-id "$parent_id" --include "/$folder_name"` (uses `folder_name` var which holds item name)

Target dir for files: `${backup_root}/${sanitized_email}/${shared_drive_name}/_files/${folder_name}`

**Google Docs handling**: Native Google Docs (mimeType `application/vnd.google-apps.*`) have no extension in Drive. rclone's `--include` matches the source name (no extension), then `--drive-export-formats "docx,xlsx,pptx,pdf"` handles export. The `--include "/My Document"` will match the source name and rclone exports as `My Document.docx`. No special handling needed -- same `--drive-export-formats` flag used for both folder and file syncs.

## 10. CLI -- `apps/cli/lib/migration.sh`

Same pattern in `cmd_migrate()` inner loop (line ~98-141):
```bash
item_type=$(echo "$folders_json" | jq -r ".[$f].type // \"folder\"")
parent_id=$(echo "$folders_json" | jq -r ".[$f].parentId // empty")
```

- Folders: unchanged `rclone copy "${remote_name},drive_root_folder_id=${folder_id}:" "$target_path"`
- Files: `rclone copy "${remote_name},drive_root_folder_id=${parent_id}:" "$target_path" --include "/${folder_name}"`

Target path for files: `${WORKSPACE_REMOTE},team_drive=${target_drive_id}:${name}/_files/${folder_name}`

Same Google Docs export handling applies -- `--drive-export-formats` works identically for file-level copies.

## 11. CLI -- `apps/cli/lib/config.sh`

No changes needed -- `cfg_account_folders` (line 82-85) returns raw JSON via `cfg_raw`, callers already read individual fields via jq. New fields (`type`, `parentId`, `mimeType`) become available automatically.

---

## Implementation Order

1. data-ops: table.ts -> generate migration -> schema.ts -> queries.ts -> config/ -> index.ts -> `pnpm build`
2. data-service: folder-service.ts -> folder-handlers.ts -> config-service.ts
3. user-application: drive-navigator.tsx (new) -> confirm-step.tsx (extract) -> $token.tsx (update)
4. CLI: backup.sh -> migration.sh
5. `pnpm run lint:fix`

## Verification

1. `pnpm run drizzle:dev:generate` -- verify migration SQL has column renames + new columns
2. `pnpm run drizzle:dev:migrate` -- apply
3. `pnpm --filter @repo/data-ops build` -- confirm types compile
4. `pnpm run dev:data-service` + `pnpm run dev:user-application`
5. Open employee flow -> OAuth -> verify navigator shows files + folders at root
6. Click into a folder -> verify contents load with spinner during fetch, breadcrumb updates
7. Select a file + assign shared drive -> select parent folder -> verify child auto-deselected
8. Verify file sizes displayed for non-native files, absent for Google Docs
9. Confirm step -> verify payload includes `itemType`, `parentFolderId`, `sharedDriveId`
10. `pnpm run lint` -- clean

## Resolved Decisions

- `pageSize` 200 -- confirmed reasonable
- Zero selections allowed -- update `FolderSelectionBulkCreateRequestSchema` min from 1 to 0
- File backup target dir: `${shared_drive_name}/_files/${filename}` to separate from folder dirs
- Google Docs (native, no extension): rclone `--include` matches source name, `--drive-export-formats` handles export -- no special logic needed
- Auto-suggestion dropped -- employees pick shared drives manually from dropdown
- File size shown in navigator when Google API provides it (null for native Google Docs)
- Loading state: spinner inside folder content area while fetching items

