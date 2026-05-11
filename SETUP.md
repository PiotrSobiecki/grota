# Setup

End-to-end onboarding świeżego klonu — od pustego konta Cloudflare do działającego portalu + runnera na VPSie.

## 1. Wymagania zewnętrzne (konta + tokeny)

| Usługa | Po co | Co zanotować |
|---|---|---|
| **Cloudflare** | Workers (frontend + API), R2 (config export), DNS, Tunnel do VPSa | `Account ID`, API token (Workers + R2 Edit), strefa DNS |
| **Neon** | Postgres (jedna baza — patrz uwaga niżej) | `DATABASE_HOST` (host bez `https://`), `DATABASE_USERNAME`, `DATABASE_PASSWORD` |
| **Resend** | Onboardingowe maile (magic link, przypomnienia) | `RESEND_API_KEY`, zweryfikowana domena nadawcza |
| **Google Cloud Console** | OAuth dla Drive (admin Workspace + pracownicy) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, redirect URIs (`https://<frontend>/api/auth/callback/google` + warianty staging/dev) |
| **Backblaze B2** | Backupy długoterminowe (per klient) | `keyId`, `applicationKey`, `bucketName`, `endpoint` (region-zależny). Klucz **restricted do jednego bucketa**. |
| **Telegram bot** (opcjonalne) | Powiadomienia operatora | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, opcjonalnie `TELEGRAM_TOPIC_ID` |
| **Cloudflare Turnstile** | Antybot na onboarding employee | `VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| **VPS klienta** (Debian/Ubuntu) | Hosting `apps/runner` + CLI + rclone | dostęp root SSH |

> **Uwaga (baza danych)**: obecnie wszystkie środowiska Drizzle (`dev`, `staging`, `production`) wskazują na jedną bazę Neon (dev). Nie ma osobnej bazy staging/prod — komendy `drizzle:staging:*` / `drizzle:production:*` istnieją w `package.json`, ale w praktyce nie używać dopóki nie zostaną wprowadzone osobne bazy.

## 2. Cloudflare — one-time setup

### R2 buckets (dla config exportu z portalu)

Z `apps/data-service/wrangler.jsonc`:
- `dev` → bucket `grota`
- `staging` → bucket `grota-configs-staging`
- `production` → bucket `grota-configs-production` (utwórz przed pierwszym deployem prod)

```bash
wrangler r2 bucket create grota
wrangler r2 bucket create grota-configs-staging
wrangler r2 bucket create grota-configs-production
```

### DNS / domeny

Z `wrangler.jsonc` (staging/production) — domeny custom (auto-tworzy DNS + cert):
- Frontend: `staging.<twoja-domena>` / `<twoja-domena>` (np. `sobiecki.org`)
- API: `staging-api-grota.<twoja-domena>` / `api-grota.<twoja-domena>`

SSL/TLS mode: **Full (strict)**. NIE używać redirect rule „Redirect from HTTP to HTTPS" — używać toggla „Always Use HTTPS" w SSL/TLS → Edge Certificates (patrz `.claude/rules/cloudflare-deployment.md`).

### Sekrety Workers

```bash
# data-service
cd apps/data-service
wrangler secret put DATABASE_PASSWORD --env staging
wrangler secret put API_TOKEN --env staging
wrangler secret put ENCRYPTION_KEY --env staging        # 32 bajty base64: openssl rand -base64 32
wrangler secret put RESEND_API_KEY --env staging
wrangler secret put GOOGLE_CLIENT_SECRET --env staging
wrangler secret put TELEGRAM_BOT_TOKEN --env staging    # opcjonalne
# (i analogicznie --env production)

# user-application
cd ../user-application
wrangler secret put DATABASE_PASSWORD --env staging
wrangler secret put BETTER_AUTH_SECRET --env staging
wrangler secret put TURNSTILE_SECRET_KEY --env staging
wrangler secret put VITE_API_TOKEN --env staging
```

Niesekretne wartości (`DATABASE_HOST`, `DATABASE_USERNAME`, `GOOGLE_CLIENT_ID`, `CLOUDFLARE_ENV`, `ALLOWED_ORIGINS`, `BETTER_AUTH_BASE_URL`, `VITE_DATA_SERVICE_URL`, `VITE_TURNSTILE_SITE_KEY`, `TELEGRAM_CHAT_ID`, `TELEGRAM_TOPIC_ID`) wpisz w `[vars]` w odpowiednim `wrangler.jsonc`.

## 3. Lokalne env files

Pliki nie commitowane do repo, twórz z `*.example`:

| Plik | Źródło | Po co |
|---|---|---|
| `packages/data-ops/.env.dev` | `.env.example` | Drizzle-kit (`drizzle:dev:generate`, `drizzle:dev:migrate`, `seed:dev`) |
| `apps/data-service/.dev.vars` | `.example.vars` | `wrangler dev` (lokalny API) |
| `apps/user-application/.env` | `.env.example` | Vite dev (`pnpm run dev:user-application`) |

`ENCRYPTION_KEY` generuj:
```bash
openssl rand -base64 32
```

`BETTER_AUTH_SECRET` analogicznie. Ten sam `ENCRYPTION_KEY` musi być w `data-service` env oraz w secret Workera prod — zmiana = utrata dostępu do zaszyfrowanych tokenów OAuth w DB.

## 4. Pierwsze uruchomienie lokalne

```bash
pnpm run setup                      # install + build data-ops
# Wypełnij env files (patrz wyżej)
cd packages/data-ops
pnpm run drizzle:dev:generate       # tylko jeśli zmieniałeś schema
pnpm run drizzle:dev:migrate        # zaaplikuj migracje na Neon dev
pnpm run create-user:dev            # utwórz pierwszego admina (interaktywnie)
cd ../..
pnpm run dev:data-service           # :8788
pnpm run dev:user-application       # :3000 (w drugim terminalu)
```

Login na `http://localhost:3000` → utwórz pierwszy `deployment`.

