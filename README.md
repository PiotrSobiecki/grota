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

## Dokumentacja

- `/docs` — design docs (source of truth)
- Każdy package ma własny `CLAUDE.md` z detalami technicznymi
