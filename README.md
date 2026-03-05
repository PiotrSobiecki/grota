# Grota

**G**oogle **R**eorganize, **O**nboard, **T**ransfer, **A**rchive

Portal onboardingowy do migracji i backupu danych firmowych rozproszonych po prywatnych kontach Google.

## Problem

Firmy z 5-15 prywatnymi kontami Google mają dokumenty firmowe (faktury, umowy, projekty) rozsiane po osobistych Dyskach. Brak centralnego dostępu, brak backupu, brak kontroli uprawnień. Migracja do Workspace wymaga ręcznej koordynacji z każdym pracownikiem.

## Rozwiązanie

Grota automatyzuje cały proces onboardingu — od autoryzacji kont, przez kategoryzację folderów, po wygenerowanie gotowej konfiguracji do backupu i migracji.

### Dla operatora (Auditmos)
- Tworzenie wdrożeń klienckich z jednego dashboardu
- Śledzenie postępu: kto autoryzował, kto jeszcze nie
- Eksport gotowej konfiguracji do skryptów backupowych
- Powiadomienia Telegram o ukończeniu onboardingu

### Dla administratora klienta
- Kreator krok-po-kroku: dane firmy, autoryzacja Workspace, dodanie pracowników
- Podgląd statusu: ilu pracowników ukończyło, wysyłka przypomnień
- Pełna transparentność: jasna informacja co aplikacja widzi, a czego nie

### Dla pracownika
- Jedno kliknięcie w magic link, autoryzacja Google Drive, otagowanie folderów (~2 min)
- Automatyczne sugestie kategorii na podstawie nazw folderów
- Podział na: dokumenty, projekty, media, prywatne (pomijane)

### Bezpieczeństwo
- Tokeny OAuth szyfrowane AES-256 w bazie
- Aplikacja widzi nazwy folderów — nie czyta treści plików
- Pracownik może cofnąć dostęp w dowolnym momencie

## Architektura

Monorepo ([pnpm workspace](https://pnpm.io/workspaces)):

| Moduł | Rola |
|-------|------|
| [apps/user-application](./apps/user-application/) | Frontend SSR (TanStack Start) |
| [apps/data-service](./apps/data-service/) | Backend API (Hono) |
| [packages/data-ops](./packages/data-ops/) | Warstwa danych (Drizzle, Zod, Auth) |

Stack: Cloudflare Workers, Neon Postgres, Better Auth, Resend.

## Setup

```bash
pnpm run setup
```

## Development

```bash
pnpm run dev:user-application  # frontend (port 3000)
pnpm run dev:data-service      # API (port 8788)
```

### Migracje

Z katalogu `packages/data-ops/`:

```bash
pnpm run drizzle:dev:generate
pnpm run drizzle:dev:migrate
```

Zamień `dev` na `staging` lub `production`.

### Zmienne środowiskowe

- `packages/data-ops/` — `.env.dev`, `.env.staging`, `.env.production` ([.env.example](./packages/data-ops/.env.example))
- `apps/user-application/` — `.env` per Vite mode
- `apps/data-service/` — `.dev.vars` (local), Cloudflare dashboard (remote)

## Deploy

```bash
pnpm run deploy:staging:user-application
pnpm run deploy:staging:data-service
pnpm run deploy:production:user-application
pnpm run deploy:production:data-service
```

## Etap 2: Grota Server (backup & migracja)

Po ukończeniu onboardingu w portalu web, operator uruchamia skrypty serwerowe na VPS klienta.

### Instalacja na VPS

```bash
curl -fsSL https://raw.githubusercontent.com/auditmos/grota/main/scripts/install.sh | bash
```

Instaluje CLI `grota` + zależności (rclone, jq). Konfiguracja w `/etc/grota/grota.env`.

### Flow operatora

1. **Pobranie konfiguracji** — `grota` pobiera config JSON z R2 (wyeksportowany z portalu web). Zawiera tokeny OAuth pracowników, mapowanie folderów, dane Workspace.

2. **Setup** — generuje konfigurację rclone z tokenów OAuth + konfiguruje remote B2:
   ```bash
   grota setup rclone       # Drive remotes z config JSON
   grota setup b2           # Backblaze B2 remote
   grota verify remotes     # test połączeń
   ```

3. **Backup** — synchronizuje dane z Google Drive pracowników na serwer lokalny i do B2:
   ```bash
   grota backup account jan@gmail.com   # jeden pracownik
   grota backup all                     # wszyscy równolegle
   ```
   Backup działa wg kategorii: dokumenty → B2 (365 dni retencji), projekty → B2 (730 dni), media → B2 (bez limitu), prywatne → pomijane.

4. **Migracja do Shared Drives** — przenosi dokumenty/projekty z prywatnych kont do firmowych Shared Drives w Workspace:
   ```bash
   grota migrate --deployment abc123
   grota migrate --deployment abc123 --verify   # raport diff
   ```

5. **Harmonogram** — instaluje systemd timery (backup co noc o 01:00, weryfikacja integralności co tydzień):
   ```bash
   grota timers install
   grota timers status
   ```

6. **Audyt** — raporty uprawnień, zużycia storage, integralności backupu:
   ```bash
   grota audit permissions
   grota audit storage
   grota audit backup
   ```

### Infrastruktura B2

Terraform tworzy 3 buckety per klient: `{prefix}-dokumenty`, `{prefix}-media`, `{prefix}-projekty` z szyfrowaniem SSE-B2 (AES-256) i osobnymi kluczami API.

```bash
cd terraform && terraform plan -var-file=clients/firmaxyz.tfvars
```

### Powiadomienia

Skrypty raportują status (sukces/błąd/token wygasł) do data-service → Telegram operatora.

## Dokumentacja

- `/docs` — design docs (source of truth)
- `docs/099-107` — Etap 2 (server scripts, terraform, dystrybucja)
- `docs/done/001-007` — Etap 1 (portal web, zaimplementowany)
- Każdy package ma własny `CLAUDE.md` z detalami technicznymi
