# 099: Server Install & Distribution

## Goal

Provide a single `curl` one-liner to install grota CLI + libs on any Ubuntu server, with offline alternative for air-gapped environments.

## Prerequisites

- Ubuntu 22.04+ server
- `curl` available
- `sudo` access

## Scope

### IN

- `apps/cli/install.sh` -- installer script
- `curl` one-liner from GitHub raw
- Offline `--local` mode via scp + tar
- Dependency checking (rclone, jq; terraform optional)
- Installation layout on target server
- Update = re-run same curl

### OUT

- Config population (manual post-install)
- rclone setup (doc 102)
- Terraform provisioning (doc 101)
- systemd timer install (doc 106 -- `grota timers install`)

## Decisions

| Item | Decision |
|------|----------|
| Language | Bash. jq only external dep for JSON parsing. rclone, terraform, curl as CLI tools. |
| Distribution | curl one-liner from GitHub raw. Offline: scp tar + `./install.sh --local`. |
| Entry point | Single `grota` binary in `/usr/local/bin/`. Sources `lib/` modules for subcommands. |
| Update | Same curl overwrites bin+lib, preserves `/etc/grota/` config. |
| User | Dedicated `grota` system user created if missing. |

## Installation Layout

```
/usr/local/bin/grota              # entry point (in PATH)
/usr/local/lib/grota/             # lib/*.sh modules
/usr/local/lib/grota/systemd/     # timer/service units (installed via grota timers install)
/etc/grota/                       # grota.env + config.json
/etc/grota/grota.env.example      # template
/var/log/grota/                   # logs
/var/lock/grota/                  # locks (runtime)
/srv/backup/gdrive/               # backup data
```

## curl One-Liner

```bash
curl -fsSL https://raw.githubusercontent.com/auditmos/grota/main/apps/cli/install.sh | bash
```

## Files

### `apps/cli/install.sh`

```bash
#!/usr/bin/env bash
# Grota installer -- installs grota CLI + lib modules
# Usage: curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash
#    or: ./install.sh --local (from extracted tarball)
set -euo pipefail

REPO_URL="https://raw.githubusercontent.com/auditmos/grota/main"
BIN_DIR="/usr/local/bin"
LIB_DIR="/usr/local/lib/grota"
ETC_DIR="/etc/grota"
LOG_DIR="/var/log/grota"
LOCK_DIR="/var/lock/grota"
BACKUP_DIR="/srv/backup/gdrive"

LOCAL_MODE=false
SCRIPT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) LOCAL_MODE=true; shift ;;
    *)       echo "Usage: install.sh [--local]"; exit 1 ;;
  esac
done

if [[ "$LOCAL_MODE" == true ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

# ── Require root ────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "Re-running with sudo..."
  exec sudo bash "$0" "$@"
fi

echo "=== Grota Installer ==="
echo ""

# ── Check dependencies ──────────────────────────────
check_dep() {
  local cmd="$1"
  local required="${2:-true}"

  if command -v "$cmd" >/dev/null 2>&1; then
    echo "  [OK]   $cmd ($(command -v "$cmd"))"
    return 0
  fi

  if [[ "$required" == true ]]; then
    echo "  [MISS] $cmd -- REQUIRED"
    return 1
  else
    echo "  [MISS] $cmd -- optional"
    return 0
  fi
}

echo "Checking dependencies..."
missing=0
check_dep rclone   true  || missing=$((missing + 1))
check_dep jq       true  || missing=$((missing + 1))
check_dep curl     true  || missing=$((missing + 1))
check_dep terraform false
echo ""

if (( missing > 0 )); then
  echo "Missing required dependencies. Install them first:"
  echo "  apt-get update && apt-get install -y jq curl"
  echo "  curl https://rclone.org/install.sh | bash"
  exit 1
fi

# ── Create grota user ───────────────────────────────
if ! id grota &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin grota
  echo "Created system user: grota"
fi

# ── Create directories ──────────────────────────────
echo "Creating directories..."
mkdir -p "$LIB_DIR" "$ETC_DIR" "$LOG_DIR" "$LOCK_DIR" "$BACKUP_DIR"

# ── Install files ───────────────────────────────────
fetch_file() {
  local src="$1"
  local dst="$2"

  if [[ "$LOCAL_MODE" == true ]]; then
    cp "$src" "$dst"
  else
    curl -fsSL "${REPO_URL}/${src}" -o "$dst"
  fi
}

echo "Installing grota CLI..."
if [[ "$LOCAL_MODE" == true ]]; then
  cp "${SCRIPT_DIR}/grota" "${BIN_DIR}/grota"
else
  fetch_file "apps/cli/grota" "${BIN_DIR}/grota"
fi
chmod +x "${BIN_DIR}/grota"
echo "  ${BIN_DIR}/grota"

echo "Installing lib modules..."
mkdir -p "${LIB_DIR}"
for mod in common.sh config.sh secrets.sh notify.sh backup.sh orchestrator.sh migration.sh setup.sh audit.sh timers.sh; do
  if [[ "$LOCAL_MODE" == true ]]; then
    [[ -f "${SCRIPT_DIR}/lib/${mod}" ]] && cp "${SCRIPT_DIR}/lib/${mod}" "${LIB_DIR}/${mod}"
  else
    fetch_file "apps/cli/lib/${mod}" "${LIB_DIR}/${mod}" 2>/dev/null || true
  fi
  [[ -f "${LIB_DIR}/${mod}" ]] && echo "  ${LIB_DIR}/${mod}"
done
chmod +x "${LIB_DIR}"/*.sh 2>/dev/null || true

echo "Installing systemd units..."
mkdir -p "${LIB_DIR}/systemd"
for unit in grota-backup.service grota-backup.timer grota-verify.service grota-verify.timer; do
  if [[ "$LOCAL_MODE" == true ]]; then
    [[ -f "${SCRIPT_DIR}/systemd/${unit}" ]] && cp "${SCRIPT_DIR}/systemd/${unit}" "${LIB_DIR}/systemd/${unit}"
  else
    fetch_file "apps/cli/systemd/${unit}" "${LIB_DIR}/systemd/${unit}" 2>/dev/null || true
  fi
  [[ -f "${LIB_DIR}/systemd/${unit}" ]] && echo "  ${LIB_DIR}/systemd/${unit}"
done

# ── Config template ─────────────────────────────────
if [[ ! -f "${ETC_DIR}/grota.env" ]]; then
  if [[ "$LOCAL_MODE" == true && -f "${SCRIPT_DIR}/grota.env.example" ]]; then
    cp "${SCRIPT_DIR}/grota.env.example" "${ETC_DIR}/grota.env.example"
  else
    fetch_file "apps/cli/grota.env.example" "${ETC_DIR}/grota.env.example" 2>/dev/null || true
  fi
  echo "  ${ETC_DIR}/grota.env.example"
  echo "  NOTE: Copy to grota.env and fill in values"
else
  echo "  ${ETC_DIR}/grota.env exists -- preserved"
fi

# ── Ownership ───────────────────────────────────────
chown -R grota:grota "$LOG_DIR" "$LOCK_DIR" "$BACKUP_DIR"
chown grota:grota "${ETC_DIR}/grota.env" 2>/dev/null || true
chmod 600 "${ETC_DIR}/grota.env" 2>/dev/null || true

# ── Done ────────────────────────────────────────────
echo ""
echo "=== Installation complete ==="
echo ""
echo "Installed:"
echo "  CLI:     ${BIN_DIR}/grota"
echo "  Libs:    ${LIB_DIR}/"
echo "  Systemd: ${LIB_DIR}/systemd/ (not activated -- use: grota timers install)"
echo "  Config:  ${ETC_DIR}/"
echo "  Logs:    ${LOG_DIR}/"
echo "  Backups: ${BACKUP_DIR}/"
echo ""
echo "Next steps:"
echo "  1. cp ${ETC_DIR}/grota.env.example ${ETC_DIR}/grota.env"
echo "  2. Edit ${ETC_DIR}/grota.env with real credentials"
echo "  3. grota setup rclone     # configure Drive remotes"
echo "  4. grota setup b2         # configure B2 remotes"
echo "  5. grota verify remotes   # test all remotes"
echo "  6. grota timers install   # enable daily backups"
echo ""
echo "Update grota: re-run the same curl command"
```

