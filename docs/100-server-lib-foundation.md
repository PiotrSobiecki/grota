# 100: Server Lib Foundation

## Goal

Create the `scripts/` directory structure with all library files, a sample config JSON for testing, and R2 config download capability -- establishing the foundation for all server-side scripts.

## Prerequisites

- Doc 006b (R2 Export) -- config JSON must be exportable to R2
- Doc 099 (install.sh) -- defines installation layout
- R2 access keys created (S3-compatible API access per **C8**)

## Scope

### IN

- `scripts/lib/common.sh` -- logging, locking, disk check, trap handlers
- `scripts/lib/config.sh` -- load config JSON from R2 or local file, parse with `jq`
- `scripts/lib/secrets.sh` -- pluggable secret backend (env/file)
- `scripts/lib/notify.sh` -- POST to data-service `/notify` endpoint
- `scripts/grota` -- main CLI entry point with subcommand routing
- `scripts/grota.env.example` -- environment template
- `scripts/test/sample-config.json` -- sample config for offline testing
- Directory scaffold for all future script directories

### OUT

- Terraform (doc 101)
- rclone setup (doc 102)
- Backup scripts (doc 103+)
- systemd timers (doc 106)
- Vault secret backend (future -- env/file only for MVP)

## Decisions

| Ref | Decision |
|-----|----------|
| **C8** (server R2 access) | R2 accessed via S3-compatible API using `rclone` with R2 remote or `aws` CLI. Config download uses `rclone copy` from R2 remote. |
| Architecture | Hybrid CLI: single `grota` entry point with subcommands. `lib/` modules sourced internally. No standalone scripts. |
| Notifications | Scripts call `POST /notify` on data-service (SRP -- notification logic stays in one place). Env vars: `DATA_SERVICE_URL`, `API_TOKEN`. |
| Bash style | `set -euo pipefail`, shellcheck-clean, POSIX-compatible where possible. All modules source `lib/common.sh` first. |
| Lock mechanism | `mkdir`-based (atomic on all filesystems). Lock dir: `/var/lock/grota/{key}`. |
| Log format | `[YYYY-MM-DD HH:MM:SS] [LEVEL] message` to stderr + optional log file. Log rotation handled by journald (systemd timers). |

## Directory Structure

```
scripts/
├── grota                    # main entry point (goes to /usr/local/bin/grota)
├── lib/
│   ├── common.sh            # logging, locking, disk check
│   ├── config.sh            # config loader (R2 JSON)
│   ├── secrets.sh           # secret backend
│   ├── notify.sh            # POST /notify to data-service
│   ├── backup.sh            # backup functions (sync-gdrive, sync-b2, single account)
│   ├── orchestrator.sh      # backup-all, parallel execution
│   ├── migration.sh         # shared drive migration + verify
│   ├── setup.sh             # rclone init, b2 init, verify remotes
│   ├── audit.sh             # permission audit, storage report, backup verify
│   └── timers.sh            # systemd timer install/uninstall/status
├── systemd/
│   ├── grota-backup.service
│   ├── grota-backup.timer
│   ├── grota-verify.service
│   └── grota-verify.timer
├── install.sh               # installer script (doc 099)
├── test/
│   └── sample-config.json
└── grota.env.example
terraform/
├── main.tf, variables.tf, outputs.tf, versions.tf
├── terraform.tfvars.example
├── clients/                 # per-client tfvars
│   └── example.tfvars
└── modules/b2-bucket/
```

## Files

### `scripts/grota.env.example`

