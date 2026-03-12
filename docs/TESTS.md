# Manual Tests

## 099: Server Install & Distribution

### Docker test (local)

```bash
docker run --rm -it -v "$(pwd)/apps/cli":/src ubuntu:22.04 bash -c '
apt-get update && apt-get install -y curl jq unzip
curl https://rclone.org/install.sh -o /tmp/rclone.sh && bash /tmp/rclone.sh
bash /src/install.sh --local
echo "--- verify ---"
grota --version
grota --help
'
```

### Expected output (tail)

```
=== Grota Installer ===

Checking dependencies...
  [OK]   rclone (/usr/bin/rclone)
  [OK]   jq (/usr/bin/jq)
  [OK]   curl (/usr/bin/curl)
  [MISS] terraform -- optional

Created system user: grota
Creating directories...
Installing grota CLI...
  /usr/local/bin/grota
Installing lib modules...
  /usr/local/lib/grota/common.sh
  /usr/local/lib/grota/config.sh
  /usr/local/lib/grota/secrets.sh
  /usr/local/lib/grota/notify.sh
  /usr/local/lib/grota/backup.sh
  /usr/local/lib/grota/orchestrator.sh
  /usr/local/lib/grota/migration.sh
  /usr/local/lib/grota/setup.sh
  /usr/local/lib/grota/audit.sh
  /usr/local/lib/grota/timers.sh
Installing systemd units...
  /etc/grota/grota.env.example
  NOTE: Copy to grota.env and fill in values

=== Installation complete ===

Installed:
  CLI:     /usr/local/bin/grota
  Libs:    /usr/local/lib/grota/
  Systemd: /usr/local/lib/grota/systemd/ (not activated -- use: grota timers install)
  Config:  /etc/grota/
  Logs:    /var/log/grota/
  Backups: /srv/backup/gdrive/

Next steps:
  1. cp /etc/grota/grota.env.example /etc/grota/grota.env
  2. Edit /etc/grota/grota.env with real credentials
  3. grota setup rclone     # configure Drive remotes
  4. grota setup b2         # configure B2 remotes
  5. grota verify remotes   # test all remotes
  6. grota timers install   # enable daily backups

Update grota: re-run the same curl command

--- verify ---
grota v0.1.0
grota v0.1.0 -- Google Workspace backup & migration toolkit
...
```

## 101: Terraform B2 Buckets

### Docker test (local, no credentials needed)

```bash
docker run --rm --entrypoint sh -v "$(pwd)/terraform":/tf -w /tf hashicorp/terraform:1.5 -c '
echo "--- init ---"
terraform init
echo "--- validate ---"
terraform validate
echo "--- fmt check ---"
terraform fmt -check -recursive
echo "--- plan (expect 6 resources) ---"
terraform plan -var="b2_master_key_id=test" -var="b2_master_key=test" -var="bucket_prefix=testfirma" -input=false 2>&1 | grep -E "Plan:|Error"
'
```

### Expected output (key lines)

```
--- init ---
Terraform has been successfully initialized!
--- validate ---
Success! The configuration is valid.
--- fmt check ---
--- plan (expect 6 resources) ---
Plan: 6 to add, 0 to change, 0 to destroy.
```

## 102: rclone Setup & Verification

### Docker test (local, test credentials)