## Offline Install

```bash
# On machine with internet:
git clone https://github.com/auditmos/grota.git
tar czf grota-cli.tar.gz -C grota apps/cli/

# Transfer to server:
scp grota-cli.tar.gz user@server:/tmp/

# On server:
cd /tmp && tar xzf grota-cli.tar.gz
bash apps/cli/install.sh --local
```

## Implementation Steps

1. **Create `apps/cli/install.sh`** -- chmod +x

2. **Test locally**
   ```bash
   shellcheck apps/cli/install.sh
   ```

## Manual Test Script

```bash
# On fresh Ubuntu server (or container):

# 1. curl install
curl -fsSL https://raw.githubusercontent.com/auditmos/grota/main/apps/cli/install.sh | bash
# Expect: deps checked, grota CLI installed, dirs created, next steps printed

# 2. Verify install
grota --help
# Expect: usage info with subcommands

# 3. Verify layout
ls -la /usr/local/bin/grota
ls -la /usr/local/lib/grota/
ls -la /usr/local/lib/grota/systemd/
ls -la /etc/grota/
ls -la /var/log/grota/

# 4. Test update (re-run)
curl -fsSL https://raw.githubusercontent.com/auditmos/grota/main/apps/cli/install.sh | bash
# Expect: overwrites bin+lib, preserves /etc/grota/grota.env

# 5. Test offline mode
tar czf /tmp/grota.tar.gz -C /path/to/repo apps/cli/
cd /tmp && tar xzf grota.tar.gz
bash apps/cli/install.sh --local
# Expect: same result from local files

# 6. Test missing deps
# On minimal container without rclone:
curl -fsSL .../install.sh | bash
# Expect: "[MISS] rclone -- REQUIRED" + exit 1
```

## Unresolved Questions

- GitHub repo visibility: public or private? Private requires auth token in curl.
- Versioning: tag releases? install.sh always pulls main branch currently.
