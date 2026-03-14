# Drill-in File/Folder Selection for Employee Backup Flow

## Context

Employees currently select whole top-level Drive folders for backup/migration. They need to browse into folders and select individual files or subfolders too. This enables finer-grained control -- e.g. picking 3 files from a large folder instead of backing up everything.

**Key decisions**: Navigator pattern (one level at a time, not tree), whole-folder semantics preserved, per-item drive assignment (no auto-suggestion — employee picks manually), auto-deselect children when parent selected, updated trust panel text, file size shown when available.

**Prerequisite**: Doc 003 (Dynamic Shared Drives) must be implemented first — this doc uses `sharedDriveId`/`shared_drive_name` instead of category.

---

## 1. DB Migration -- `packages/data-ops/src/folder-selection/table.ts`

Rename columns + add 3 new:
- `folder_id` -> `item_id`, `folder_name` -> `item_name`
- Add `item_type` pgEnum(`folder`, `file`), NOT NULL, default `'folder'`
- Add `parent_folder_id` text, nullable (null = root)
- Add `mime_type` text, nullable

Generate + apply migration: `pnpm run drizzle:dev:generate && pnpm run drizzle:dev:migrate`

Safe: `saveSelections` does delete-all + re-insert, no data migration concerns.

## 2. Schemas & Types -- `packages/data-ops/src/folder-selection/schema.ts`

- Add `ItemTypeSchema = z.enum(["folder", "file"])`
- Rename fields in `FolderSelectionSchema`: `itemId`, `itemName`, add `itemType`, `parentFolderId`, `mimeType`
- Update `FolderSelectionCreateRequestSchema` with new fields + `sharedDriveId` (from doc 003)
- Rename `DriveFolderSchema` -> `DriveItemSchema`, add `type: z.enum(["folder", "file"])`, add `size: z.number().nullable()` (null for native Google Docs)
- Add `DriveItemListQuerySchema` for `parentId` + `pageToken` query params
- Update `DriveFolderListResponseSchema` -> `DriveItemListResponseSchema`: `items` array + `nextPageToken` nullable

Update barrel: `packages/data-ops/src/folder-selection/index.ts`

## 3. Queries -- `packages/data-ops/src/folder-selection/queries.ts`

Update `createFolderSelections` to map: `itemId`, `itemName`, `itemType`, `parentFolderId`, `mimeType`, `sharedDriveId`.

## 4. Config Assembly -- `packages/data-ops/src/config/`

**`queries.ts`** -- Update `ConfigAssemblyData.accounts[].folders[]` to include `itemType`, `parentFolderId`, `mimeType` (read from renamed columns).

**`schema.ts`** -- Update `ConfigJsonSchema.accounts[].folders[]`:
```
{ id, name, shared_drive_name, type: enum("folder","file").default("folder"), parentId: string|null, mimeType: string|null }
```

## 5. API Service -- `apps/data-service/src/hono/services/folder-service.ts`

**`listDriveItems(employeeId, parentId, pageToken, env)`** (rename from `listDriveFolders`):
- Query: `'${parentId}' in parents and trashed = false` (remove mimeType filter)
- Fields: `files(id,name,mimeType,size)`, pageSize 200
- Sort: folders first, then files, alphabetical
- Derive `type` from `mimeType === "application/vnd.google-apps.folder"`
- `size`: Google returns `size` as string for non-native files, null for native Google Docs (`application/vnd.google-apps.*`)
- Return `{ items: DriveItem[], nextPageToken: string | null }`
- No auto-suggestion — employee picks shared drive manually

Keep status update logic (mark `in_progress` on first call).

**`saveSelections`** -- No logic change, just updated types from schema.

## 6. API Handler -- `apps/data-service/src/hono/handlers/folder-handlers.ts`

- `GET /drive/:employeeId` -> add `zValidator("query", DriveItemListQuerySchema)`, pass `parentId`/`pageToken` to service
- `POST /selections` -> uses updated `FolderSelectionBulkCreateRequestSchema`

## 7. Config Service -- `apps/data-service/src/hono/services/config-service.ts`

Update `buildConfigJson` folder mapping:
```ts
{ id: f.itemId, name: f.itemName, shared_drive_name: f.sharedDriveName, type: f.itemType, parentId: f.parentFolderId, mimeType: f.mimeType }
```

## 8. Frontend -- Split `$token.tsx` into components

Current file is ~450 lines; navigator adds ~200. Split:

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

Move `ConfirmStep` from `$token.tsx`. Update payload to include `itemType`, `parentFolderId`, `mimeType`. Group by shared drive name dynamically.

### Update `apps/user-application/src/routes/employee/$token.tsx`

- Import new components
- **Revised 3-step flow**: OAuth -> Browse & Select -> Confirm
- State: `selections: SelectedItem[]` instead of `folders: FolderWithCategory[]`
- Pass `sharedDrives` from verification response (doc 003§4f) to `DriveNavigator`
- Update trust panel text: "Nazwy folderow i plikow na poziomach, ktore przegladasz" / "Tresci plikow"

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

In `sync_gdrive_to_local()` loop, add type check:
```bash
item_type=$(echo "$folders_json" | jq -r ".[$f].type // \"folder\"")
```

- `type: "folder"` -> unchanged `rclone sync` with `--drive-root-folder-id`
- `type: "file"` -> `rclone copy` with `--drive-root-folder-id "$parent_id" --include "/$file_name"`

Target dir for files: `${backup_root}/${sanitized_email}/${shared_drive_name}/_files/${file_name}`

**Google Docs handling**: Native Google Docs (mimeType `application/vnd.google-apps.*`) have no extension in Drive. rclone's `--include` matches the source name (no extension), then `--drive-export-formats "docx,xlsx,pptx,pdf"` handles export. The `--include "/My Document"` will match the source name and rclone exports as `My Document.docx`. No special handling needed -- same `--drive-export-formats` flag used for both folder and file syncs.

## 10. CLI -- `apps/cli/lib/migration.sh`

Same pattern in `cmd_migrate()` loop:
- Folders: unchanged rclone copy
- Files: `rclone copy "${remote_name},drive_root_folder_id=${parent_id}:" "$target_path" --include "/${file_name}"`

Target path for files: `${WORKSPACE_REMOTE},team_drive=${target_drive_id}:${name}/_files/${file_name}`

Same Google Docs export handling applies -- `--drive-export-formats` works identically for file-level copies.

## 11. CLI -- `apps/cli/lib/config.sh`

No changes needed -- `cfg_account_folders` returns raw JSON, callers already read individual fields via jq.

---

## Implementation Order

1. data-ops: table.ts -> generate migration -> schema.ts -> queries.ts -> config/ -> index.ts -> `pnpm build`
2. data-service: folder-service.ts -> folder-handlers.ts -> config-service.ts
3. user-application: drive-navigator.tsx (new) -> confirm-step.tsx (extract) -> $token.tsx (update)
4. CLI: backup.sh -> migration.sh
5. `pnpm run lint:fix`

## Verification

1. `pnpm run drizzle:dev:generate` -- verify migration SQL looks correct
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
