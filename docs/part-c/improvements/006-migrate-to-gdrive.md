# Migrate to GDrive — drugi hop pipeline migracji

## Context

Obecnie pipeline migracji w UI obsluguje **tylko hop B2 → /srv/backup/gdrive** (lokalny VPS). Brakuje finalnego kroku: skopiowanie danych z VPSa do **docelowego konta Google** (zwykle: shared drive na koncie firmowym Workspace, nie konto pracownika).

**Po stronie use-case'u**: pracownik X opuszcza firme → admin chce przejac jego pliki na Workspace shared drive Y. Pipeline powinien zrobic to bez angazowania pracownika (admin ma OAuth Workspace, pracownik nie musi nic klikac).

---

## Decyzje do zrobienia

### D1. Target identity — gdzie ladujemy pliki?

| Opcja | Plus | Minus |
|-------|------|-------|
| **A** Shared drive na deployment (jeden per klient) | Najprostszy model, juz mamy `shared_drives` table | Brak granularnosci per-pracownik |
| **B** Folder per pracownik na shared drive | Latwiej przegladac | Wieksza zlozonosc — runner musi tworzyc foldery |
| **C** Konto docelowe per pracownik (np. nowy email) | Pelna izolacja | Wymaga drugiego OAuth flow per-employee |

**Rekomendacja: A z opcjonalnym B w v2**. Shared drive z folderem `<email-pracownika>/` jako convention. Runner tworzy folder jezeli brak.

### D2. OAuth tokens — jakim kontem rclone laczy sie z GDrive?

**Workspace OAuth token** (`deployment.workspaceOauthToken`) — admin Workspace ma dostep do shared drives. Wystarczy ze rclone uzyje tego tokenu jako gdrive remote.

**Wymagane scopes**: `drive.file` (zapis tylko do plikow stworzonych przez aplikacje) lub `drive` (full). Sprawdzic co jest obecnie zadane podczas onboardingu admina (`004a-encryption-oauth-backend-admin.md`).

### D3. Kiedy rclone z GDrive?

| Opcja | Plus | Minus |
|-------|------|-------|
| **X** Nowy job `migrate-to-gdrive` (osobny od `migrate`) | Czyste responsibility, nie laczy z istniejacym B2 sync | Drugi job do trigger'owania w UI |
| **Y** Rozszerzenie istniejacego `migrate` o flag `targetType` (b2 vs gdrive) | Jeden flow w UI | Mieszanie odpowiedzialnosci, runnerConfig wybucha |
| **Z** Two-step w jednym jobie: `migrate` robi `B2 → /srv/backup/gdrive` **i** `/srv/backup/gdrive → gdrive:` | UX: jedno klikniecie | Fail po pol-drogi trudniejszy do recovery |

**Rekomendacja: X**. Nowy typ `gdrive-restore` w `migration_jobs.type` enum. UI ma osobny przycisk "Przywroc do Workspace" obok "Migruj" (B2 only). Latwiejsze testowanie i monitoring.

### D4. rclone GDrive config — credential format

rclone wspiera dwa tryby:
- **Service account** (JSON key) — nie nasz przypadek
- **OAuth client + token JSON** — token JSON musi zawierac `access_token`, `refresh_token`, `token_type`, `expiry`

`workspaceOauthToken` w DB zawiera juz **encrypted token JSON** (Better Auth/Google OAuth). Format zapewne `{access_token, refresh_token, expiry, ...}` — sprawdzic czy bezposrednio kompatybilny z rclone.

**rclone GDrive remote**:
```ini
[gdrive]
type = drive
client_id = <google-cloud-oauth-client-id>
client_secret = <google-cloud-oauth-client-secret>
token = {"access_token":"...","refresh_token":"...","expiry":"..."}
team_drive = <shared-drive-id>   # opcjonalne
root_folder_id = <folder-id>     # opcjonalne
```

`client_id`/`client_secret` — z naszego Google Cloud projektu (te same co Better Auth uzywa). Trzymane gdzie? `deployment.workspaceOauthToken` ma chyba tylko token, nie creds. **Kandydat na nowy env var**: `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` na data-service.

### D5. Token refresh — kto wykonuje?

rclone potrafi sam refreshowac token (uzywa `refresh_token` + `client_id`/`client_secret`). Po sukcesie zapisuje **nowy access_token + expiry** do configu. Ale w naszym setupie config jest tymczasowy (mkdtemp + rm), wiec refresh jest zgubiony.

**Implikacja**: kazdy job ladujacy do GDrive zaczyna od fresh OAuth refresh. Albo:
- runner po jobie odsyla zaktualizowany token z powrotem do data-service (nowe RPC)
- albo robi refresh w data-service przed wyslaniem do runnera (data-service ma `refresh_token` → wymienia na fresh `access_token` przez Google OAuth API → wysyla do runnera tylko swiezy `access_token`)

**Rekomendacja**: data-service refreshuje przed wyslaniem. Czystsze (single source of truth dla tokenu), bezpieczniejsze (runner widzi tylko short-lived access_token, nie refresh). Wymaga implementacji `refreshGoogleToken()` w data-service.

