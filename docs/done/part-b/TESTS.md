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

## 104: Backup Orchestrator

### Docker test (local, wiring & error paths)

```bash
docker run --rm -it -v "$(pwd)/apps/cli":/src ubuntu:22.04 bash -c '
apt-get update && apt-get install -y curl jq unzip
curl https://rclone.org/install.sh -o /tmp/rclone.sh && bash /tmp/rclone.sh
bash /src/install.sh --local

export CONFIG_PATH=/src/test/sample-config.json
export RCLONE_CONFIG="/tmp/grota-test-rclone.conf"
export LOG_DIR="/tmp/grota-logs"
export LOCK_DIR="/tmp/grota-locks"
mkdir -p "$LOG_DIR" "$LOCK_DIR" /srv/backup/gdrive

echo "--- test 1: orchestrator.sh installed ---"
ls -la /usr/local/lib/grota/orchestrator.sh

echo "--- test 2: help shows backup all command ---"
grota --help | grep "backup all"

echo "--- test 3: backup all runs, discovers 2 accounts ---"
grota backup all 2>&1 || echo "EXIT CODE: $?"
# Expect: logs show 2 accounts, each fails (no rclone remotes), summary + exit 1

echo "--- test 4: locking (concurrent run blocked) ---"
grota backup all &
sleep 1
grota backup all 2>&1 || echo "EXIT CODE: $?"
wait
# Expect: second instance -> "Lock already held", exit 1

echo "--- test 5: MAX_PARALLEL respected ---"
export MAX_PARALLEL=1
grota backup all 2>&1 | grep "max parallel: 1" || echo "MISSING"
# Expect: log line shows max parallel: 1

echo "--- test 6: empty accounts config ---"
echo "{\"deployment_id\":\"test\",\"client_name\":\"Empty\",\"domain\":\"x.com\",\"accounts\":[],\"b2\":{},\"server\":{\"backup_path\":\"/srv/backup/gdrive\"}}" > /tmp/empty-config.json
CONFIG_PATH=/tmp/empty-config.json grota backup all 2>&1 || echo "EXIT CODE: $?"
# Expect: "No accounts in config", exit 0
'
```

### Expected output (key lines)

```
--- test 1: orchestrator.sh installed ---
-rwxr-xr-x ... /usr/local/lib/grota/orchestrator.sh

--- test 2: help shows backup all command ---
  backup all                 Backup all accounts in deployment

--- test 3: backup all runs, discovers 2 accounts ---
... Client: TestFirma, accounts: 2
... Backup summary for TestFirma ...
... Accounts: 2 total, 0 ok, 0 partial, 2 failed, 0 oauth-revoked
... FAIL: jan@gmail.com ...
... FAIL: anna@gmail.com ...
EXIT CODE: 1

--- test 4: locking (concurrent run blocked) ---
... Lock already held: ...
EXIT CODE: 1

--- test 5: MAX_PARALLEL respected ---
... max parallel: 1

--- test 6: empty accounts config ---
... No accounts in config, nothing to backup
```

### E2E test (server, real credentials)

Requires real credentials + completed doc 103 E2E.

```bash
export CONFIG_PATH=/etc/grota/config.json
export RCLONE_CONFIG=/etc/rclone/rclone.conf

echo "--- e2e 1: backup all (all accounts) ---"
grota backup all
echo "EXIT CODE: $?"
# Expect: exit 0, summary shows all OK

echo "--- e2e 2: check summary notification ---"
grep "Backup ALL OK" /var/log/grota/backup-all-*.log
# Expect: notification logged

echo "--- e2e 3: locking prevents concurrent orchestrator ---"
grota backup all &
sleep 2
grota backup all 2>&1 || echo "EXIT CODE: $?"
wait
# Expect: second -> "Lock already held", exit 1

echo "--- e2e 4: MAX_PARALLEL=1 serial execution ---"
MAX_PARALLEL=1 grota backup all
echo "EXIT CODE: $?"
# Expect: runs accounts one at a time, same result
```

## 105: Shared Drive Migration

### Unit tests (local, no credentials)

```bash
bash apps/cli/test/test-migration.sh
# Expect: 13/13 passed, 0 failed
```

### Docker test (local, wiring & error paths)

