# Grota

**G**oogle **R**eorganize, **O**nboard, **T**ransfer, **A**rchive

Portal onboardingowy do migracji i backupu danych firmowych rozproszonych po prywatnych kontach Google.

## Problem

Firmy z 5-15 prywatnymi kontami Google mają dokumenty firmowe (faktury, umowy, projekty) rozsiane po osobistych Dyskach. Brak centralnego dostępu, brak backupu, brak kontroli uprawnień. Migracja do Workspace wymaga ręcznej koordynacji z każdym pracownikiem.

## Rozwiązanie

Grota automatyzuje cały proces onboardingu — od autoryzacji kont, przez wybór folderów i plików, po wygenerowanie gotowej konfiguracji i wykonanie backupu/migracji z poziomu portalu.

### Dla operatora (Auditmos)
- Tworzenie wdrożeń klienckich z jednego dashboardu
- Śledzenie postępu: kto autoryzował, kto jeszcze nie
- Eksport konfiguracji do R2 + import/eksport JSON w UI
- Powiadomienia Telegram o ukończeniu onboardingu
- Panel migracji per-deployment: ingest / backup / restore z UI bez SSH

### Dla administratora klienta
- Kreator krok-po-kroku: dane firmy, autoryzacja Workspace, dodanie pracowników, definicja Shared Drives
- Podgląd statusu: ilu pracowników ukończyło, wysyłka przypomnień, edycja email/imię
- Pełna transparentność: jasna informacja co aplikacja widzi, a czego nie

### Dla pracownika
- Jedno kliknięcie w magic link, autoryzacja Google Drive, drill-in wybór folderów/plików (~2 min)
- Wybór per-element: cały folder lub pojedyncze pliki
- Mapowanie wyboru na firmowe Shared Drives zdefiniowane przez admina

### Bezpieczeństwo
- Tokeny OAuth + sekrety runnera szyfrowane AES-256-GCM w bazie
- Aplikacja widzi nazwy folderów — nie czyta treści plików
- Pracownik może cofnąć dostęp w dowolnym momencie
- Sanityzacja logów runnera (maskowanie tokenów i kluczy)

## Architektura

Monorepo (pnpm workspace, Node 22):

| Moduł | Rola |
|-------|------|
| [apps/user-application](./apps/user-application/) | Frontend SSR (TanStack Start na Cloudflare Workers) |
| [apps/data-service](./apps/data-service/) | Backend API (Hono na Cloudflare Workers) |
| [apps/runner](./apps/runner/) | HTTP runner na VPSie klienta (Hono + Node, jobs API + SSE logs) |
| [apps/cli](./apps/cli/) | CLI VPS (`grota` — backup, migracja, audyt, systemd timery) |
| [packages/data-ops](./packages/data-ops/) | Warstwa danych (Drizzle, Zod, Better Auth, encryption) |

Stack: Cloudflare Workers, Cloudflare R2, Cloudflare Tunnel, Neon Postgres, Better Auth, Resend, Backblaze B2, rclone.

## Quick start

Pełna instrukcja onboardingu (konta zewnętrzne, sekrety, VPS): [SETUP.md](./SETUP.md).

```bash
pnpm run setup                    # install + build data-ops
# Skopiuj .env.example / .example.vars do .env.dev / .dev.vars / .env i wypełnij
pnpm run dev:data-service         # API :8788
pnpm run dev:user-application     # frontend :3000
```

## Skrypty (root `package.json`)

```bash
pnpm run setup                          # install + build data-ops
pnpm run dev:user-application           # Vite dev :3000
pnpm run dev:data-service               # wrangler dev :8788
pnpm run deploy:staging:user-application
pnpm run deploy:staging:data-service
pnpm run deploy:production:user-application
pnpm run deploy:production:data-service
pnpm run seed:dev                       # seed Neon
pnpm run lint                           # biome check
pnpm run lint:fix                       # biome check --write
pnpm run types                          # build data-ops + tsc --noEmit per app
pnpm run sync:secrets                   # data-service + user-application → CF production (bash)
```