### D6. Folder structure na GDrive

`/Workspace Shared Drive/<deployment.clientName>/<employee.email>/` lub plaski `/Workspace SD/<email>/`?

Per-deployment grouping ma sens jezeli na jednym Workspace SD lezy >1 klient. **Pytanie do uzytkownika**: czy jeden Workspace = jeden klient, czy wielu?

---

## Proponowana architektura (po decyzjach)

```
[admin UI: dashboard/$id/migration]
    klik "Przywroc do Workspace" przy pracowniku
            |
            v
[user-app server fn triggerGDriveRestore]
            |
            v
[data-service POST /admin/migration/gdrive-restore]
   1. decrypt workspaceOauthToken
   2. POST do Google OAuth z refresh_token → fresh access_token + expiry
   3. POST runner /jobs/gdrive-restore
        body: { account, b2Config, gdriveAccessToken, gdriveSharedDriveId, ... }
            |
            v
[runner POST /jobs/gdrive-restore]
   1. Check: lokalny katalog /srv/backup/gdrive/<email> istnieje?
      Jezeli nie: rclone sync b2:bucket/<email> /srv/backup/gdrive/<email>
   2. rclone sync /srv/backup/gdrive/<email> gdrive:/<email>/
        (gdrive remote z ephemeral access_token, team_drive=<sharedDriveId>)
   3. Logi przez ring buffer + SSE jak istniejace joby
            |
            v
[migration_jobs.type = 'gdrive-restore'] zapisany w DB, tracking jak teraz
```

---

## Implementation log

- **2026-05-07** — Slice 5b (krytyczny fix): pliki teraz faktycznie laduja na **shared drive firmowy**, nie na "My Drive" admina. `triggerGDriveRestore` czyta `getSharedDrivesByDeployment` — bierze `googleDriveId` pierwszego SD z googleDriveId set, doklada do request body jako `gdrive.sharedDriveId` → runner buduje rclone z `team_drive=<sharedDriveId>` w `[gdrive]` block (juz wczesniej zaimplementowane w Slice 3, ale data-service nie wysylal ID). Nowy stan `NO_SHARED_DRIVE` (400) gdy deployment nie ma shared drive z googleDriveId. Pracownik nic nie traci — pliki sa kopiowane (nie wycinane) z lokalnej kopii VPSa do shared drive Workspace. 2 nowe integration testy (forwards sharedDriveId, NO_SHARED_DRIVE error). 39/39 GREEN.

- **2026-05-07** — Slice 5 GREEN (hardening): (a) Pre-check w `createRunGDriveRestore` — `PathExistsFn` DI, default = `realPathExists` (`fs.access`). Gdy `<backupPath>/<account>` nie istnieje, runner emit'uje stderr z czytelnym komunikatem "source path ... does not exist — uruchom najpierw Migrate (B2 -> lokalny)" i exit 2 **bez spawnowania rclone**. Operator widzi w live-logs co poszlo nie tak, zamiast krzaczastego rclone errora. 1 nowy test (60/60 GREEN). (b) UI label dla `gdrive-restore` przez `TYPE_LABEL` mapping — w karcie Aktywny job + Historia widać "Przywracanie do Workspace" zamiast technicznego stringa. Audit po stronie DB juz pokryty przez `migration_jobs.triggered_by_user_id`. Token refresh retry pominiety jako YAGNI (Google rzadko 5xx; bedziemy reagowac na realne incydenty).

- **2026-05-07** — Slice 4 GREEN: UI button "Przywroc do Workspace" per-pracownik. `MigrationJobDto.type` rozszerzony o `'gdrive-restore'`. `TriggerGDriveRestoreInput` schema (deploymentId uuid + account email required). `triggerGDriveRestoreJob` server fn w `binding.ts` — POST do `/admin/migration/gdrive-restore` przez `postAdminMigration` (X-Operator-Id z context). Mutation `gdriveRestoreMutation` w `migration.tsx`, props `onGDriveRestore` w `EmployeeRow`. Nowy komponent `GDriveRestoreRowButton` z `AlertDialog` confirm (tekst wyjasnia: lokalna sciezka → GDrive folder, wymaga wczesniejszego Migrate). Disabled gdy aktywny job lub niegotowy pracownik. Types OK.

- **2026-05-07** — Slice 3 GREEN: runner endpoint `POST /jobs/gdrive-restore`. Pure helpers w `apps/runner/src/run-gdrive-restore.ts`: `buildRcloneGDriveConfig(creds)` — `[gdrive]` block z `type=drive`, `client_id`, `client_secret`, `token=<JSON>` (z `access_token`/`refresh_token`/`expiry`/`token_type=Bearer`), opcjonalny `team_drive=sharedDriveId`. `buildRcloneGDriveRestoreArgs(req)` — `sync <backupPath>/<account> gdrive:<targetFolder|account> --config <tmp> -v`. `createRunGDriveRestore(spawn)` factory — laczy `[b2]` (z `buildRcloneB2Config`) + `[gdrive]` w jednym configu (B2 dostepne jako fallback w przyszlosci). `realRcloneSpawnForGDriveRestore` pisze conf do mkdtemp chmod 600, sprzata w finally. `app.ts`: nowy `RunGDriveRestoreFn` type, `JobType` enum rozszerzony o `'gdrive-restore'`, route `jobRoute("/jobs/gdrive-restore", "gdrive-restore", GDriveRestoreRequestSchema, runGDriveRestore)`. Per-type concurrency: backup running nie blokuje gdrive-restore. `index.ts` wpina `createRunGDriveRestore(realRcloneSpawnForGDriveRestore)` jako real impl. 6 nowych testow unit (config builder happy + sharedDriveId + omits-when-absent, args sync + targetFolder override, factory captures config). 59/59 GREEN.