```bash
docker run --rm -it -v "$(pwd)/apps/cli":/src ubuntu:22.04 bash -c '
apt-get update && apt-get install -y curl jq unzip
curl https://rclone.org/install.sh -o /tmp/rclone.sh && bash /tmp/rclone.sh
bash /src/install.sh --local

export CONFIG_PATH=/src/test/sample-config.json
export RCLONE_CONFIG="/tmp/grota-test-rclone.conf"
export LOG_DIR="/tmp/grota-logs"
export LOCK_DIR="/tmp/grota-locks"
mkdir -p "$LOG_DIR" "$LOCK_DIR"

echo "--- test 1: migration.sh installed ---"
ls -la /usr/local/lib/grota/migration.sh

echo "--- test 2: help shows migrate command ---"
grota --help | grep migrate

echo "--- test 3: unknown arg ---"
grota migrate --bogus 2>&1 || echo "EXIT CODE: $?"

echo "--- test 4: dry run (no workspace remote -> expect failure) ---"
grota migrate --dry-run 2>&1 || echo "EXIT CODE: $?"

echo "--- test 5: verify (no workspace remote -> expect failure) ---"
grota migrate --verify 2>&1 || echo "EXIT CODE: $?"
'
```

### Expected output (key lines)

```
--- test 1: migration.sh installed ---
-rwxr-xr-x ... /usr/local/lib/grota/migration.sh

--- test 2: help shows migrate command ---
  migrate --deployment ID    Migrate folders to Shared Drives

--- test 3: unknown arg ---
... Unknown arg: --bogus
EXIT CODE: 1

--- test 4: dry run (no workspace remote -> expect failure) ---
... Remote 'workspace-drive' not found. Run: grota setup rclone
EXIT CODE: 1

--- test 5: verify (no workspace remote -> expect failure) ---
... Shared Drive not found: ...
EXIT CODE: 1
```

### E2E test (server, real credentials)

Requires Workspace Shared Drives + workspace-drive rclone remote.

```bash
export CONFIG_PATH=/etc/grota/config.json
export RCLONE_CONFIG=/etc/rclone/rclone.conf
EMAIL="real-user@gmail.com"                  # ← replace

echo "--- e2e 1: dry run ---"
grota migrate --dry-run
echo "EXIT CODE: $?"
# Expect: logs what WOULD be copied, exit 0

echo "--- e2e 2: migrate single account ---"
grota migrate --account "$EMAIL"
echo "EXIT CODE: $?"
# Expect: dokumenty/projekty copied, media/prywatne skipped

echo "--- e2e 3: verify migration ---"
grota migrate --verify --account "$EMAIL"
echo "EXIT CODE: $?"
# Expect: "Migration verification PASSED"

echo "--- e2e 4: migrate all ---"
grota migrate
echo "EXIT CODE: $?"

echo "--- e2e 5: full verify ---"
grota migrate --verify
echo "EXIT CODE: $?"

echo "--- e2e 6: idempotent re-run ---"
grota migrate
echo "EXIT CODE: $?"
# Expect: no new files (rclone copy skips existing)
```

## 106: Systemd Timers

### Docker test (local, wiring & error paths)

```bash
docker run --rm -it -v "$(pwd)/apps/cli":/src ubuntu:22.04 bash -c '
apt-get update && apt-get install -y curl jq unzip systemctl 2>/dev/null
curl https://rclone.org/install.sh -o /tmp/rclone.sh && bash /tmp/rclone.sh
bash /src/install.sh --local

echo "--- test 1: timers.sh installed ---"
ls -la /usr/local/lib/grota/timers.sh

echo "--- test 2: systemd units installed ---"
ls -la /usr/local/lib/grota/systemd/

echo "--- test 3: help shows timers command ---"
grota --help | grep timers

echo "--- test 4: timers status (no systemd in container) ---"
grota timers status 2>&1 || echo "EXIT CODE: $?"

echo "--- test 5: timers install requires root ---"
su -s /bin/bash nobody -c "grota timers install" 2>&1 || echo "EXIT CODE: $?"
'
```

### Expected output (key lines)

```
--- test 1: timers.sh installed ---
-rwxr-xr-x ... /usr/local/lib/grota/timers.sh

--- test 2: systemd units installed ---
... grota-backup.service
... grota-backup.timer
... grota-verify.service
... grota-verify.timer

--- test 3: help shows timers command ---
  timers install|uninstall|status  ...

--- test 4: timers status (no systemd in container) ---
=== Grota timer status ===
--- grota-backup.service ---
  Not installed
...

--- test 5: timers install requires root ---
... Must run as root
EXIT CODE: 1
```

### E2E test (server with systemd, real credentials)

Requires Ubuntu server with systemd + completed docs 103-104 E2E.

