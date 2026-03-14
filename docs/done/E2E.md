# E2E: Grota CLI install + konfiguracja na VPS

## 1. Instalacja

```bash
curl -fsSL https://raw.githubusercontent.com/auditmos/grota/main/apps/cli/install.sh | sudo bash
```

Tworzy: `/usr/local/bin/grota`, `/usr/local/lib/grota/`, `/etc/grota/`, `/var/log/grota/`, `/srv/backup/gdrive/`, user `grota`.

## 2. Plik env: `/etc/grota/grota.env`

```bash
sudo cp /etc/grota/grota.env.example /etc/grota/grota.env
sudo nano /etc/grota/grota.env
```

Wypełnij:

| Zmienna | Skąd wziąć | Wymagane |
|---------|-----------|----------|
| `GOOGLE_CLIENT_ID` | GCP Console → APIs & Services → Credentials → OAuth 2.0 Client ID | tak |
| `GOOGLE_CLIENT_SECRET` | j.w. → Client secret | tak |
| `R2_ACCESS_KEY_ID` | CF dashboard → R2 → Manage R2 API Tokens → Create API token | jeśli config z R2 |
| `R2_SECRET_ACCESS_KEY` | j.w. | jeśli config z R2 |
| `R2_ENDPOINT` | `https://{account_id}.r2.cloudflarestorage.com` (CF dashboard → R2 → przegląd) | jeśli config z R2 |
| `R2_BUCKET` | nazwa bucketa z configami, np. `grota-configs-production` | jeśli config z R2 |
| `DEPLOYMENT_ID` | UUID z Grota Web (operator dashboard) | jeśli config z R2 |
| `CONFIG_PATH` | ścieżka lokalna, np. `/etc/grota/config.json` — **jeśli ustawiony, pomija R2** | alternatywa do R2 |
| `DATA_SERVICE_URL` | URL API Grota Web, np. `https://api.grota.app` | opcjonalne (powiadomienia) |
| `API_TOKEN` | Bearer token do data-service | opcjonalne |

## 3. Config JSON: `/etc/grota/config.json`

Dwa tryby dostarczenia:

**A) Z R2** (automatycznie) — Grota Web generuje config po onboardingu, server pobiera po ustawieniu `R2_*` + `DEPLOYMENT_ID`.

**B) Lokalnie** — skopiuj ręcznie i ustaw `CONFIG_PATH=/etc/grota/config.json`:

```json
{
  "deployment_id": "uuid-z-grota-web",
  "client_name": "FirmaXYZ",
  "domain": "firma.pl",
  "created_at": "2026-03-01T00:00:00.000Z",
  "workspace": {
    "oauth_refresh_token": "1//0abc...",
    "shared_drives": [
      { "name": "FirmaXYZ-Dokumenty", "category": "dokumenty" },
      { "name": "FirmaXYZ-Projekty", "category": "projekty" }
    ]
  },
  "accounts": [
    {
      "email": "jan@gmail.com",
      "name": "Jan Kowalski",
      "role": "ksiegowosc",
      "oauth_refresh_token": "1//0def...",
      "folders": [
        { "id": "abc123", "name": "Faktury 2024", "category": "dokumenty" },
        { "id": "def456", "name": "Projekty", "category": "projekty" },
        { "id": "ghi789", "name": "Filmy firmowe", "category": "media" }
      ]
    }
  ],
  "b2": {
    "key_id": "005a...",
    "app_key": "K005...",
    "bucket_prefix": "firmaxyz"
  },
  "server": {
    "backup_path": "/srv/backup/gdrive",
    "bwlimit": "08:00,5M 23:00,50M"
  }
}
```

### Skąd wartości