```bash
# Grota Server -- Environment Configuration
# Copy to /etc/grota/grota.env and fill in values

# R2 access (S3-compatible API)
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_ENDPOINT=""  # https://{account_id}.r2.cloudflarestorage.com
R2_BUCKET="grota-configs-production"

# Deployment
DEPLOYMENT_ID=""
CONFIG_PATH=""  # local override; if set, skips R2 download

# Paths
BACKUP_ROOT="/srv/backup/gdrive"
LOG_DIR="/var/log/grota"
LOCK_DIR="/var/lock/grota"

# data-service (notifications)
DATA_SERVICE_URL=""  # e.g. https://api.grota.app
API_TOKEN=""         # Bearer token for data-service API

# rclone
RCLONE_CONFIG="/etc/rclone/rclone.conf"
RCLONE_BWLIMIT="08:00,5M 23:00,50M"

# Google OAuth (for rclone token refresh)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

### `scripts/grota`

```bash
#!/usr/bin/env bash
# Grota CLI -- single entry point for all backup operations
set -euo pipefail

GROTA_VERSION="0.1.0"
LIB_DIR="${GROTA_LIB_DIR:-/usr/local/lib/grota}"

# Dev mode: source from repo
if [[ -d "$(dirname "${BASH_SOURCE[0]}")/lib" ]]; then
  LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
fi

source "${LIB_DIR}/common.sh"

usage() {
  cat <<EOF
grota v${GROTA_VERSION} -- Google Workspace backup & migration toolkit

Usage: grota <command> [args]

Commands:
  backup account <email>     Backup single account (Drive -> local -> B2)
  backup all                 Backup all accounts in deployment
  migrate --deployment ID    Migrate folders to Shared Drives
  setup rclone               Configure Drive remotes from config JSON
  setup b2                   Configure B2 remotes
  verify remotes             Test all configured rclone remotes
  audit storage              Storage usage report (local + B2)
  audit permissions          Shared Drive permission audit
  audit backup               Verify local vs B2 integrity
  timers install             Install systemd timers
  timers uninstall           Remove systemd timers
  timers status              Show timer status

Options:
  --version                  Show version
  --help                     Show this help
EOF
}

# ── Env loading ────────────────────────────────────
ENV_FILE="${GROTA_ENV:-/etc/grota/grota.env}"
if [[ -f "$ENV_FILE" ]]; then
  load_env "$ENV_FILE"
fi

# ── Route subcommands ──────────────────────────────
cmd="${1:-}"
subcmd="${2:-}"

case "$cmd" in
  backup)
    source "${LIB_DIR}/config.sh"
    source "${LIB_DIR}/notify.sh"
    load_config
    case "$subcmd" in
      account)
        source "${LIB_DIR}/backup.sh"
        shift 2
        cmd_backup_account "$@"
        ;;
      all)
        source "${LIB_DIR}/orchestrator.sh"
        shift 2
        cmd_backup_all "$@"
        ;;
      *) usage; exit 1 ;;
    esac
    ;;
  migrate)
    source "${LIB_DIR}/config.sh"
    source "${LIB_DIR}/notify.sh"
    source "${LIB_DIR}/migration.sh"
    shift 1
    load_config
    cmd_migrate "$@"
    ;;
  setup)
    source "${LIB_DIR}/config.sh"
    load_config
    source "${LIB_DIR}/setup.sh"
    case "$subcmd" in
      rclone) shift 2; cmd_setup_rclone "$@" ;;
      b2)     shift 2; cmd_setup_b2 "$@" ;;
      *)      usage; exit 1 ;;
    esac
    ;;
  verify)
    source "${LIB_DIR}/config.sh"
    load_config
    case "$subcmd" in
      remotes)
        source "${LIB_DIR}/setup.sh"
        shift 2
        cmd_verify_remotes "$@"
        ;;
      *) usage; exit 1 ;;
    esac
    ;;
  audit)
    source "${LIB_DIR}/config.sh"
    source "${LIB_DIR}/notify.sh"
    load_config
    source "${LIB_DIR}/audit.sh"
    case "$subcmd" in
      storage)     shift 2; cmd_audit_storage "$@" ;;
      permissions) shift 2; cmd_audit_permissions "$@" ;;
      backup)      shift 2; cmd_audit_backup "$@" ;;
      *)           usage; exit 1 ;;
    esac
    ;;
  timers)
    source "${LIB_DIR}/timers.sh"
    case "$subcmd" in
      install)   shift 2; cmd_timers_install "$@" ;;
      uninstall) shift 2; cmd_timers_uninstall "$@" ;;
      status)    shift 2; cmd_timers_status "$@" ;;
      *)         usage; exit 1 ;;
    esac
    ;;
  --version) echo "grota v${GROTA_VERSION}" ;;
  --help|"") usage ;;
  *) echo "Unknown command: $cmd"; usage; exit 1 ;;
