# Migration Pipeline — Operator Runbook

End-to-end "jak postawic i przetestowac caly migration flow" — od kluczy B2 i VPSa po smoke test w UI.

Architektura w jednym zdaniu: admin klika **Backup**/**Migruj** w panelu UI → user-application server fn → data-service Worker → Cloudflare Tunnel → grota-runner na VPSie → spawnuje rclone → B2.

---

## Sekcja 1 — Mapa zmiennych srodowiskowych

| Zmienna | Gdzie ustawic | Wartosc / skad | Komponent ktory uzywa |
|---------|---------------|----------------|------------------------|
| `DATABASE_HOST` | `apps/data-service/.dev.vars` (lokalnie) / Cloudflare secrets (prod) | Neon DB host (`ep-xxx.region.aws.neon.tech/neondb?sslmode=require`) | data-service |
| `DATABASE_USERNAME` | jw. | Neon DB user (np. `neondb_owner`) | data-service |
| `DATABASE_PASSWORD` | jw. | Neon DB password (`npg_xxx`) | data-service |
| `API_TOKEN` | `apps/data-service/.dev.vars` / Cloudflare secrets | Random 32+ bytes (np. `openssl rand -base64 32`). **Musi byc identyczny z `VITE_API_TOKEN` w user-app** | data-service auth middleware |
| `ENCRYPTION_KEY` | jw. | 32 bajty hex (`openssl rand -hex 32`). **Nie zmieniac w prodzie** — zaszyfrowane sekrety w DB sa nim odszyfrowywane | data-service `encryptServerConfig`/`decryptServerConfig` |
| `CLOUDFLARE_ENV` | `.dev.vars` / wrangler env | `dev` / `staging` / `production` | data-service |
| `VITE_API_TOKEN` | `apps/user-application/.env*` | == `API_TOKEN` z data-service | user-app server fns wolajace data-service |
| `VITE_DATA_SERVICE_URL` | `apps/user-application/.env*` | URL data-service (lokalnie `http://127.0.0.1:8788`, prod `https://api.example.com`) | user-app `fetchDataService` |
| `BETTER_AUTH_*` | user-app `.env*` | Better Auth secrets (session signing, OAuth) | Better Auth |
| `GROTA_TOKEN` | `/etc/grota/runner.env` na VPSie | Generowany losowo przez `install.sh`. **Musi byc identyczny z `runner_token` w UI** | grota-runner bearer auth |
| `GROTA_PORT` | `/etc/grota/runner.env` na VPSie | `7878` (default) | grota-runner Hono server |
| **Per-deployment w UI** | UI: Konfiguracja serwera | | |
| `runner_url` | UI Zaawansowane | `https://runner.<klient>.example.com` (CF Tunnel hostname) | data-service POST do runnera |
| `runner_token` | UI Zaawansowane | == `GROTA_TOKEN` z VPSa. Szyfrowany at-rest przez `ENCRYPTION_KEY` | data-service Bearer do runnera |
| `backup_path` | UI | Lokalny katalog na VPSie pod `/srv/backup/gdrive` (UI dodaje prefix automatycznie) | rclone source/destination |
| `bwlimit` | UI Zaawansowane | rclone bwlimit format (`08:00,5M 23:00,50M`) | rclone --bwlimit |
| `b2_config.key_id` | UI B2 | B2 Application Key ID (`K001abc...`) — z panelu Backblaze | rclone b2 account |
| `b2_config.app_key` | UI B2 | B2 Application Key Secret. Szyfrowany at-rest | rclone b2 key |
| `b2_config.bucket_prefix` | UI B2 | **Dokladna nazwa bucketa w B2** (np. `grota-test-sobiecki`). UI pre-fill = `slugify(clientName)` — uwaga, nadpisz jezeli inna! | rclone `b2:<bucket>` |

---

## Sekcja 2 — Setup lokalny (dev)

**Wymagania**: Node 20+, pnpm 10+, dostep do Neon dev DB, B2 application key (mozna ten sam co prod do testow), VPS z grota-runner (lokalnie nie ma sensu — chyba ze odpalasz `apps/runner` lokalnie na `localhost:7878`).

```powershell
# (1) install + build data-ops
pnpm run setup

# (2) data-service na :8788
pnpm run dev:data-service

# (3) user-application na :3000
pnpm run dev:user-application

# (4) [opcjonalnie] runner lokalny
cd apps/runner
$env:GROTA_TOKEN = "test-token-local"
pnpm tsx src/index.ts
```

W UI:
1. Otworz `http://localhost:3000`, zaloguj sie (Better Auth — Google OAuth)
2. **Dashboard → utworz wdrozenie** (`/dashboard/new`)
3. Onboarduj testowego pracownika magic-linkiem
4. Otworz wdrozenie → **Konfiguracja serwera**:
   - B2: `key_id`, `app_key`, `bucket_prefix=<nazwa-bucketa>`
   - Zaawansowane: `runner_url=https://runner.<host>` (lub `http://localhost:7878` dla lokalnego runnera), `runner_token=<GROTA_TOKEN>`, `backup_path=` (puste = `/srv/backup/gdrive`)
5. **[Testuj polaczenie]** → toast `OK` jezeli wszystko gra

---

## Sekcja 3 — Setup produkcyjny (VPS)

Pelne kroki w `apps/runner/deploy/README.md`. Skrot:

### 3a. VPS prereqs (Debian/Ubuntu, root)

```bash
# Node 20+
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git rclone

# pnpm
npm i -g pnpm

# cloudflared
curl -L -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i /tmp/cloudflared.deb
```

### 3b. Wgraj kod (private repo — workflow `--no-clone`)

Lokalnie (PowerShell, w katalogu repo):

```powershell
tar --exclude=node_modules --exclude=.turbo --exclude=dist --exclude=.wrangler --exclude=.next --exclude=.git -czf $env:TEMP\grota.tar.gz .
scp "$env:TEMP\grota.tar.gz" root@<vps>:/tmp/
```

Na VPSie:

```bash
useradd --system --home /opt/grota --shell /usr/sbin/nologin grota || true
install -d -o grota -g grota -m 750 /opt/grota
tar -xzf /tmp/grota.tar.gz -C /opt/grota
chown -R grota:grota /opt/grota
sudo bash /opt/grota/apps/runner/deploy/install.sh --no-clone
```

Skrypt wygeneruje `GROTA_TOKEN` i wypisze go na stdout — **skopiuj** (wpiszesz w UI).

### 3c. Cloudflare Tunnel

```bash
cloudflared tunnel login                                   # otworzy URL — autoryzuj zone w przegladarce
cloudflared tunnel create grota-runner-<klient>            # zanotuj UUID z output
mkdir -p /etc/cloudflared
cp /root/.cloudflared/<UUID>.json /etc/cloudflared/<UUID>.json
cp /opt/grota/apps/runner/deploy/cloudflared.config.example.yml /etc/cloudflared/config.yml
nano /etc/cloudflared/config.yml                           # podstaw <UUID> i hostname (np. runner.klient.example.com)
cloudflared tunnel route dns grota-runner-<klient> runner.klient.example.com
cloudflared service install
systemctl enable --now cloudflared
```

Smoke z zewnatrz:

```bash
curl -s -H "Authorization: Bearer $GROTA_TOKEN" https://runner.klient.example.com/health
# {"status":"ok","version":"0.1.0"}
```

### 3d. data-service Cloudflare secrets

Worker secrets dla data-service (prod/staging):

```bash
wrangler secret put API_TOKEN --env=production
wrangler secret put ENCRYPTION_KEY --env=production
wrangler secret put DATABASE_HOST --env=production
wrangler secret put DATABASE_USERNAME --env=production
wrangler secret put DATABASE_PASSWORD --env=production
```

Po dodaniu sekretow: redeploy (`pnpm run deploy:production:data-service`).

### 3e. user-application Cloudflare env

`apps/user-application/.env.production` (build-time):

```
VITE_API_TOKEN=<must-equal-data-service-API_TOKEN>
VITE_DATA_SERVICE_URL=https://api.example.com
CLOUDFLARE_ENV=production
BETTER_AUTH_SECRET=<...>
```

`pnpm run deploy:production:user-application`.

---

## Sekcja 4 — Smoke test end-to-end

**Cel**: zweryfikowac kazdy hop pipeline.

1. **Runner zywy**:
   ```bash
   curl -s -H "Authorization: Bearer $GROTA_TOKEN" https://runner.<host>/health
   # → {"status":"ok","version":"0.1.0"}
   ```

2. **Test polaczenia w UI** (B2 verify): Konfiguracja serwera → **[Testuj polaczenie]** → toast `Polaczenie z runnerem OK`. Faktycznie wywoluje `rclone lsd b2:` na VPSie z dostarczonymi B2 keys.

3. **Backup pojedynczego pracownika**: stworz testowy plik na VPSie:
   ```bash
   sudo -u grota bash -c 'echo "smoke $(date)" > /srv/backup/gdrive/test.txt'
   ```
   W UI → **Migracja** → karta **Pracownicy** → **[Backup]** przy wybranym → status w **Aktywny job** powinien przejsc `queued → running → done` w ~2-5s. Live logi powinny pokazac `INFO  : test.txt: Copied (new)`.

4. **DB**: sprawdz `migration_jobs`:
   ```sql
   SELECT id, status, exit_code, started_at, finished_at FROM migration_jobs ORDER BY started_at DESC LIMIT 5;
   ```

5. **VPS journalctl**:
   ```bash
   journalctl -u grota-runner -f
   ```

6. **B2 weryfikacja**:
   ```bash
   RCLONE_CONFIG=$(mktemp)
   printf "[b2]\ntype=b2\naccount=<KEY_ID>\nkey=<APP_KEY>\n" > $RCLONE_CONFIG
   rclone --config $RCLONE_CONFIG ls b2:<bucket>
   rm $RCLONE_CONFIG
   ```

7. **Dry-run migracji**: UI → **[Dry-run]** przy pracowniku → exit 0, logi pokazuja co BY zostalo skopiowane (bez efektu na dysku).

8. **Audit log zmian config** (DB):
   ```sql
   SELECT * FROM server_config_audit_log ORDER BY changed_at DESC LIMIT 10;
   ```

---

## Sekcja 5 — Troubleshooting

| Symptom | Mozliwa przyczyna | Co sprawdzic |
|---------|-------------------|--------------|
| 401 z runnera (`Unauthorized`) | `runner_token` w UI != `GROTA_TOKEN` na VPSie | `cat /etc/grota/runner.env` vs UI Konfiguracja serwera |
| `CONFIG_INCOMPLETE` przy Backup/Migrate | Brak B2 keys lub `runner_url`/`runner_token` w DB | UI Konfiguracja serwera — czy wszystkie pola wypelnione |
| `RUNNER_UNREACHABLE` (502) | CF Tunnel down lub zly hostname | `systemctl status cloudflared` na VPSie; `dig runner.<host>` |
| 502 z CF Tunnel | grota-runner nie dziala | `systemctl status grota-runner`; `journalctl -u grota-runner -n 50` |
| `JOB_ALREADY_RUNNING` (409) | Inny job aktywny (queued/running) dla tego deploymentu | UI **Aktywny job** — czekaj na done lub recznie update przez `Invoke-RestMethod` GET na `/admin/migration/jobs/:id` |
| Job zablokowany w `queued` w UI | Polling nie aktualizuje statusu | (Sesja 38 fix) Hard-refresh strony; alternatywa — manualnie GET `/admin/migration/jobs/:id` |
| Backup exit 0 ale plik nie w B2 | Source dir pusty (poprzedni migrate go wyczyscil) | `ls /srv/backup/gdrive` na VPSie |
| Migrate wymazal plik z `/srv/backup/gdrive` | rclone sync z pustym B2 → destrukcyjny | Najpierw Backup, dopiero potem Migrate |
| rclone exit 1 z B2 error o nazwie bucketa | `bucket_prefix` w UI != faktyczna nazwa bucketa w B2 | UI B2 → wpisz dokladna nazwe bucketa (uwaga na pre-fill ze `slugify(clientName)`) |
| rclone exit 5/6/7 | Auth/network problem z B2 | Sprawdz B2 application key uprawnienia (Read+Write na ten bucket) |
| `203/EXEC` w `systemctl status grota-runner` | tsx binary missing | Ścieżka tsx: `/opt/grota/apps/runner/node_modules/.bin/tsx` (nie root!) |
| `error reading available plugins: /opt/grota/.cache/rclone/...` | rclone nie ma gdzie zapisac cache (ProtectSystem=strict) | Sesja 34 fix: `Environment=HOME=/tmp` w systemd unit |

---

## Sekcja 6 — Rotacja kluczy

### `GROTA_TOKEN`

```bash
# Na VPSie
NEW=$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 48)
sed -i "s|^GROTA_TOKEN=.*|GROTA_TOKEN=$NEW|" /etc/grota/runner.env
systemctl restart grota-runner
echo "Nowy token: $NEW"
```

W UI: **Konfiguracja serwera → Zaawansowane → runner_token** wpisz nowy token, **Zapisz**, **[Testuj polaczenie]**.

### `ENCRYPTION_KEY` (data-service)

**Uwaga**: rotacja `ENCRYPTION_KEY` wymaga re-encrypt wszystkich `server_config.runner_token` w DB. Procedura:

1. Wygeneruj nowy klucz: `openssl rand -hex 32`
2. **Najpierw** odczytaj wszystkie `server_config` z DB ze starym kluczem (np. cron lub one-shot worker fn — TODO)
3. Zaszyfruj ponownie nowym kluczem i zapisz
4. Dopiero potem aktualizuj `wrangler secret put ENCRYPTION_KEY` + redeploy

Bez tego: po zmianie klucza wszystkie istniejace tokeny przestana sie odszyfrowywac → `[Testuj polaczenie]` rzuci 500.

### `API_TOKEN`

1. Wygeneruj: `openssl rand -base64 32`
2. `wrangler secret put API_TOKEN --env=production`
3. **Jednoczesnie** zaktualizuj `VITE_API_TOKEN` w `apps/user-application/.env.production`
4. Redeploy obu Workerow w jednym oknie czasowym (krotki downtime)

### B2 Application Keys

1. W panelu Backblaze utworz nowy application key (Read+Write na ten sam bucket)
2. W UI **B2 Config** wpisz nowe `keyID` + `applicationKey`, **Zapisz**
3. Test polaczeniem
4. Po potwierdzeniu — usun stary klucz w panelu Backblaze

---

## Sekcja 7 — Co NIE jest objete pipeline'em UI

Pipeline UI obsluguje **tylko hop B2 ↔ /srv/backup/gdrive** (na VPSie). Pelen flow GDrive → B2 → docelowe konto wymaga:

- **GDrive → /srv/backup/gdrive**: oddzielny CLI `grota backup` (czesc B planu) z OAuth tokenami pracownikow. Konfigurowany przez `config.json` eksportowany do R2.
- **/srv/backup/gdrive → docelowy GDrive nowego konta**: **NIE ZAIMPLEMENTOWANY**. UI button "Migruj" robi tylko `B2 → lokalny dysk`. Drugi hop (lokalny → docelowy GDrive z OAuth) zostaje na pozniej.

Tekst dialogu w UI (sesja 34) wyjasnia te ograniczenia — nie wprowadza w blad ze pliki "ida do konta Google".