```bash
# 1. Install timers (as root)
sudo grota timers install
# Expect: grota user created, units installed, timers enabled + started

# 2. Check status
grota timers status
# Expect: timer status + next scheduled runs

# 3. Verify timer schedule
systemctl list-timers grota-*
# Expect:
#   grota-backup.timer  -> daily 01:00
#   grota-verify.timer  -> weekly Sunday 03:00

# 4. Test manual trigger
sudo systemctl start grota-backup.service
journalctl -u grota-backup.service --no-pager -n 50
# Expect: runs grota backup all, logs visible

# 5. Verify hardening
systemctl show grota-backup.service | grep -E 'NoNewPrivileges|ProtectSystem'
# Expect: NoNewPrivileges=yes, ProtectSystem=strict

# 6. Uninstall
sudo grota timers uninstall
systemctl list-timers grota-*
# Expect: no grota timers

# 7. Re-install for production
sudo grota timers install
```

## 107: Audit & Reporting

### Unit tests (local, no credentials)

```bash
bash apps/cli/test/test-audit.sh
# Expect: 14/14 passed, 0 failed
```

### Docker test (local, wiring & error paths)

```bash
docker run --rm -it -v "$(pwd)/apps/cli":/src ubuntu:22.04 bash -c '
apt-get update && apt-get install -y curl jq unzip
curl https://rclone.org/install.sh -o /tmp/rclone.sh && bash /tmp/rclone.sh
bash /src/install.sh --local

export CONFIG_PATH=/src/test/sample-config.json
export RCLONE_CONFIG="/tmp/grota-test-rclone.conf"

echo "--- test 1: audit.sh installed ---"
ls -la /usr/local/lib/grota/audit.sh

echo "--- test 2: help shows audit command ---"
grota --help | grep audit

echo "--- test 3: audit permissions (no rclone remotes) ---"
grota audit permissions 2>&1 || echo "EXIT CODE: $?"

echo "--- test 4: audit storage (no backup dir) ---"
grota audit storage 2>&1 || echo "EXIT CODE: $?"

echo "--- test 5: audit backup (no backup dir) ---"
grota audit backup 2>&1 || echo "EXIT CODE: $?"

echo "--- test 6: report file output ---"
REPORT_DIR=/tmp/grota-reports grota audit storage 2>&1 || echo "EXIT CODE: $?"
ls /tmp/grota-reports/storage-report-*.txt 2>/dev/null && echo "REPORT FILE EXISTS" || echo "NO REPORT FILE"
'
```

### Expected output (key lines)

```
--- test 1: audit.sh installed ---
-rwxr-xr-x ... /usr/local/lib/grota/audit.sh

--- test 2: help shows audit command ---
  audit storage              Storage usage report (local + B2)
  audit permissions          Shared Drive permission audit
  audit backup               Verify local vs B2 integrity

--- test 3: audit permissions (no rclone remotes) ---
... Grota Permission Audit ...
... Client: TestFirma
... No Shared Drives found

--- test 4: audit storage (no backup dir) ---
... Grota Storage Report ...
... jan@gmail.com: (no local data)
... anna@gmail.com: (no local data)
... LOCAL TOTAL: 0
... testfirma-dokumenty: (remote not configured)
... Report complete

--- test 5: audit backup (no backup dir) ---
... Grota Backup Verification ...
... Verification: 0 ok, 0 mismatched, 0 errors
... Backup verification complete: all checks passed

--- test 6: report file output ---
... Report saved to /tmp/grota-reports/storage-report-*.txt
REPORT FILE EXISTS
```

### E2E test (server, real credentials)

Requires real rclone remotes + backup data (completed docs 102-105).

```bash
export CONFIG_PATH=/etc/grota/config.json
export RCLONE_CONFIG=/etc/rclone/rclone.conf

# 1. Permission audit
grota audit permissions
# Expect: lists all Shared Drives with file counts

# 2. Permission audit with report file
REPORT_DIR=/tmp/grota-reports grota audit permissions
ls /tmp/grota-reports/permission-audit-*.txt
# Expect: same output + file saved

# 3. Storage report
grota audit storage
# Expect: local storage per account/category, B2 per bucket, disk summary

# 4. Verify local numbers match
du -sh /srv/backup/gdrive/*/
# Expect: matches report

# 5. Backup verification (clean)
grota audit backup
# Expect: "Verification: X ok, 0 mismatched, 0 errors"

# 6. Introduce mismatch
EMAIL="real-user@gmail.com"  # ← replace
SANITIZED=$(echo "$EMAIL" | tr '@.' '-')
touch /srv/backup/gdrive/$SANITIZED/dokumenty/test-extra-file.txt
grota audit backup
# Expect: MISMATCH for dokumenty, notification sent
rm /srv/backup/gdrive/$SANITIZED/dokumenty/test-extra-file.txt

# 7. Report file output
REPORT_DIR=/tmp/grota-reports grota audit backup
cat /tmp/grota-reports/backup-verify-*.txt
# Expect: verification results in file
```