esac
```

### `scripts/lib/common.sh`

```bash
#!/usr/bin/env bash
# Common utilities: logging, locking, disk checks, traps
set -euo pipefail

# ── Paths ──────────────────────────────────────────
GROTA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-/var/log/grota}"
LOCK_DIR="${LOCK_DIR:-/var/lock/grota}"
LOG_FILE=""

# ── Logging ────────────────────────────────────────
_ts() { date '+%Y-%m-%d %H:%M:%S'; }

log_info()  { echo "[$(_ts)] [INFO]  $*" >&2; [[ -n "$LOG_FILE" ]] && echo "[$(_ts)] [INFO]  $*" >> "$LOG_FILE"; }
log_warn()  { echo "[$(_ts)] [WARN]  $*" >&2; [[ -n "$LOG_FILE" ]] && echo "[$(_ts)] [WARN]  $*" >> "$LOG_FILE"; }
log_error() { echo "[$(_ts)] [ERROR] $*" >&2; [[ -n "$LOG_FILE" ]] && echo "[$(_ts)] [ERROR] $*" >> "$LOG_FILE"; }
log_fatal() { log_error "$@"; exit 1; }

init_logging() {
  local name="${1:-grota}"
  mkdir -p "$LOG_DIR"
  LOG_FILE="${LOG_DIR}/${name}-$(date '+%Y%m%d').log"
  log_info "=== $name started ==="
}

# ── Locking (mkdir-based, atomic) ──────────────────
_lock_path=""

acquire_lock() {
  local key="$1"
  _lock_path="${LOCK_DIR}/${key}"
  mkdir -p "$LOCK_DIR"

  if ! mkdir "$_lock_path" 2>/dev/null; then
    log_fatal "Lock already held: $_lock_path (another instance running?)"
  fi

  # Store PID for debugging
  echo $$ > "${_lock_path}/pid"
  log_info "Lock acquired: $_lock_path"
}

release_lock() {
  if [[ -n "$_lock_path" && -d "$_lock_path" ]]; then
    rm -rf "$_lock_path"
    log_info "Lock released: $_lock_path"
    _lock_path=""
  fi
}

# ── Disk check ─────────────────────────────────────
check_disk_space() {
  local path="$1"
  local min_pct="${2:-10}"
  local avail_pct

  avail_pct=$(df "$path" | awk 'NR==2 {gsub(/%/,"",$5); print 100 - $5}')
  if (( avail_pct < min_pct )); then
    log_fatal "Disk space critical: ${avail_pct}% free on $path (minimum: ${min_pct}%)"
  fi
  log_info "Disk OK: ${avail_pct}% free on $path"
}

# ── Trap handler ───────────────────────────────────
_cleanup_handlers=()

on_exit() {
  _cleanup_handlers+=("$1")
}

_run_cleanup() {
  local exit_code=$?
  # Release lock if held
  release_lock
  # Run registered handlers
  for handler in "${_cleanup_handlers[@]+"${_cleanup_handlers[@]}"}"; do
    eval "$handler" || true
  done
  if (( exit_code != 0 )); then
    log_error "Exited with code $exit_code"
  fi
}

trap _run_cleanup EXIT

# ── Helpers ────────────────────────────────────────
require_cmd() {
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || log_fatal "Required command not found: $cmd"
  done
}

require_env() {
  for var in "$@"; do
    [[ -n "${!var:-}" ]] || log_fatal "Required env var not set: $var"
  done
}

