#!/usr/bin/env bash
# Grota installer -- installs grota CLI + lib modules
# Usage: curl -fsSL https://raw.githubusercontent.com/auditmos/grota/main/apps/cli/install.sh | bash
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
echo "  4. grota setup b2         # configure B2 remotes (optional)"
echo "  5. grota verify remotes   # test all remotes"
echo "  6. grota timers install   # enable daily backups"
echo ""
echo "Update grota: re-run the same curl command"
