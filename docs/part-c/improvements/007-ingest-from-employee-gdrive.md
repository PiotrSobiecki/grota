# Ingest from employee Google Drive — pierwszy hop pipeline migracji

## Context

Obecnie pipeline migracji w UI obsluguje tylko hop'y w prawej polowie:

```
[GDrive prywatny pracownika] --(missing in UI)--> [VPS local] --(Backup)--> [B2]
                                                       |
                                                       +--(Migruj: B2->VPS)
                                                       |
                                                       +--(Przywroc do Workspace: VPS->GDrive firmowy)
```

Pierwszy hop (GDrive prywatny pracownika -> VPS lokalny) jest realizowany **tylko przez CLI** na VPSie (`grota backup account <email>` -> `apps/cli/lib/backup.sh:sync_gdrive_to_local`). Admin musi SSH-owac na VPS, czego pierwotny plan UI mial unikac.

**Cel**: domknac pipeline w UI. Nowy przycisk per-pracownik **"Pobierz z Drive"** (lub "Ingest") triggeruje runner job ktory pobiera pliki z prywatnego Drive pracownika do lokalnego katalogu na VPSie. Po nim admin moze juz dzialac istniejacymi przyciskami (Backup do B2, Przywroc do Workspace).

---

## Decyzje

### D1. Nowy typ jobu vs rozszerzenie istniejacego

Nowy typ `ingest` w `migrationJobTypeEnum`. Powod: czyste responsibility, latwy retry per-pracownik, `Backup` zostaje VPS->B2 (tak jak teraz). Spojne z patternem doc 006 (osobny `gdrive-restore`).

### D2. OAuth tokens — kogo uzywamy

`employee.driveOauthToken` (encrypted in DB, set podczas onboardingu pracownika). data-service decryptuje + refreshuje (jak `buildGDriveCredentialsForRunner` z doc 006), wysyla swiezy access_token do runnera.

### D3. Folder selections — kto czyta

data-service czyta `getFolderSelectionsByEmployee(employeeId)` z DB i forward'uje do runnera jako tablica `[{itemId, itemName, itemType, parentFolderId, sharedDriveName, mimeType}]`. Runner nie zna DB — operuje tylko na request body (jak `gdrive-restore`).

`shared_drive_id` FK -> `shared_drives.name` join'owany w data-service przed wyslaniem (runner uzywa nazwy SD jako segmentu sciezki: `<backupPath>/<email>/<sharedDriveName>/<folderName>/`).

### D4. rclone behaviour — folder vs file vs not-assigned