load_env() {
  local env_file="${1:-/etc/grota/grota.env}"
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file"
    log_info "Loaded env from $env_file"
  else
    log_warn "Env file not found: $env_file"
  fi
}
```

### `scripts/lib/config.sh`

```bash
#!/usr/bin/env bash
# Config loader: reads deployment config JSON from R2 or local file
set -euo pipefail

# Source common if not already loaded
[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# ── Config loading ─────────────────────────────────
CONFIG_JSON=""
_config_tmp=""

load_config() {
  local deployment_id="${1:-${DEPLOYMENT_ID:-}}"

  # Local override
  if [[ -n "${CONFIG_PATH:-}" && -f "${CONFIG_PATH}" ]]; then
    CONFIG_JSON=$(cat "$CONFIG_PATH")
    log_info "Config loaded from local file: $CONFIG_PATH"
    return 0
  fi

  # Download from R2
  require_env R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ENDPOINT R2_BUCKET
  [[ -n "$deployment_id" ]] || log_fatal "DEPLOYMENT_ID required for R2 download"

  require_cmd rclone

  _config_tmp=$(mktemp)
  on_exit "rm -f '$_config_tmp'"

  local r2_path="configs/${deployment_id}/config.json"
  log_info "Downloading config from R2: ${R2_BUCKET}/${r2_path}"

  # Use rclone with on-the-fly remote config (no rclone.conf dependency)
  RCLONE_CONFIG_R2_TYPE=s3 \
  RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
  RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT" \
  RCLONE_CONFIG_R2_ACL=private \
    rclone copyto "r2:${R2_BUCKET}/${r2_path}" "$_config_tmp" \
    || log_fatal "Failed to download config from R2"

  CONFIG_JSON=$(cat "$_config_tmp")
  log_info "Config loaded from R2 (${#CONFIG_JSON} bytes)"
}

# ── Config accessors (jq wrappers) ────────────────
cfg() {
  local query="$1"
  echo "$CONFIG_JSON" | jq -r "$query"
}

cfg_raw() {
  local query="$1"
  echo "$CONFIG_JSON" | jq "$query"
}

cfg_client_name()  { cfg '.client_name'; }
cfg_domain()       { cfg '.domain'; }
cfg_deployment_id(){ cfg '.deployment_id'; }

cfg_account_count() {
  echo "$CONFIG_JSON" | jq '.accounts | length'
}

cfg_account_email() {
  local idx="$1"
  cfg ".accounts[$idx].email"
}

cfg_account_name() {
  local idx="$1"
  cfg ".accounts[$idx].name"
}

cfg_account_token() {
  local idx="$1"
  cfg ".accounts[$idx].oauth_refresh_token"
}

cfg_account_folders() {
  local idx="$1"
  cfg_raw ".accounts[$idx].folders"
}

cfg_account_folders_by_category() {
  local idx="$1"
  local category="$2"
  cfg_raw ".accounts[$idx].folders | map(select(.category == \"$category\"))"
}

cfg_b2_key_id()   { cfg '.b2.key_id // empty'; }
cfg_b2_app_key()  { cfg '.b2.app_key // empty'; }
cfg_b2_prefix()   { cfg '.b2.bucket_prefix // empty'; }

cfg_server_backup_path() { cfg '.server.backup_path // "/srv/backup/gdrive"'; }
cfg_server_bwlimit()     { cfg '.server.bwlimit // "08:00,5M 23:00,50M"'; }

# Workspace config
cfg_workspace_token()     { cfg '.workspace.oauth_refresh_token // empty'; }
cfg_shared_drives()       { cfg_raw '.workspace.shared_drives // []'; }
cfg_shared_drive_name()   {
  local idx="$1"
  cfg ".workspace.shared_drives[$idx].name"
}
cfg_shared_drive_category() {
  local idx="$1"
  cfg ".workspace.shared_drives[$idx].category"
}
```

### `scripts/lib/secrets.sh`

```bash
#!/usr/bin/env bash
# Pluggable secret backend: env or file
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# Backend: "env" (default) or "file"
SECRETS_BACKEND="${SECRETS_BACKEND:-env}"
SECRETS_DIR="${SECRETS_DIR:-/etc/grota/secrets}"

get_secret() {
  local key="$1"
  local value=""

  case "$SECRETS_BACKEND" in
    env)
      value="${!key:-}"
      ;;
    file)
      local file="${SECRETS_DIR}/${key}"
      if [[ -f "$file" ]]; then
        value=$(cat "$file")
      fi
      ;;
    *)
      log_fatal "Unknown secrets backend: $SECRETS_BACKEND"
      ;;
  esac

  if [[ -z "$value" ]]; then
    log_fatal "Secret not found: $key (backend: $SECRETS_BACKEND)"
  fi

  echo "$value"
}