| Pole | Źródło |
|------|--------|
| `workspace.oauth_refresh_token` | Grota Web — client admin autoryzuje OAuth w wizardzie (krok 2) |
| `accounts[].oauth_refresh_token` | Grota Web — pracownik autoryzuje Drive (krok 1 employee flow) |
| `accounts[].folders` | Grota Web — pracownik taguje foldery (krok 3 employee flow) |
| `b2.key_id` / `b2.app_key` | Backblaze B2 → App Keys (lub terraform output) |
| `b2.bucket_prefix` | terraform — `{prefix}-dokumenty`, `{prefix}-projekty`, `{prefix}-media` |

## 4. Sekwencja uruchomienia

```bash
# 1. Wygeneruj rclone.conf z tokenów OAuth w config.json
sudo grota setup rclone

# 2. Skonfiguruj B2 remotes
sudo grota setup b2

# 3. Sprawdź czy wszystkie remoty działają
sudo grota verify remotes

# 4. Odpal backup (test na jednym koncie)
sudo grota backup account jan@gmail.com

# 5. Backup wszystkich kont
sudo grota backup all

# 6. Zainstaluj timery (automatyczny backup co noc 01:00)
sudo grota timers install
sudo grota timers status
```

## 5. Opcjonalnie: per-bucket B2 keys

Jeśli terraform stworzył osobne app keys per bucket (least privilege), dodaj do `grota.env`:

```bash
B2_DOKUMENTY_KEY_ID="..."
B2_DOKUMENTY_APP_KEY="..."
B2_PROJEKTY_KEY_ID="..."
B2_PROJEKTY_APP_KEY="..."
B2_MEDIA_KEY_ID="..."
B2_MEDIA_APP_KEY="..."
```

Jeśli nie ustawione — fallback na `b2.key_id`/`b2.app_key` z config.json.

## 6. Opcjonalnie: secrets z plików

Zamiast env vars, sekrety w plikach:

```bash
SECRETS_BACKEND=file
SECRETS_DIR=/etc/grota/secrets

# wtedy:
echo "005a..." > /etc/grota/secrets/B2_DOKUMENTY_KEY_ID
chmod 600 /etc/grota/secrets/*
```

## 7. Weryfikacja

```bash
grota audit storage       # raport: ile danych lokalnie + B2
grota audit permissions   # kto ma dostęp do Shared Drives
grota audit backup        # rclone check — integralność local vs B2
```

## E2E test scenariusz (Docker)

```bash
docker run --rm -it -v "$(pwd)/apps/cli":/src ubuntu:22.04 bash -c '
apt-get update && apt-get install -y curl jq unzip
curl https://rclone.org/install.sh -o /tmp/rclone.sh && bash /tmp/rclone.sh
bash /src/install.sh --local

export CONFIG_PATH=/src/test/sample-config.json
export GOOGLE_CLIENT_ID=test
export GOOGLE_CLIENT_SECRET=test

echo "--- test 1: grota installed ---"
grota --version

echo "--- test 2: help ---"
grota --help

echo "--- test 3: verify remotes (no remotes) ---"
grota verify remotes 2>&1 || echo "EXIT CODE: $?"

echo "--- test 4: audit storage ---"
grota audit storage 2>&1 || echo "EXIT CODE: $?"

echo "--- test 5: reinstall preserves config ---"
echo "CONFIG_PATH=/etc/grota/config.json" > /etc/grota/grota.env
bash /src/install.sh --local
grep CONFIG_PATH /etc/grota/grota.env && echo "CONFIG PRESERVED"
'
```

### Asercje

| # | Check | Expected |
|---|-------|----------|
| 1 | install.sh exits 0 | deps installed, files deployed |
| 2 | `grota` in PATH | executable, exits 0 on --help |
| 3 | graceful failures | non-zero exit + stderr msg, no crash |
| 4 | idempotent reinstall | config preserved, bins updated |
| 5 | systemd units present | .service + .timer files in lib dir |

## TL;DR

install.sh → wypełnij `grota.env` (Google OAuth + R2 lub CONFIG_PATH) → dostarcz `config.json` (z Grota Web lub ręcznie) → `setup rclone` → `setup b2` → `verify remotes` → `backup all` → `timers install`
