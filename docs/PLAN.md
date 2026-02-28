# Grota — Google Backup & Access Reorganization

## Context

Reusable toolkit dla klientów z profilem:
- 5-15 prywatnych kont Google z dokumentami firmowymi
- 1 Workspace Business Starter (docs-only migration, bez upgrade'u)
- 1-5TB danych (docs + media/wideo)
- Serwer lokalny (opcjonalny) + Backblaze B2 (3-2-1 rule)
- Reorganizacja dostępu (group-based permissions)

**Dwie warstwy**: Grota Web (onboarding portal, CF Workers) + Grota Server (backup scripts).
**Nazwa**: **GROTA** — **G**oogle **R**eorganize, **O**nboard, **T**ransfer, **A**rchive

## Decyzja: Workspace storage

Business Starter = 30GB → **migracja tylko dokumentów/faktur** do Workspace Shared Drives.
Wideo/media zostaje na kontach prywatnych, backupowane bezpośrednio.
Bez upgrade'u planu Workspace.

---

## Architektura

```
Operator (admin dashboard)
    │ creates deployment, sends magic links
    ▼
CF Workers Web App (TanStack Start + Hono)
    │
    ├── Client admin: fills config, authorizes OAuth, adds employees
    ├── Employees: authorize Drive, tag top-level folders
    │
    ├── Neon Postgres: users, deployments, employees, folder selections
    └── R2: deployment config JSONs (operator's R2, nie klienta)
            │
            ▼
Server scripts (rclone, terraform) read config from R2
    │
    ├── Serwer lokalny (/srv/backup/gdrive/)   ← jeśli klient ma serwer
    │       │  rclone sync
    │       ▼
    └── Backblaze B2 (per-category buckets, SSE-B2 AES-256)
```

**Web stack**: TanStack Start + Hono + Drizzle + Neon Postgres + CF Workers
**Server stack**: rclone + bash + terraform + systemd timers
**Template**: `auditmos/saas-on-cf`
**OAuth**: one shared GCP app for all clients
**Email**: Resend (magic links)
**Encryption**: libsodium app-level (OAuth tokens at rest)
**R2 sync**: server polls R2 + operator can trigger manually
**Alerty**: Telegram Bot API (webhook endpoint in data-service)

---

# PART A: Grota Web (Onboarding Portal)

## User Roles

| Role | Auth | Capabilities |
|------|------|-------------|
| Operator | email/password | CRUD deployments, see all progress, export config |
| Client admin | magic link | onboarding wizard, authorize Workspace OAuth, add employees |
| Employee | magic link | authorize Drive OAuth, tag folders |

## Flows

### 1. Operator → Create Deployment
- Login → dashboard → "New deployment"
- Fills: client name, domain
- Gets shareable magic link for client admin

### 2. Client Admin → Onboarding Wizard
- Opens magic link → lands on wizard
- **Step 1**: Company info (domain auto-filled, Workspace details)
- **Step 2**: Google OAuth consent (scope: `admin.directory.group`, `drive`) → token stored
  - Before consent screen: **trust panel** — "Co zobaczymy: listę folderów i nazwy plików. Czego NIE zobaczymy: treści dokumentów. Tokeny szyfrowane AES-256, usuwane na żądanie."
- **Step 3**: Instructions to add operator as Workspace admin delegate (manual, checklist with screenshots + checkbox confirmation "Dodałem/am delegata")
- **Step 4**: Employee list (email, name, role: księgowość/zarząd/projekty/media)
- **Step 5**: B2 / server config (optional — operator can fill later)
- Submit → employees auto-receive magic links via email
- Client admin gets own magic link to **readonly progress page** (`/status/{token}`)
  - Shows: "3/7 pracowników ukończyło" + lista kto nie
  - "Wyślij ponownie" button per employee (re-sends magic link)

### 3. Employee → File Selection
- Opens magic link → authorization page
- **Step 1**: Authorize Google Drive (OAuth, scope: `drive.readonly`) → token stored
  - Before consent: **trust panel** — "Aplikacja zobaczy tylko nazwy folderów. Nie czyta treści plików. Możesz cofnąć dostęp w dowolnym momencie w ustawieniach Google."
- **Step 2**: App fetches top-level Drive folders via Google Drive API
- **Step 3**: Employee tags each folder: `dokumenty` / `projekty` / `media` / `prywatne` (skip)
  - Category tooltips: `dokumenty` = "faktury, umowy, księgowość", `projekty` = "dokumentacja projektowa", `media` = "zdjęcia, filmy", `prywatne` = "pomijane"
  - Auto-suggestion: string match na nazwie folderu ("Faktury" → `dokumenty`, "Projekty" → `projekty`, "Film"/"Zdjęcia" → `media`). Pracownik potwierdza/zmienia
- **Step 4**: Confirm → status updated on dashboard

### 4. Config Export → R2
When all employees done (or operator triggers manually):
- Generate config JSON combining: deployment info + employee tokens + folder mappings
- Upload to R2: `configs/{deployment_id}/config.json`
- Notify operator (Telegram via data-service webhook)
- Email summary to client admin: "Onboarding ukończony. X pracowników, Y folderów, ~Z TB"

### 5. Operator → Server Execution
- Downloads config or server pulls from R2 directly
- Config maps to `deployment.conf` + `accounts.conf` format
- Runs backup pipeline (manual or scripted)

## Data Model (Drizzle)

```
deployments
  id: uuid PK
  client_name: text
  domain: text
  status: enum(draft, onboarding, employees_pending, ready, active)
  workspace_oauth_token: text (encrypted, libsodium app-level)
  b2_config: jsonb (optional)
  server_config: jsonb (optional)
  r2_config_key: text (R2 object key)
  created_by: text FK → auth_user
  created_at, updated_at: timestamp

employees
  id: uuid PK
  deployment_id: uuid FK → deployments
  email: text
  name: text
  role: enum(zarzad, ksiegowosc, projekty, media)
  oauth_status: enum(pending, authorized, failed)
  selection_status: enum(pending, in_progress, completed)
  drive_oauth_token: text (encrypted, libsodium app-level)
  magic_link_token: text
  magic_link_expires_at: timestamp
  created_at, updated_at: timestamp

folder_selections
  id: uuid PK
  employee_id: uuid FK → employees
  folder_id: text (Google Drive folder ID)
  folder_name: text
  category: enum(dokumenty, projekty, media, prywatne)
  size_bytes: bigint (approximate)
  created_at: timestamp
```

## Template Adaptations (saas-on-cf)

### Keep:
- Monorepo (apps/user-application, apps/data-service, packages/data-ops)
- TanStack Start + Hono + Drizzle + Neon Postgres
- Biome, pnpm workspaces, wrangler multi-env, service binding

### Modify:
- **Auth**: Better Auth magic link plugin + Google OAuth provider
- **Schema**: Replace `clients` → `deployments`, `employees`, `folder_selections`
- **Routes**: Replace CRUD demo → deployment wizard + employee flow
- **Landing**: Rebrand

### Add:
- **R2 binding** on data-service for config JSON storage
- **Google Drive API** integration (list folders, get metadata)
- **Magic link email** via Resend
- **Telegram alerts** endpoint in data-service (Bot API, `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` secrets)

## Pages / Routes

```
/                           → landing
/signin                     → operator login
/magic/{token}              → magic link handler (client/employee)

/_auth/dashboard/           → operator: list deployments
/_auth/dashboard/new        → operator: create deployment
/_auth/dashboard/{id}       → operator: deployment detail + progress
/_auth/dashboard/{id}/config → operator: edit config, export JSON

/onboard/{token}            → client admin wizard (steps 1-5)
/status/{token}             → client admin: readonly progress + resend links
/employee/{token}           → employee: authorize + folder selection
```

## Config JSON Output (R2)

```json
{
  "deployment_id": "uuid",
  "client_name": "FirmaXYZ",
  "domain": "firma.pl",
  "created_at": "2026-02-25T...",
  "workspace": {
    "oauth_refresh_token": "...",
    "shared_drives": ["Firma-Dokumenty", "Firma-Projekty"]
  },
  "accounts": [
    {
      "email": "jan@gmail.com",
      "name": "Jan Kowalski",
      "role": "ksiegowosc",
      "oauth_refresh_token": "...",
      "folders": [
        { "id": "abc123", "name": "Faktury 2024", "category": "dokumenty" },
        { "id": "def456", "name": "Projekty", "category": "projekty" },
        { "id": "ghi789", "name": "Filmy firmowe", "category": "media" }
      ]
    }
  ],
  "b2": { "key_id": "...", "app_key": "..." },
  "server": { "backup_path": "/srv/backup/gdrive/", "bwlimit": "08:00,5M 23:00,50M" }
}
```

---

# PART B: Grota Server (Backup Scripts)

## Repo structure (server)

```
scripts/
├── lib/
│   ├── common.sh               # logging, locking, disk check
│   ├── config.sh               # config loader (reads R2 JSON or local file)
│   ├── secrets.sh              # pluggable secret backend (vault/env/file)
│   └── notify.sh               # calls data-service alert endpoint → Telegram
├── setup/
│   ├── init-rclone-from-config.sh  # generates rclone.conf from R2 JSON
│   ├── init-b2-remote.sh       # B2 rclone remote config
│   └── verify-remotes.sh       # test all configured remotes
├── backup/
│   ├── sync-gdrive-to-local.sh # single account GDrive → local
│   ├── sync-local-to-b2.sh     # local → B2 per category
│   ├── backup-account.sh       # single account full pipeline
│   └── backup-all.sh           # orchestrator
├── migration/
│   ├── migrate-to-shared-drive.sh  # private → Shared Drive (server-side copy)
│   └── verify-migration.sh         # file count + diff report
├── audit/
│   ├── permission-audit.sh     # list permissions per Shared Drive
│   ├── storage-report.sh       # disk usage per account/bucket
│   └── backup-verify.sh        # integrity check (rclone check)
└── cron/
    └── install-timers.sh       # install systemd timers

terraform/
├── main.tf, variables.tf, outputs.tf, versions.tf
├── terraform.tfvars.example
└── modules/b2-bucket/          # bucket + lifecycle + app key
```

**Key change**: `init-rclone-remote.sh` (manual OAuth) → `init-rclone-from-config.sh` (reads tokens from R2 JSON). OAuth flow happens in web app, not on server.

## Shared Drives (docs-only, fits in 30GB)

```
Firma-Dokumenty: Faktury/{rok}/, Umowy/, Administracja/, Szablony/
Firma-Projekty:  {project-name}/
```

Media/wideo NIE migruje do Workspace — backup bezpośrednio z prywatnych kont.

## Google Groups → permissions

```
zarzad@{domain}        → Owner all drives
ksiegowosc@{domain}    → Editor Dokumenty (Faktury, Umowy)
projekty@{domain}      → Editor Projekty
media@{domain}         → Viewer Media
admin@{domain}         → Manager all drives
```

## Terraform — B2 buckets

3 buckety per deployment: `{prefix}-dokumenty`, `{prefix}-media`, `{prefix}-projekty`
- SSE-B2 (AES-256) encryption at rest
- Per-bucket app keys (least privilege)
- Lifecycle: dokumenty 365d, projekty 730d, media no auto-delete

## rclone backup — key flags

- `--bwlimit "08:00,5M 23:00,50M"` — bandwidth scheduling
- `--drive-export-formats docx,xlsx,pptx,pdf`
- `--backup-dir .versions/{account}/{timestamp}` — point-in-time recovery
- `--track-renames`, `--fast-list`
- `--retries 3 --retries-sleep 30s`
- Lock per-account (mkdir-based) → parallel different-account runs OK

## Scheduling — systemd timers

- Daily 01:00 — full backup pipeline
- Weekly — integrity verification (`rclone check`)

## Retention

| Category | Serwer lokalny | B2 |
|---|---|---|
| Dokumenty | all | 365d lifecycle |
| Projekty | all | 730d lifecycle |
| Media | last 90d | keep all |

## Error handling

| Problem | Handling |
|---|---|
| OAuth token revoked | exit code 6 → alert, employee re-authorizes via web app |
| API rate limit | rclone built-in 403 backoff |
| Large files | bandwidth scheduling + extended timeout (300s) |
| Disk full | pre-check `df`, abort + alert if <10% |
| Concurrent runs | per-account directory lock |
| rclone.conf corruption | regenerate from R2 config JSON |

---

# Implementation Order

## Phase 1: Grota Web
1. Fork & adapt saas-on-cf template, strip demo CRUD
2. Data model: Drizzle schema + migrations
3. Auth: Better Auth magic link + Google OAuth
4. Operator dashboard: deployment CRUD, progress view
5. Client wizard: multi-step onboarding + Google OAuth consent
6. Employee flow: magic link → OAuth → folder list → tagging
7. R2 config export: generate JSON
8. Email: magic link delivery
9. Telegram alert service (data-service endpoint → Bot API)

## Phase 2: Grota Server
1. `lib/` foundation: common.sh, config.sh (R2 JSON reader), notify.sh, secrets.sh
2. Terraform: B2 modules
3. `init-rclone-from-config.sh` + `init-b2-remote.sh` + `verify-remotes.sh`
4. Backup core: sync-gdrive-to-local, sync-local-to-b2, backup-all
5. Migration: migrate-to-shared-drive, verify-migration
6. Systemd timers
7. Audit scripts

## Phase 3 (future): Grota Monitor (web dashboard)

---

## Dostęp prywatnych kont do zasobów firmowych

Shared Drives akceptują dowolne konto Google (w tym @gmail.com) — **bez licencji Workspace per pracownik**.

1. Google Groups w Workspace admin console (np. `ksiegowosc@firma.pl`)
2. Prywatne @gmail.com jako członkowie Group
3. Group → Shared Drive z odpowiednią rolą
4. **Wymagane**: Admin Console → Sharing settings → zezwolić external sharing

## Client checklist

Od klienta:
1. **Workspace admin access** — tworzenie Shared Drives, Groups, sharing config
2. **Dodanie operatora jako Workspace admin delegate**
3. **OAuth consent** — autoryzacja aplikacji GCP (via web wizard)
4. **Pracownicy** — każdy klika magic link, autoryzuje Drive, taguje foldery (~2min)
5. **SSH do serwera** (jeśli ma) — deploy skryptów + timers
6. **Budżet B2** — ~$6/TB/mies

My tworzymy:
- GCP project + OAuth client ID/secret
- Backblaze B2 account + API keys
- Terraform infra + skrypty + Grota Web

---

## Resolved

- **Nazwa**: Grota
- **Serwer**: Ubuntu + 20TB (opcjonalny — bez serwera wszystko → B2)
- **GCP project**: my tworzymy
- **GCP OAuth**: klient ma Workspace → posiada GCP billing. One shared OAuth app for all clients
- **Domena**: konfigurowalny `DOMAIN` w deployment config
- **Setup wizard**: zastąpiony Grota Web (onboarding portal)
- **File selection**: folder top-level (nie drzewko plików)
- **Uprawnienia**: OAuth consent + admin delegate (oba)
- **Scope MVP**: onboarding only, monitoring = Phase 3
- **Email**: Resend for magic links
- **Token encryption**: app-level (libsodium)
- **R2 sync**: server polls R2 + operator triggers manually

---

# Implementation Readiness Review

> Audited: 2026-02-28 | Status: **NOT READY — 11 blockers, 8 clarifications needed**

## Verdict

Dokument jest solidny architektonicznie — stack, flows, data model i integracje są spójne z template `saas-on-cf`. Ale brakuje kilku krytycznych decyzji, bez których implementacja zablokuje się w ciągu pierwszych 2-3 kroków.

---

## Checklist: Data Model

| # | Item | Status | Detail |
|---|------|--------|--------|
| DM-1 | `deployments` table — all columns typed | PASS | uuid PK, text, enum, jsonb, timestamps — all mappable to Drizzle |
| DM-2 | `employees` table — all columns typed | PASS | FK, enums, encrypted text — clear |
| DM-3 | `folder_selections` table — all columns typed | PASS | FK, text, enum, bigint — clear |
| DM-4 | Enum values — implementable | PASS | All enums have explicit values |
| DM-5 | `b2_config` JSONB shape defined | **FAIL** | Marked `jsonb (optional)` but no schema. Need Zod shape: `{ key_id, app_key, bucket_prefix }` or similar |
| DM-6 | `server_config` JSONB shape defined | **FAIL** | Same — need shape: `{ backup_path, bwlimit, ssh_host? }` |
| DM-7 | Client admin storage | **FAIL** | No table/entity for client admin. Magic link goes to `/onboard/{token}` but who is the client admin in DB? Not in `employees` (different role), not in `auth_user` (no magic link). Need: either a `client_admin` row in `employees` with special role, or separate fields on `deployments` (`admin_email`, `admin_magic_link_token`, `admin_magic_link_expires_at`) |
| DM-8 | Deployment → operator FK | PASS | `created_by: text FK → auth_user` |
| DM-9 | Status transition triggers | **FAIL** | 5 states defined (`draft → onboarding → employees_pending → ready → active`) but no transition rules. Need: what event triggers each transition? |

## Checklist: Authentication & Authorization

| # | Item | Status | Detail |
|---|------|--------|--------|
| AU-1 | Operator auth mechanism | PASS | email/password via Better Auth (template already has this) |
| AU-2 | Magic link mechanism defined | **FAIL** | Plan says "Better Auth magic link plugin" but client/employee magic links are NOT auth-session links — they grant access to specific flows (`/onboard/{token}`, `/employee/{token}`) without creating a Better Auth session. **Decision needed:** (a) custom token-based access (simpler, just verify token in route loader) or (b) Better Auth magic link plugin that creates a session with role metadata. Recommendation: **(a) custom tokens** — client admins and employees don't need persistent sessions |
| AU-3 | Google OAuth flow specifics | **FAIL** | Missing: callback URL pattern, authorization code exchange flow, token refresh mechanism, which library. CF Workers don't support `googleapis` npm (Node.js deps). Need: raw `fetch` to `https://oauth2.googleapis.com/token` |
| AU-4 | OAuth scopes correct | WARN | Client admin: `admin.directory.group` + `drive`. But `admin.directory.group` requires Workspace admin privileges — verify the client admin granting consent IS the Workspace admin. Add note to wizard step |
| AU-5 | Token encryption library | **FAIL** | "libsodium app-level" but no JS library specified. `libsodium.js` is 200KB+ and may not work on CF Workers. **Alternatives:** `@noble/ciphers` (lightweight, pure JS, CF-compatible) or Web Crypto API (`crypto.subtle.encrypt` with AES-GCM — zero deps, built into Workers) |
| AU-6 | `approved` field on `auth_user` | PASS | Template has it. Use for operator accounts — new operators need approval |

## Checklist: Routes & Pages

| # | Item | Status | Detail |
|---|------|--------|--------|
| RT-1 | All routes listed with purpose | PASS | 10 routes, all described |
| RT-2 | Route params consistent | PASS | `{token}` for magic links, `{id}` for deployment |
| RT-3 | Auth boundaries clear | PASS | `/_auth/*` = protected, others = public or token-gated |
| RT-4 | `/magic/{token}` handler logic | WARN | Route exists but behavior unclear — does it redirect to `/onboard/{token}` or `/employee/{token}` based on token type? Or are magic links already type-specific (client admin gets `/onboard/` URL, employee gets `/employee/` URL)? If type-specific, `/magic/{token}` is unused. **Clarify or remove.** |

## Checklist: User Flows

| # | Item | Status | Detail |
|---|------|--------|--------|
| FL-1 | Operator → Create Deployment | PASS | Simple form, generates magic link |
| FL-2 | Client Admin wizard — 5 steps | PASS | Well-specified with UI details |
| FL-3 | Employee flow — 4 steps | PASS | OAuth → folder list → tagging → confirm |
| FL-4 | Config export trigger | WARN | "When all employees done (or operator triggers manually)" — but no re-export/versioning if employees are added later. Add: "re-export overwrites `configs/{deployment_id}/config.json`" |
| FL-5 | Wizard error recovery | WARN | No spec for: OAuth fails mid-wizard, employee closes tab mid-flow, magic link expired. Add: "wizard state persisted per step, user can resume" |
| FL-6 | Magic link expiry duration | **FAIL** | `magic_link_expires_at` in model but no default. Need: e.g. "7 days, resendable" |
| FL-7 | Resend rate limiting | WARN | "Wyślij ponownie" button — no rate limit spec. Add: "max 1 per 5 min per employee" |

## Checklist: Integrations

| # | Item | Status | Detail |
|---|------|--------|--------|
| IN-1 | Google Drive API — folder listing | PASS | Top-level only, clear scope |
| IN-2 | Google Drive API — folder size | **FAIL** | `size_bytes: bigint (approximate)` in model but Google Drive API doesn't return folder sizes. Options: (a) skip size, show file count instead, (b) sum file sizes (expensive), (c) omit from MVP |
| IN-3 | R2 binding configured | PASS | Template has R2 rules, wrangler.jsonc ready for binding |
| IN-4 | R2 config JSON security | **FAIL** | Config JSON contains `oauth_refresh_token` in plaintext (line 200-201). Tokens are encrypted in DB. Export must decrypt. R2 has no server-side encryption. **Decision needed:** (a) encrypt JSON blob in R2 with deployment key, (b) accept plaintext (operator-controlled bucket, tokens are revocable) |
| IN-5 | Resend integration | PASS | API-based, works on CF Workers via fetch |
| IN-6 | Telegram Bot API | PASS | Simple `fetch` to `api.telegram.org`, no deps needed |
| IN-7 | Resend API key storage | WARN | Not listed in env vars. Add `RESEND_API_KEY` to env spec |

## Checklist: Template Compatibility

| # | Item | Status | Detail |
|---|------|--------|--------|
| TC-1 | Monorepo structure preserved | PASS | |
| TC-2 | Drizzle migration workflow | PASS | Per-env configs exist |
| TC-3 | Service binding pattern | PASS | Already configured |
| TC-4 | Error handling patterns | PASS | Result<T>, AppError — match |
| TC-5 | i18n strategy | WARN | Template has `use-intl` with en/pl. Plan UI text is Polish. **Clarify:** Polish-only or bilingual? If PL-only, remove i18n overhead |
| TC-6 | Worker names | WARN | Template uses `saas-on-cf-*`. Rename to `grota-*` in wrangler.jsonc |

## Checklist: Server Scripts (Part B)

| # | Item | Status | Detail |
|---|------|--------|--------|
| SV-1 | Script structure complete | PASS | All scripts listed with purpose |
| SV-2 | Config reader spec | PASS | R2 JSON → rclone.conf |
| SV-3 | Terraform modules | PASS | B2 buckets, lifecycle, app keys |
| SV-4 | Error handling table | PASS | 6 scenarios covered |
| SV-5 | Retention policy | PASS | Per-category, clear |
| SV-6 | rclone flags | PASS | Specific and correct |
| SV-7 | Server-side R2 access | WARN | "server polls R2" — how? rclone to R2? curl with CF API? S3-compatible API with R2 access keys? Specify auth mechanism |

---

## Priority Action Items

### Blockers (must resolve before implementation)

| # | Ref | Action | Suggestion |
|---|-----|--------|------------|
| B1 | DM-7 | Define client admin storage | Add `admin_email`, `admin_name`, `admin_magic_link_token`, `admin_magic_link_expires_at` to `deployments` table |
| B2 | AU-2 | Decide magic link mechanism | Use custom tokens (not Better Auth plugin). Generate random token, store in DB, verify in route loader. No session needed for client/employee |
| B3 | AU-3 | Specify Google OAuth flow for CF Workers | Raw `fetch` to Google OAuth2 endpoints. Callback URL = `{app_url}/api/oauth/google/callback`, exchange code → tokens, store refresh_token encrypted |
| B4 | AU-5 | Choose encryption library | Web Crypto API `crypto.subtle` (AES-256-GCM, zero deps, built into CF Workers) |
| B5 | DM-5 | Define `b2_config` JSONB schema | `{ key_id: string, app_key: string, bucket_prefix: string }` |
| B6 | DM-6 | Define `server_config` JSONB schema | `{ backup_path: string, bwlimit: string, ssh_host?: string, ssh_user?: string }` |
| B7 | DM-9 | Document status transitions | `draft` → (operator creates) → `onboarding` → (wizard step 4 done) → `employees_pending` → (all employees completed) → `ready` → (operator triggers backup) → `active` |
| B8 | FL-6 | Set magic link expiry default | 7 days. Resendable (generates new token, invalidates old) |
| B9 | IN-2 | Decide folder size strategy | MVP: skip `size_bytes`, remove from model. Or: store `file_count` instead |
| B10 | IN-4 | Decide R2 config JSON security | Accept plaintext in R2 — operator's bucket, access-controlled. Tokens are refresh tokens (revocable). Add note to doc |
| B11 | RT-4 | Clarify `/magic/{token}` route | Remove — magic links are type-specific URLs (`/onboard/{token}` and `/employee/{token}` directly). Simpler, no routing ambiguity |

### Clarifications (non-blocking but resolve before Phase 1 step 3)

| # | Ref | Action |
|---|-----|--------|
| C1 | AU-4 | Add wizard note: "OAuth consent musi nadać admin Workspace" |
| C2 | FL-4 | Add: re-export overwrites existing config JSON (no versioning in MVP) |
| C3 | FL-5 | Add: wizard state persists in DB per step, user can resume via same token |
| C4 | FL-7 | Add: resend rate limit 1 per 5 min per employee |
| C5 | TC-5 | Decide: PL-only or bilingual. Recommendation: PL-only for MVP |
| C6 | TC-6 | Rename worker names from `saas-on-cf-*` to `grota-*` |
| C7 | IN-7 | Add `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` to env vars spec |
| C8 | SV-7 | Specify R2 access from server: S3-compatible API with R2 access keys |