# Convenience wrappers
get_r2_access_key_id()     { get_secret "R2_ACCESS_KEY_ID"; }
get_r2_secret_access_key() { get_secret "R2_SECRET_ACCESS_KEY"; }
get_google_client_id()     { get_secret "GOOGLE_CLIENT_ID"; }
get_google_client_secret() { get_secret "GOOGLE_CLIENT_SECRET"; }
```

### `scripts/lib/notify.sh`

```bash
#!/usr/bin/env bash
# Notification: POST to data-service /notify endpoint -> Telegram
# SRP: notification logic (formatting, routing, Telegram) lives in data-service
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

notify() {
  local level="$1"   # info, warn, error
  local message="$2"
  local deployment_id="${3:-${DEPLOYMENT_ID:-unknown}}"

  # Always log locally
  case "$level" in
    info)  log_info  "[NOTIFY] $message" ;;
    warn)  log_warn  "[NOTIFY] $message" ;;
    error) log_error "[NOTIFY] $message" ;;
  esac

  # Skip remote if no URL configured
  if [[ -z "${DATA_SERVICE_URL:-}" ]]; then
    log_warn "DATA_SERVICE_URL not set, skipping remote notification"
    return 0
  fi

  local payload
  payload=$(jq -n \
    --arg level "$level" \
    --arg message "$message" \
    --arg deployment_id "$deployment_id" \
    --arg hostname "$(hostname)" \
    --arg timestamp "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    '{level: $level, message: $message, deployment_id: $deployment_id, hostname: $hostname, timestamp: $timestamp}')

  # Non-blocking: fire and forget, log failures
  curl -s -X POST "${DATA_SERVICE_URL}/notify" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${API_TOKEN:-}" \
    -d "$payload" \
    --max-time 10 \
    >/dev/null 2>&1 \
    || log_warn "Failed to send remote notification"
}

notify_info()  { notify "info"  "$@"; }
notify_warn()  { notify "warn"  "$@"; }
notify_error() { notify "error" "$@"; }

notify_backup_start() {
  local account="$1"
  notify_info "Backup started: $account" "${DEPLOYMENT_ID:-}"
}

notify_backup_done() {
  local account="$1"
  notify_info "Backup completed: $account" "${DEPLOYMENT_ID:-}"
}