### Migracje DB (w `packages/data-ops/`)

```bash
pnpm run drizzle:dev:generate           # generuj SQL z diff schema
pnpm run drizzle:dev:migrate            # zaaplikuj na Neon dev
pnpm run drizzle:production:generate
pnpm run drizzle:production:migrate     # zaaplikuj na Neon production
pnpm run create-user:production         # seed admina na production
pnpm run reset-password:production      # reset hasła admina na production
```

> **Uwaga**: `drizzle:staging:*` nie używamy — środowisko staging nie istnieje (jest tylko dev i production).

### Zmienne środowiskowe

| Plik | Pakiet | Po co |
|---|---|---|
| `.env.dev` / `.env.staging` / `.env.production` | `packages/data-ops/` | Drizzle-kit (`DATABASE_HOST/USERNAME/PASSWORD`) |
| `.dev.vars` | `apps/data-service/` | `wrangler dev` (DB + ENCRYPTION_KEY + OAuth + Resend + Telegram + API_TOKEN) |
| `.env` per Vite mode | `apps/user-application/` | DB + Better Auth + VITE_DATA_SERVICE_URL + Turnstile |

Sekrety na Workers (tylko **production**): **`bash scripts/sync-secrets.sh -production`** — `.production.vars` → data-service, potem `.env.production` → user-application. Skrót: `pnpm run sync:secrets`. Pojedyncze appki: `apps/data-service/sync-secrets.sh -production`, `apps/user-application/sync-secrets.sh -production`. Ręcznie: `wrangler secret put … --env production`. Szczegóły: [SETUP.md §2–3](./SETUP.md#2-cloudflare--one-time-setup).

## Etap 2: backup & migracja (panel UI + VPS runner)

Po ukończeniu onboardingu operator zarządza migracją z poziomu UI. VPS klienta wystawia HTTP runner przez Cloudflare Tunnel (bez publicznego IP), a `data-service` proxuje requesty z portalu.

```
[admin UI: /dashboard/$id/migration]
        |
        v
[user-application Worker] --(server fn)--> [data-service Worker]
                                                  |
                              Bearer GROTA_TOKEN  | (runner_url + runner_token z DB, deszyfr. per-request)
                                                  v
                                          [Cloudflare Tunnel]
                                                  v
                                  [grota-runner @ VPS :7878] --spawn--> rclone
```

### Panel migracji w UI

`/dashboard/$id/migration` — akcje per-deployment bez SSH:

| Przycisk | Typ jobu | Co robi |
|---|---|---|
| **Pobierz dane** | `ingest` | rclone: prywatny Drive pracownika → `/srv/backup/gdrive/<email>/` na VPSie |
| **Zapisz kopię** | `backup` | rclone: `/srv/backup/gdrive/` → Backblaze B2 |
| **Przywróć kopię** | `migrate` | rclone: Backblaze B2 → `/srv/backup/gdrive/` na VPSie (odwrót `backup`) |
| **Wyślij na dysk firmowy** | `gdrive-restore` | rclone: VPS → firmowy Shared Drive (OAuth admina Workspace) |

- Akcje globalne (wszyscy pracownicy) + per-pracownik
- Single-job-at-a-time per deployment (lock w UI + 409 z runnera)
- Historia jobów (status, typ, account, czas startu, duration, exit code, badge **Auto** / **Admin**)
- Polling co 2s na aktywny job + **live logi SSE z runnera** w karcie Aktywny job
- Confirm dialog na destrukcyjne akcje
- Rate limit per-deployment + audit log zmian konfiguracji + audit log harmonogramu

### Harmonogram (auto-cykl)

W panelu migracji widget „Harmonogram" — Cloudflare Cron Trigger (co 5 min) w `data-service` wywołuje `scheduled-cycle` (ingest wszystkich gotowych pracowników → backup do B2). Konfiguracja:

- **Toggle** włącz/wyłącz
- **Interwał** (presety): 1h / 6h / 12h / 24h / 7d
- **Godzina kotwicy** (`anchor_time`, default 02:00, strefa `Europe/Warsaw`)
- Status: `Następne uruchomienie`, `Ostatnie: <data> — Sukces/Pominięto/Ponawianie/Błąd`

Zachowanie dispatchera:
- Lock detection: jeśli istnieje aktywny job → `skipped:locked`, `next_run_at += interval`
- VPS-down retry: network/HTTP error → `retry_pending`, `next_run_at = now + 5min`; drugi fail → `failed` + alert
- Skip pracowników bez OAuth / bez folderów / z błędem refresh tokenu (log w jobie: `oauth_refresh_failed`)

Alerty (Telegram + email przez Resend) wysyłane przy `scheduled-cycle: failed` lub `retry_exhausted`. Email: env `OPERATOR_ALERT_EMAIL` (default `piotr@sobiecki.org`).

### Konfiguracja runnera (UI)

`/admin/deployments/$id/server-config`: B2 keys (id/key/bucket/endpoint), `runner_url`, `runner_token`, `backup_path`, `bwlimit`. `runner_token` szyfrowany AES-256-GCM w DB. Import/eksport configu jako JSON.

### Instalacja runnera na VPSie

Pełna instrukcja: [`apps/runner/deploy/README.md`](./apps/runner/deploy/README.md). Skrót w [SETUP.md §6](./SETUP.md#6-vps-klienta--runner--cli).

```bash
curl -fsSL https://raw.githubusercontent.com/PiotrSobiecki/grota/main/apps/runner/deploy/install.sh \
  | sudo bash -s -- https://github.com/PiotrSobiecki/grota.git main
```

Skrypt tworzy usera `grota`, instaluje pnpm + deps, generuje `GROTA_TOKEN` w `/etc/grota/runner.env`, instaluje systemd unit `grota-runner.service`. Cloudflare Tunnel konfigurowany osobno (`cloudflared tunnel login` → `create` → `route dns` → `service install`).

### CLI (`apps/cli/grota`) — fallback / harmonogram

CLI dostępny lokalnie na VPSie. Codzienne akcje robi się z UI; CLI używany do systemd timerów (cykliczny backup nocny) i diagnostyki.

```bash
grota setup rclone                   # rclone remotes z config JSON pobranego z R2
grota setup b2
grota verify remotes
grota backup account jan@gmail.com
grota backup all
grota migrate --dry-run
grota migrate --account jan@gmail.com
grota timers install                 # systemd: backup nocny + weekly verify
grota audit permissions|storage|backup
grota each <cmd>                     # multi-deployment (DEPLOYMENT_IDS env)
```

Konfiguracja: `/etc/grota/grota.env` (template: `apps/cli/grota.env.example`). Odinstalowanie: `apps/cli/uninstall.sh` (flagi: `--keep-data`, `--keep-config`, `--yes`).

## Dokumentacja

- [SETUP.md](./SETUP.md) — pełny onboarding świeżego klonu (konta, sekrety, deploy, VPS)
- [`apps/runner/deploy/README.md`](./apps/runner/deploy/README.md) — runner na VPSie krok po kroku
- `/docs` — design docs (source of truth)
  - `docs/done/part-a/001-008` — Etap 1: portal web (wdrożone)
  - `docs/done/part-b/099-107` — Etap 2: CLI/server scripts, Terraform B2, dystrybucja (wdrożone)
  - `docs/done/part-c/001` + `improvements/001-004` — multi-deployment, dynamic Shared Drives, drill-in selection (wdrożone)
  - `docs/part-c/improvements/005-007` — admin UI migration trigger, gdrive-restore, UI ingest (wdrożone; otwarte TODO: admin role check przez Better Auth, runbook operatora, persystencja logów)
- Każdy package ma własny `CLAUDE.md` z detalami technicznymi
- `.claude/rules/` — reguły konwencji (Cloudflare deployment, error handling, Drizzle, Hono, TanStack, etc.)