```bash
docker run --rm -it -v "$(pwd)/apps/cli":/src ubuntu:22.04 bash -c '
apt-get update && apt-get install -y curl jq unzip
curl https://rclone.org/install.sh -o /tmp/rclone.sh && bash /tmp/rclone.sh
bash /src/install.sh --local

export CONFIG_PATH=/src/test/sample-config.json
export GOOGLE_CLIENT_ID="test-client-id"
export GOOGLE_CLIENT_SECRET="test-client-secret"
export RCLONE_CONFIG="/tmp/grota-test-rclone.conf"

echo "--- setup rclone ---"
grota setup rclone

echo "--- listremotes (expect 3 Drive remotes) ---"
rclone listremotes --config "$RCLONE_CONFIG"

echo "--- check conf scope ---"
grep "scope" "$RCLONE_CONFIG"

echo "--- setup b2 ---"
grota setup b2

echo "--- listremotes (expect +3 B2 remotes) ---"
rclone listremotes --config "$RCLONE_CONFIG"

echo "--- verify remotes (expect failures with test creds) ---"
grota verify remotes || echo "EXIT CODE: $?"

echo "--- cleanup ---"
rm -f "$RCLONE_CONFIG"
'
```

### Expected output (key lines)

```
--- setup rclone ---
Configuring rclone for 2 accounts
Configuring remote: gdrive-jan-gmail-com (jan@gmail.com)
Configuring remote: gdrive-anna-gmail-com (anna@gmail.com)
Configuring workspace remote: workspace-drive
Created 3 remotes in /tmp/grota-test-rclone.conf

--- listremotes (expect 3 Drive remotes) ---
gdrive-anna-gmail-com:
gdrive-jan-gmail-com:
workspace-drive:

--- check conf scope ---
scope = drive.readonly
scope = drive.readonly
scope = drive

--- setup b2 ---
Configuring B2 remote: b2-dokumenty -> testfirma-dokumenty
Configuring B2 remote: b2-projekty -> testfirma-projekty
Configuring B2 remote: b2-media -> testfirma-media
B2 remote setup complete

--- listremotes (expect +3 B2 remotes) ---
b2-dokumenty:
b2-media:
b2-projekty:
gdrive-anna-gmail-com:
gdrive-jan-gmail-com:
workspace-drive:

--- verify remotes (expect failures with test creds) ---
FAIL: gdrive-jan-gmail-com
...
EXIT CODE: 1
```

## 103: Single Account Backup

### Docker test (local, wiring & error paths)

```bash
docker run --rm -it -v "$(pwd)/apps/cli":/src ubuntu:22.04 bash -c '
apt-get update && apt-get install -y curl jq unzip
curl https://rclone.org/install.sh -o /tmp/rclone.sh && bash /tmp/rclone.sh
bash /src/install.sh --local

export CONFIG_PATH=/src/test/sample-config.json
export RCLONE_CONFIG="/tmp/grota-test-rclone.conf"

echo "--- test 1: backup.sh installed ---"
ls -la /usr/local/lib/grota/backup.sh

echo "--- test 2: help shows backup command ---"
grota --help | grep -i backup

echo "--- test 3: missing email arg ---"
grota backup account 2>&1 || echo "EXIT CODE: $?"

echo "--- test 4: unknown account ---"
grota backup account nonexistent@example.com 2>&1 || echo "EXIT CODE: $?"

echo "--- test 5: valid account, no rclone remotes (expect rclone failure) ---"
grota backup account jan@gmail.com 2>&1 || echo "EXIT CODE: $?"
'
```

### Expected output (key lines)

```
--- test 1: backup.sh installed ---
-rwxr-xr-x ... /usr/local/lib/grota/backup.sh

--- test 2: help shows backup command ---
  backup account <email>  ...

--- test 3: missing email arg ---
... Usage: grota backup account <email> ...
EXIT CODE: 1

--- test 4: unknown account ---
... Account not found: nonexistent@example.com
EXIT CODE: 1

--- test 5: valid account, no rclone remotes (expect rclone failure) ---
... Backup pipeline: jan@gmail.com ...
... Step 1/3: Google Drive -> Local ...
... rclone error (no configured remote) ...
EXIT CODE: 1
```

### E2E test (server, real credentials)

Requires real Google + B2 credentials on the target server.

**Prerequisites:**