notify_backup_failed() {
  local account="$1"
  local reason="${2:-unknown error}"
  notify_error "Backup FAILED: $account -- $reason" "${DEPLOYMENT_ID:-}"
}
```

### `scripts/test/sample-config.json`

```json
{
  "deployment_id": "00000000-0000-0000-0000-000000000001",
  "client_name": "TestFirma",
  "domain": "testfirma.pl",
  "created_at": "2026-03-01T00:00:00.000Z",
  "workspace": {
    "oauth_refresh_token": "test-workspace-refresh-token",
    "shared_drives": [
      { "name": "TestFirma-Dokumenty", "category": "dokumenty" },
      { "name": "TestFirma-Projekty", "category": "projekty" }
    ]
  },
  "accounts": [
    {
      "email": "jan@gmail.com",
      "name": "Jan Kowalski",
      "role": "ksiegowosc",
      "oauth_refresh_token": "test-refresh-token-jan",
      "folders": [
        { "id": "folder-001", "name": "Faktury 2024", "category": "dokumenty" },
        { "id": "folder-002", "name": "Projekty", "category": "projekty" },
        { "id": "folder-003", "name": "Filmy firmowe", "category": "media" }
      ]
    },
    {
      "email": "anna@gmail.com",
      "name": "Anna Nowak",
      "role": "projekty",
      "oauth_refresh_token": "test-refresh-token-anna",
      "folders": [
        { "id": "folder-004", "name": "Dokumenty projektowe", "category": "projekty" },
        { "id": "folder-005", "name": "Zdjecia", "category": "media" },
        { "id": "folder-006", "name": "Prywatne", "category": "prywatne" }
      ]
    }
  ],
  "b2": {
    "key_id": "test-b2-key-id",
    "app_key": "test-b2-app-key",
    "bucket_prefix": "testfirma"
  },
  "server": {
    "backup_path": "/srv/backup/gdrive",
    "bwlimit": "08:00,5M 23:00,50M"
  }
}
```

## Implementation Steps

1. **Create directory scaffold**
   ```bash
   mkdir -p scripts/{lib,systemd,test}
   ```

2. **Create `scripts/grota`** -- chmod +x

3. **Create `scripts/grota.env.example`**

4. **Create `scripts/lib/common.sh`** -- chmod +x

5. **Create `scripts/lib/config.sh`** -- chmod +x

6. **Create `scripts/lib/secrets.sh`** -- chmod +x

7. **Create `scripts/lib/notify.sh`** -- chmod +x

8. **Create `scripts/test/sample-config.json`**

9. **Verify with shellcheck**
   ```bash
   shellcheck scripts/lib/*.sh scripts/grota
   ```

## Manual Test Script

```bash
# 1. Source common lib
source scripts/lib/common.sh
# Expect: no errors

# 2. Test logging
init_logging "test"
log_info "Test info message"
log_warn "Test warning"
# Expect: formatted messages on stderr + log file created in LOG_DIR

# 3. Test disk check (should pass on dev machine)
check_disk_space / 5
# Expect: "Disk OK: XX% free on /"

# 4. Test require_cmd
require_cmd jq rclone
# Expect: passes if installed, fatal if missing

# 5. Test locking
acquire_lock "test-lock"
# Expect: lock dir created
ls -la /var/lock/grota/test-lock/pid
# Expect: file with current PID
release_lock
# Expect: lock dir removed

# 6. Test config loading from local file
source scripts/lib/config.sh
CONFIG_PATH=scripts/test/sample-config.json load_config
# Expect: "Config loaded from local file"

# 7. Test config accessors
echo "Client: $(cfg_client_name)"
# Expect: "TestFirma"
echo "Domain: $(cfg_domain)"
# Expect: "testfirma.pl"
echo "Accounts: $(cfg_account_count)"
# Expect: "2"
echo "Account 0 email: $(cfg_account_email 0)"
# Expect: "jan@gmail.com"
echo "Account 0 dokumenty folders:"
cfg_account_folders_by_category 0 "dokumenty"
# Expect: JSON array with Faktury 2024
echo "Shared Drives:"
cfg_shared_drives
# Expect: JSON array with TestFirma-Dokumenty, TestFirma-Projekty

# 8. Test secrets (env backend)
export TEST_SECRET="secret-value"
source scripts/lib/secrets.sh
get_secret "TEST_SECRET"
# Expect: "secret-value"

# 9. Test notify (no URL -- should warn and skip)
source scripts/lib/notify.sh
notify_info "test message"
# Expect: "[NOTIFY] test message" + "DATA_SERVICE_URL not set" warning

# 10. Test grota CLI
bash scripts/grota --help
# Expect: usage info with subcommands
bash scripts/grota --version
# Expect: "grota v0.1.0"

# 11. Shellcheck
shellcheck scripts/lib/*.sh scripts/grota
# Expect: no errors
```

## Unresolved Questions

- File-based secrets backend: needed for MVP or env-only sufficient?
