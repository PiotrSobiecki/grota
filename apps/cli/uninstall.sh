#!/usr/bin/env bash
# Grota uninstaller -- removes CLI, timers, config, logs, and backup data
# Usage: curl -fsSL https://raw.githubusercontent.com/auditmos/grota/main/apps/cli/uninstall.sh | bash
#    or: ./uninstall.sh
#
# Flags:
#   --keep-data    Skip deleting /srv/backup/gdrive (preserve backups)
#   --keep-config  Skip deleting /etc/grota (preserve credentials)
#   --yes          Skip confirmation prompt
set -euo pipefail

BIN_DIR="/usr/local/bin"
LIB_DIR="/usr/local/lib/grota"
ETC_DIR="/etc/grota"
LOG_DIR="/var/log/grota"
LOCK_DIR="/var/lock/grota"
BACKUP_DIR="/srv/backup/gdrive"
UNIT_DIR="/etc/systemd/system"
UNITS=(grota-backup.service grota-backup.timer grota-verify.service grota-verify.timer)

KEEP_DATA=false
KEEP_CONFIG=false
AUTO_YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-data)   KEEP_DATA=true;   shift ;;
    --keep-config) KEEP_CONFIG=true; shift ;;
    --yes|-y)      AUTO_YES=true;    shift ;;
    *)             echo "Usage: uninstall.sh [--keep-data] [--keep-config] [--yes]"; exit 1 ;;
  esac
done

# ── Require root ────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "Re-running with sudo..."
  exec sudo bash "$0" "$@"
fi

echo "=== Grota Uninstaller ==="
echo ""
echo "This will remove:"
echo "  - CLI:     ${BIN_DIR}/grota"
echo "  - Libs:    ${LIB_DIR}/"
echo "  - Systemd: all grota timers & services"
echo "  - Logs:    ${LOG_DIR}/"
echo "  - Locks:   ${LOCK_DIR}/"
[[ "$KEEP_CONFIG" == true ]] || echo "  - Config:  ${ETC_DIR}/"
[[ "$KEEP_DATA" == true ]]   || echo "  - Backups: ${BACKUP_DIR}/"
echo "  - Rclone:  grota-related entries in rclone.conf (if any)"
echo ""

if [[ "$AUTO_YES" != true ]]; then
  read -rp "Continue? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# ── Stop & remove systemd timers ────────────────────
echo "Stopping timers & services..."
for unit in "${UNITS[@]}"; do
  systemctl stop "$unit" 2>/dev/null || true
  systemctl disable "$unit" 2>/dev/null || true
  rm -f "${UNIT_DIR}/${unit}"
done
systemctl daemon-reload
echo "  Timers removed"

# ── Remove CLI & libs ──────────────────────────────
echo "Removing CLI & libs..."
rm -f "${BIN_DIR}/grota"
rm -rf "${LIB_DIR}"
echo "  Done"

# ── Remove config ──────────────────────────────────
if [[ "$KEEP_CONFIG" == true ]]; then
  echo "Keeping config: ${ETC_DIR}/"
else
  echo "Removing config..."
  rm -rf "${ETC_DIR}"
  echo "  Done"
fi

# ── Remove rclone config entries ───────────────────
clean_rclone_conf() {
  local conf="$1"
  [[ -f "$conf" ]] || return 0

  if grep -q 'gdrive_\|b2_dokumenty\|b2_projekty\|b2_media\|workspace_drive' "$conf" 2>/dev/null; then
    echo "  Cleaning grota remotes from ${conf}..."
    # Remove [gdrive_*], [b2_*], [workspace_drive] sections
    sed -i '/^\[gdrive_/,/^\[/{ /^\[gdrive_/d; /^\[/!d; }' "$conf"
    sed -i '/^\[b2_dokumenty\]/,/^\[/{ /^\[b2_dokumenty\]/d; /^\[/!d; }' "$conf"
    sed -i '/^\[b2_projekty\]/,/^\[/{ /^\[b2_projekty\]/d; /^\[/!d; }' "$conf"
    sed -i '/^\[b2_media\]/,/^\[/{ /^\[b2_media\]/d; /^\[/!d; }' "$conf"
    sed -i '/^\[workspace_drive\]/,/^\[/{ /^\[workspace_drive\]/d; /^\[/!d; }' "$conf"
    # Remove empty lines left behind
    sed -i '/^$/N;/^\n$/d' "$conf"
    echo "  Done"
  fi
}

echo "Cleaning rclone config..."
# grota user home (system user, usually no home)
clean_rclone_conf "/etc/rclone/rclone.conf"
# root's config (installer runs as root)
clean_rclone_conf "/root/.config/rclone/rclone.conf"
# grota system user might have a home dir
if id grota &>/dev/null; then
  grota_home="$(eval echo ~grota 2>/dev/null)" || true
  [[ -n "$grota_home" ]] && clean_rclone_conf "${grota_home}/.config/rclone/rclone.conf"
fi
echo "  Done"

# ── Remove logs & locks ───────────────────────────
echo "Removing logs & locks..."
rm -rf "${LOG_DIR}" "${LOCK_DIR}"
echo "  Done"

# ── Remove backup data ────────────────────────────
if [[ "$KEEP_DATA" == true ]]; then
  echo "Keeping backup data: ${BACKUP_DIR}/"
else
  echo "Removing backup data..."
  rm -rf "${BACKUP_DIR}"
  echo "  Done"
fi

# ── Remove grota user ─────────────────────────────
if id grota &>/dev/null; then
  userdel grota 2>/dev/null || true
  echo "Removed system user: grota"
fi

# ── Done ──────────────────────────────────────────
echo ""
echo "=== Uninstall complete ==="
echo ""
echo "Note: B2 (Backblaze) buckets still contain synced data."
echo "  Delete manually via B2 dashboard or:"
echo "  rclone purge b2_dokumenty:<bucket>"
echo "  rclone purge b2_projekty:<bucket>"
echo "  rclone purge b2_media:<bucket>"