| What | How to get |
|------|-----------|
| Google OAuth Client ID/Secret | Google Cloud Console > APIs > Credentials > OAuth 2.0 Client (type: Desktop) |
| Per-account OAuth refresh token | `grota setup rclone` triggers browser OAuth flow per account, stores refresh token in rclone.conf |
| B2 application key ID + key | Backblaze B2 > App Keys > Add a New Application Key (read/write on target buckets) |
| B2 buckets created | `terraform apply` from doc 101, or manual create: `{prefix}-dokumenty`, `{prefix}-projekty`, `{prefix}-media` |
| Config JSON | Real config at `/etc/grota/config.json` with valid emails, folder IDs, OAuth tokens, B2 keys |
| rclone remotes configured | `grota setup rclone && grota setup b2 && grota verify remotes` — all must pass |
| Disk space | ≥10% free on `server.backup_path` (default `/srv/backup/gdrive`) |

**Config JSON shape** (real values, same structure as `apps/cli/test/sample-config.json`):

```json
{
  "accounts": [
    {
      "email": "real-user@gmail.com",
      "oauth_refresh_token": "<from rclone OAuth flow>",
      "folders": [
        { "id": "<real Google Drive folder ID>", "name": "Faktury", "category": "dokumenty" }
      ]
    }
  ],
  "b2": {
    "key_id": "<B2 app key ID>",
    "app_key": "<B2 app key>",
    "bucket_prefix": "yourprefix"
  },
  "server": {
    "backup_path": "/srv/backup/gdrive",
    "bwlimit": "08:00,5M 23:00,50M"
  }
}
```

**How to get Google Drive folder IDs:** open folder in browser, ID is the last segment of the URL: `https://drive.google.com/drive/folders/<THIS_IS_THE_ID>`

**Test script (run on server as root or grota user):**

```bash
export CONFIG_PATH=/etc/grota/config.json
export RCLONE_CONFIG=/etc/rclone/rclone.conf
EMAIL="real-user@gmail.com"                  # ← replace
SANITIZED=$(echo "$EMAIL" | tr '@.' '-')
BACKUP_ROOT=$(jq -r '.server.backup_path' "$CONFIG_PATH")

echo "--- e2e 1: full backup pipeline ---"
grota backup account "$EMAIL"
echo "EXIT CODE: $?"
# Expect: exit 0, logs show Drive -> local -> B2 steps

echo "--- e2e 2: verify local files exist ---"
find "$BACKUP_ROOT/$SANITIZED" -type f | head -5
# Expect: at least 1 file synced from Drive

echo "--- e2e 3: verify B2 upload ---"
BUCKET_PREFIX=$(jq -r '.b2.bucket_prefix' "$CONFIG_PATH")
rclone ls "b2-dokumenty:${BUCKET_PREFIX}-dokumenty/${SANITIZED}/" | head -5
# Expect: same files as local

echo "--- e2e 4: version backup (re-run creates version dir) ---"
grota backup account "$EMAIL"
ls "$BACKUP_ROOT/.versions/$SANITIZED/"
# Expect: timestamped dirs (only if files changed between runs)

echo "--- e2e 5: locking (concurrent run blocked) ---"
grota backup account "$EMAIL" &
sleep 1
grota backup account "$EMAIL" 2>&1 || echo "EXIT CODE: $?"
wait
# Expect: second instance → "Lock already held", exit 1

echo "--- e2e 6: media retention cleanup ---"
mkdir -p "$BACKUP_ROOT/$SANITIZED/media/test"
touch -d "100 days ago" "$BACKUP_ROOT/$SANITIZED/media/test/old-file.mp4"
grota backup account "$EMAIL"
ls "$BACKUP_ROOT/$SANITIZED/media/test/old-file.mp4" 2>&1 || echo "DELETED (expected)"
# Expect: file deleted (>90d)

echo "--- e2e 7: invalid account ---"
grota backup account nonexistent@example.com 2>&1 || echo "EXIT CODE: $?"
# Expect: "Account not found", exit 1
```
