#!/usr/bin/env bash
# Timer management: install/uninstall/status systemd units
# Called via: grota timers install|uninstall|status
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

UNIT_DIR="/etc/systemd/system"
SYSTEMD_SRC="${GROTA_LIB_DIR:-/usr/local/lib/grota}/systemd"
UNITS=(grota-backup.service grota-backup.timer grota-verify.service grota-verify.timer)

# Dev mode: source from repo
if [[ -d "$(dirname "${BASH_SOURCE[0]}")/../systemd" ]]; then
  SYSTEMD_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../systemd" && pwd)"
fi

# ── grota timers status ────────────────────────────
cmd_timers_status() {
  echo "=== Grota timer status ==="
  for unit in "${UNITS[@]}"; do
    echo "--- $unit ---"
    systemctl status "$unit" --no-pager 2>/dev/null || echo "  Not installed"
  done
  echo ""
  echo "=== Next scheduled runs ==="
  systemctl list-timers grota-* --no-pager 2>/dev/null || echo "  No timers found"
}

# ── grota timers uninstall ─────────────────────────
cmd_timers_uninstall() {
  [[ $EUID -eq 0 ]] || log_fatal "Must run as root"

  echo "Uninstalling Grota timers..."

  for unit in "${UNITS[@]}"; do
    systemctl stop "$unit" 2>/dev/null || true
    systemctl disable "$unit" 2>/dev/null || true
    rm -f "${UNIT_DIR}/${unit}"
  done

  systemctl daemon-reload
  echo "Grota timers uninstalled"
}

# ── grota timers install ──────────────────────────
cmd_timers_install() {
  [[ $EUID -eq 0 ]] || log_fatal "Must run as root"

  echo "Installing Grota timers..."

  # Create grota user if missing
  if ! id grota &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin grota
    echo "Created system user: grota"
  fi

  # Create directories
  mkdir -p /srv/backup/gdrive /var/log/grota /var/lock/grota

  # Copy unit files from lib/systemd/
  for unit in "${UNITS[@]}"; do
    if [[ ! -f "${SYSTEMD_SRC}/${unit}" ]]; then
      log_fatal "Unit file not found: ${SYSTEMD_SRC}/${unit}"
    fi
    cp "${SYSTEMD_SRC}/${unit}" "${UNIT_DIR}/${unit}"
    echo "Installed: ${unit}"
  done

  # Set ownership
  chown -R grota:grota /srv/backup/gdrive /var/log/grota /var/lock/grota

  if [[ -f /etc/grota/grota.env ]]; then
    chown grota:grota /etc/grota/grota.env
    chmod 600 /etc/grota/grota.env
  fi

  if [[ -f /etc/rclone/rclone.conf ]]; then
    chown grota:grota /etc/rclone/rclone.conf
    chmod 600 /etc/rclone/rclone.conf
  fi

  # Reload and enable
  systemctl daemon-reload

  for timer in grota-backup.timer grota-verify.timer; do
    systemctl enable "$timer"
    systemctl start "$timer"
    echo "Enabled and started: $timer"
  done

  echo ""
  echo "=== Installation complete ==="
  echo "Config:  /etc/grota/grota.env"
  echo "Backup:  /srv/backup/gdrive/"
  echo "Logs:    journalctl -u grota-backup"
  echo ""
  systemctl list-timers grota-* --no-pager
}