## 5. Deploy do Cloudflare

```bash
pnpm run deploy:staging:data-service
pnpm run deploy:staging:user-application
# albo :production:*
```

Skrypty automatycznie robią `build:data-ops` i `wrangler deploy --env=...`. Vite buduje z `--mode staging|production`, co bakuje env do bundle'a.

## 6. VPS klienta — runner + CLI

Pełna instrukcja: [`apps/runner/deploy/README.md`](apps/runner/deploy/README.md).

**Skrót:**

```bash
# Wymagania (Debian/Ubuntu, jako root)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git rclone
sudo npm i -g pnpm
curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Runner (publiczne repo)
curl -fsSL https://raw.githubusercontent.com/PiotrSobiecki/grota/main/apps/runner/deploy/install.sh \
  | sudo bash -s -- https://github.com/PiotrSobiecki/grota.git main

# Z install.sh dostajesz GROTA_TOKEN w /etc/grota/runner.env — zanotuj.

# Cloudflare Tunnel
sudo cloudflared tunnel login
sudo cloudflared tunnel create grota-runner-<klient>
sudo cp /root/.cloudflared/<UUID>.json /etc/cloudflared/
sudo cp /opt/grota/apps/runner/deploy/cloudflared.config.example.yml /etc/cloudflared/config.yml
sudo nano /etc/cloudflared/config.yml         # podstaw UUID + hostname
sudo cloudflared tunnel route dns grota-runner-<klient> runner.<klient>.<domena>
sudo cloudflared service install
sudo systemctl enable --now cloudflared

# Smoke test
curl -s -H "Authorization: Bearer $GROTA_TOKEN" https://runner.<klient>.<domena>/health
# {"status":"ok","version":"0.1.0"}
```

Runner słucha na `127.0.0.1:7878` (`GROTA_PORT` env). Cloudflare Tunnel terminuje TLS na edge i forwarduje do localhost — brak publicznego IP, brak otwartych portów.

### CLI (opcjonalny — do systemd timerów / diagnostyki)

`apps/cli/install.sh` instaluje binarkę `grota` + `/etc/grota/grota.env` (skopiuj z `apps/cli/grota.env.example`).

W `grota.env` ustaw:
- `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_ENDPOINT` (`https://<account_id>.r2.cloudflarestorage.com`) + `R2_BUCKET`
- `DEPLOYMENT_ID` (UUID z portalu) lub `DEPLOYMENT_IDS` (CSV) dla multi-tenant
- `DATA_SERVICE_URL` + `API_TOKEN` (do powiadomień)
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (refresh tokenów rclone)
- `RCLONE_BWLIMIT` (np. `"08:00,5M 23:00,50M"` — throttle dzienny)

## 7. Konfiguracja per-deployment w UI

Po pierwszym deployu w panelu `/admin/deployments/<id>/server-config` wpisz dla każdego klienta:

- **B2**: `b2_key_id`, `b2_application_key`, `b2_bucket_name`, `b2_endpoint`
- **Runner**: `runner_url` (np. `https://runner.<klient>.<domena>`), `runner_token` (z `/etc/grota/runner.env` na VPSie)
- **Paths**: `backup_path` (domyślnie `/srv/backup/gdrive`)
- **rclone**: `bwlimit` (opcjonalny override)

`runner_token` szyfrowany AES-256-GCM w DB tym samym `ENCRYPTION_KEY` co tokeny OAuth. Po wpisaniu kliknij **Test połączenia** — powinno wrócić `{ok:true}`.

## 8. Sanity checklist przed pierwszym backupem

- [ ] Migracje DB zaaplikowane (`drizzle:dev:migrate`)
- [ ] `wrangler secret list` pokazuje wszystkie wymagane sekrety per środowisko
- [ ] R2 bucket istnieje (`wrangler r2 bucket list`)
- [ ] DNS dla `staging-api-grota.<domena>` / `api-grota.<domena>` rozwiązuje się (`curl -I`)
- [ ] SSL/TLS mode = Full (strict), brak redirect rule HTTP→HTTPS
- [ ] Runner odpowiada na `/health` z tokenem (zewnętrznie przez tunel)
- [ ] Test połączenia w UI server-config = OK
- [ ] Onboarding admina przeszedł OAuth Workspace (`deployment.workspaceOauthToken` ustawiony)
- [ ] Co najmniej jeden pracownik ukończył onboarding (`employee.driveOauthToken` ustawiony, foldery zaznaczone)

## 9. Troubleshooting

| Symptom | Sprawdź |
|---|---|
| `ERR_NAME_NOT_RESOLVED` na API | DNS dla domeny custom istnieje? Workery używają `custom_domain: true` w `wrangler.jsonc` (auto-DNS), ale pierwsza propagacja ~1 min |
| Loop 301 redirect | SSL mode = Flexible? Redirect rule HTTP→HTTPS włączona? Wyłącz redirect rule, ustaw SSL = Full strict |
| Runner `/health` zwraca 401 | Bearer token w UI nie zgadza się z `/etc/grota/runner.env` |
| Runner `/health` w ogóle nie odpowiada | `systemctl status grota-runner` + `journalctl -u grota-runner -f`; tunel: `systemctl status cloudflared` |
| Backup tylko leci do B2, nie na firmowy Drive | Użyj przycisku **„Wyślij na dysk firmowy"** (`gdrive-restore`) po „Zapisz kopię" — drugi przycisk wykonuje hop VPS → Workspace Shared Drive |