Kopia 1:1 z `apps/cli/lib/backup.sh:52-123`:
- `shared_drive_name == null` -> skip (pracownik wybral folder spoza shared drive admin'a)
- `item_type == 'file'` -> `rclone copy <remote>: <localDir> --drive-root-folder-id <parentId> --include /<filename>`
- `item_type == 'folder'` -> `rclone sync <remote>: <localDir> --drive-root-folder-id <folderId> --backup-dir <versionDir>`
- Eksport Google Docs: `--drive-export-formats docx,xlsx,pptx,pdf`
- Per-folder rc=9 -> OAuth revoked exit 6 (do data-service marked failed + status `oauth_status=failed` na pracowniku)

### D5. Concurrency

Per-deployment lock jak istniejace joby (`getActiveMigrationJob`). `ingest` blokuje inne joby (i odwrotnie). Sequencyjnie per pracownik — `ingest` per-account, nie batch (na razie).

### D6. UI placement

Nowy przycisk **"Pobierz z Drive"** w wierszu pracownika, jako **pierwszy** w sekwencji akcji (przed Backup/Dry-run/Migruj/Przywroc). Disabled gdy `oauth_status != authorized` lub `selection_status != completed` (gotowy = OAuth + foldery wybrane).

Globalnego przycisku "Pobierz dla wszystkich" na razie nie robimy (YAGNI — admin moze klikac per-pracownik, do 50 osob to OK).

---

## Architektura

```
[admin UI: dashboard/$id/migration]
    klik "Pobierz z Drive" przy pracowniku
            |
            v
[user-app server fn: triggerIngestJob]
            |
            v
[data-service POST /admin/migration/ingest]
   1. lookup employee + folderSelections
   2. decrypt+refresh employee.driveOauthToken (helper z doc 006, parametryzowany na zrodle tokenu)
   3. build runnerConfig (B2 not used, ale wymagany przez wspolny RunnerJobConfigSchema)
   4. POST runner /jobs/ingest body: {account, runnerConfig, gdrive, folders[]}
            |
            v
[runner POST /jobs/ingest]
   1. Build rclone config: [b2] + [gdrive_<sanitized_email>] (one remote, employee OAuth)
   2. Loop over folders[]:
      - skip if sharedDriveName missing
      - rclone copy/sync per folder/file (zgodnie z D4)
      - emit log lines per folder
   3. Final exit code: 0 (all OK), 7 (partial fail), 6 (OAuth revoked), 1 (hard fail)
            |
            v
[migration_jobs.type = 'ingest'] persisted, polling/SSE jak teraz
```

---

## Vertical slices

- **Slice 1** (data-ops): rozszerz `migrationJobTypeEnum` o `'ingest'` (DB migration). `IngestRequestSchema` w `runner-protocol.ts` (account email, runnerConfig, gdrive credentials, folders[]). Eksport types. Unit testy (5+).
- **Slice 2** (data-service): `triggerIngest` service — lookup employee, decrypt+refresh token (parametryzowany helper), join folder selections z shared drive names, POST runner. Handler `POST /admin/migration/ingest`. Stany: `EMPLOYEE_NOT_FOUND`, `NO_EMPLOYEE_TOKEN`, `NO_FOLDERS_SELECTED`, `JOB_ALREADY_RUNNING`, `CONFIG_INCOMPLETE`. Integration testy.
- **Slice 3** (runner): `POST /jobs/ingest`. Pure helpers `buildRcloneIngestArgs(folder, cfg)`, `createRunIngest(spawn)`. Loop per folder, per-folder log emit. Unit testy.
- **Slice 4** (UI): nowy przycisk "Pobierz z Drive" w `EmployeeRow`. Server fn `triggerIngestJob`. Confirm dialog. `TYPE_LABEL['ingest'] = 'Pobieranie z Drive'`.
- **Slice 5** (hardening): OAuth revoked -> mark employee.oauth_status='failed' + alert UI. Partial folder failures w jobie -> exit 7, UI badge "Czesciowo". Disk space pre-check.

---

## Open questions

1. **Mass ingest** — czy potrzebny "Pobierz dla wszystkich"? Przy 50 osobach klikanie po jednemu meczace.
2. **Versioning** — CLI robi `--backup-dir <version_dir>` z timestamp'em. Czy na runnerze tez?
3. **Disk space pre-check** — CLI ma `check_disk_space "$backup_root" 10`. Czy port'ujemy do runnera?

---

## Out of scope

- Continuous mirroring / scheduled re-sync
- Per-folder retry (fail w jednym folderze nie robi retry; admin re-trigger'uje cale ingest)
- Streaming progress per-file (juz mamy SSE z linii rclone)

---

## Status (2026-05-07, EOD)

**Stan**: doc napisany, nic nie zaimplementowane. Workaround dla pierwszego wdrozenia: CLI na VPSie (`grota backup account <email>`) + symlink dla zgodnosci sciezki, finalny krok przez UI ("Przywroc do Workspace") dziala.

**Wdrozenie smoke test 2026-05-07** — Contabo VPS `31.220.90.131`, Cloudflare Tunnel `runner.sobiecki.org`:
- ✅ Runner deployed via `install.sh --no-clone` (po fix `git init` + reset --hard z PAT-less GIT_TERMINAL_PROMPT=0, repo publiczne)
- ✅ Runner crash fixed: re-eksport `GDriveRestoreRequestSchema` w `data-ops/migration/index.ts` (commit 587f1b1)
- ✅ Email edit + add employee shipped (commit a315df2)
- ✅ Email pracownika edytowalny w admin UI (literowka recovery)
- ✅ CLI `grota backup` works: `piotr.sobiecki@gmail.com` -> 1 plik sciagniety do `/srv/backup/gdrive/piotr_sobiecki_gmail_com/dupa/_files/`
- ✅ Symlink `piotr.sobiecki@gmail.com -> piotr_sobiecki_gmail_com` zalozony rerznie
- ✅ "Przywroc do Workspace" w UI dziala (potwierdzone na produkcji)

**Znane bugi (do fixu w slice'ach 7)**:
1. **Email sanitization mismatch**: CLI zapisuje pod `<sanitized_email>` (`@.` -> `_`), runner gdrive-restore szuka pod `<raw_email>`. Workaround: symlink. Fix: ujednolicic w `runner-protocol.ts` + `run-gdrive-restore.ts:36,52` (sanitize'uj account przed budowa sourcePath).
2. **B2 per-shared-drive bucket**: CLI tworzy bucket per shared drive (`<bucket_prefix>-<sd_name>`), ale B2 application key jest zwykle restricted do jednego buketu. Fix: albo (a) jeden bucket z prefix per SD, albo (b) jasna instrukcja w UI ze key musi byc unrestricted. Pomijamy w doc 007, oddzielny ticket.
3. **install.sh: brak instrukcji o cloudflared credentials copy**: install.sh nie kopiuje `/root/.cloudflared/*.json` -> `/etc/cloudflared/`. README ma wpisane, ale install.sh moglby to robic.

**Pending changes (uncommitted, lokalne edycje)**:
- `apps/data-service/wrangler.jsonc` + `apps/user-application/wrangler.jsonc` + `apps/cli/grota.env.example`: domain migration `auditmos.com` -> `sobiecki.org` (po decyzji ze auditmos to nie nasza strefa). NIE commitowane — user chce dokonczyc lokalny test najpierw.
- TODO przed deployem domain change: zaktualizowac `apps/user-application/.env` (`VITE_DATA_SERVICE_URL`, `BETTER_AUTH_BASE_URL`), zrobic wrangler secret update jezeli `BETTER_AUTH_BASE_URL` jest secrettem, footer link w `landing/footer.tsx:32` (auditmos.com -> sobiecki.org? do potwierdzenia z user'em).
- Ostrzezenie: zmiana `BETTER_AUTH_BASE_URL` invalidatuje sesje (cookie domain-bound).

---

## Plan na poniedzialek (2026-05-09+)

**Priorytet A — domain migration `sobiecki.org`**:
1. Update `apps/user-application/.env` + `.env.production`/`staging` jezeli istnieja
2. Decyzja o footer link (auditmos.com vs sobiecki.org)
3. Wrangler secret update dla `BETTER_AUTH_BASE_URL` (production + staging)
4. Commit + push + deploy production data-service & user-application
5. Cloudflare auto-stworzy DNS dla nowych hostnames; usunac stare custom_domain routes na auditmos.com (recznie w dashboardzie)

**Priorytet B — implementacja doc 007 (UI-driven ingest)**:
- **Slice 1** (data-ops, ~30 min): `migrationJobTypeEnum` += `'ingest'` + DB migration. `IngestRequestSchema` w `runner-protocol.ts`. Eksport types. Unit testy.
- **Slice 2** (data-service, ~1.5h): `triggerIngest` service — lookup employee, decrypt+refresh `driveOauthToken` (refactor wspolnego helpera z `gdrive-restore`), join folder selections z shared drive names, POST runner. Handler `POST /admin/migration/ingest`. Stany bledow. Integration testy.
- **Slice 3** (runner, ~1h): `POST /jobs/ingest`. Pure helpers `buildRcloneIngestArgs` (per-folder/file zgodnie z D4). Loop per folder, per-folder log emit. Sanityzacja email -> spojna z CLI (fix bug #1). Unit testy.
- **Slice 4** (UI, ~45 min): przycisk "Pobierz z Drive" w `EmployeeRow`. Server fn `triggerIngestJob`. `TYPE_LABEL['ingest']`. Confirm dialog.
- **Slice 5** (hardening, ~30 min): OAuth revoked handling, partial failures, disk space pre-check.

**Priorytet C — fix bug #1 (path sanitization)**:
- Mozna zlatac w slice 3 (runner ujednolica sanityzacje).
- Po fixie usunac symlink na VPSie.