- **2026-05-07** — Slice 2 GREEN: data-service `triggerGDriveRestore` w `migration-service.ts`. Helper `buildGDriveCredentialsForRunner(deploymentId, env)` — decrypt `workspaceOauthToken`, refresh przez Google OAuth jezeli `expiry_date < now` (uses `GOOGLE_CLIENT_ID/SECRET`), persist updated token, return `{clientId, clientSecret, accessToken, refreshToken, expiry}`. Stany: `NO_WORKSPACE_TOKEN`/`TOKEN_DECRYPT_FAILED`/`TOKEN_REFRESH_FAILED`. `triggerGDriveRestore` reuses pattern z `triggerMigrate`: NOT_FOUND, JOB_ALREADY_RUNNING, CONFIG_INCOMPLETE (runner config), CONFIG_INCOMPLETE_B2, posts do runner `/jobs/gdrive-restore` z body `{account, runnerConfig, gdrive}`. Handler `POST /admin/migration/gdrive-restore` z `TriggerGDriveRestoreRequestSchema` (deploymentId uuid + account email **required** — w przeciwienstwie do backup/migrate, gdrive-restore zawsze per-employee). 1 nowy integration tracer test (happy path, asercja na body sent + persisted row). 37/37 GREEN.

- **2026-05-07** — Slice 1 GREEN: `migrationJobTypeEnum` rozszerzony o `'gdrive-restore'` (migracja `0014_wet_mongoose.sql`). `MigrationJobTypeSchema` zaktualizowany (Zod). Nowe schematy w `runner-protocol.ts`: `GDriveCredentialsSchema` (clientId, clientSecret, accessToken, refreshToken, expiry datetime, opcjonalne sharedDriveId + targetFolder) + `GDriveRestoreRequestSchema` (account email required, runnerConfig required, gdrive required). Eksport types `GDriveCredentials` + `GDriveRestoreRequest`. 5 nowych testów (complete valid, requires account/gdrive/runnerConfig, rejects invalid email). 64/64 unit GREEN.

## Vertical slices

- **Slice 1** ✅ (data-ops): rozszerzenie `migrationJobTypeEnum` o `'gdrive-restore'`. Zod schema `GDriveRestoreRequestSchema` w `runner-protocol.ts` (account, b2Config, gdriveAccessToken, sharedDriveId, gdriveTargetFolder?). Migration DB.
- **Slice 2** ✅ (data-service): helper `buildGDriveCredentialsForRunner` (uses GOOGLE_CLIENT_ID/SECRET env, decrypt + refresh + re-encrypt). Endpoint `/admin/migration/gdrive-restore` + service `triggerGDriveRestore`. Forwards refresh + new request to runner.
- **Slice 3** ✅ (runner): nowy endpoint `POST /jobs/gdrive-restore`. `buildRcloneGDriveConfig(token, ...)` pure helper. `createRunGDriveRestore(spawn)` factory. Wpiety w `index.ts`.
- **Slice 4** ✅ (UI): nowy przycisk per-pracownik "Przywroc do Workspace" (z confirm dialog). Server fn `triggerGDriveRestoreJob`. Polling jak teraz.
- **Slice 5** ✅ (hardening): pre-check zrodla (early-fail z exit 2 + stderr); UI TYPE_LABEL mapping; audit przez `migration_jobs.triggered_by_user_id`; token refresh retry pominiety (YAGNI).

---

## Open questions (dla usera)

1. **D6 folder structure** — jeden Workspace = jeden klient (plaski) czy wielu (per-deployment grouping)?
2. **Czy `client_id`/`client_secret` Google OAuth jest juz w env data-service?** Jezeli nie — dodaj jako Worker secrets.
3. **Czy admin OAuth tokeny majek scope `drive`** (read+write na shared drive)? Jezeli tylko `drive.readonly` — trzeba reonboardowac admina.
4. **Czy rclone na VPSie ma `--drive-token` / `--drive-client-id` flags** w wersji 1.53? (apt rclone 1.53-DEV jest stary — moze warto upgrade'owac na binarke z rclone.org).

---

## Out of scope (przyszle)

- Per-employee target accounts (D1.C)
- Bidirectional sync / continuous mirroring
- Restore z konkretnego punktu w czasie (B2 versioning)
- Powiadomienia mailem do pracownika ze pliki przeniesione
