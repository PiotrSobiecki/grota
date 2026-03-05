# 106: Systemd Timers

## Goal

Create systemd timer/service units for automated backup scheduling and functions in `lib/timers.sh` to install/uninstall/status them -- enabling hands-off daily backups and weekly integrity checks. Invoked via `grota timers install|uninstall|status`.

## Prerequisites

- Doc 100 (lib foundation)
- Doc 099 (install.sh -- units placed in `/usr/local/lib/grota/systemd/`)
- Doc 104 (backup-all via `grota backup all`)
- Doc 107 (audit scripts via `grota audit backup`)
- Ubuntu server with systemd

## Scope

### IN

- `scripts/lib/timers.sh` -- functions: `cmd_timers_install`, `cmd_timers_uninstall`, `cmd_timers_status`
- `scripts/systemd/grota-backup.service` -- runs `grota backup all`
- `scripts/systemd/grota-backup.timer` -- daily at 01:00
- `scripts/systemd/grota-verify.service` -- runs `grota audit backup`
- `scripts/systemd/grota-verify.timer` -- weekly Sunday 03:00

### OUT

- Backup script logic (doc 103-104)
- Audit script logic (doc 107)
- Log rotation (journald handles it -- systemd timers log to journal)

## Decisions

| Item | Decision |
|------|----------|
| Scheduler | systemd timers (not cron). Better logging, dependency management, calendar expressions. |
| User | Runs as dedicated `grota` user (created by installer if missing). |
| Timer persistence | `Persistent=true` -- if server was off at scheduled time, runs on next boot. |
| Unit source | Units stored in `/usr/local/lib/grota/systemd/` (placed by install.sh). `grota timers install` copies to `/etc/systemd/system/`. |
| Env file | Service loads `EnvironmentFile=/etc/grota/grota.env`. |
| ExecStart | Uses `/usr/local/bin/grota` CLI entry point. |
| Log rotation | journald handles log rotation for systemd services. Script logs to `/var/log/grota/` also rotated via logrotate or size-limited in common.sh. |
| rclone token refresh | Use `--drive-token` inline from config JSON to avoid rclone.conf write permission issues with `ProtectSystem=strict`. |

## Files

### `scripts/systemd/grota-backup.service`

```ini
[Unit]
Description=Grota backup - all accounts
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=grota
Group=grota
EnvironmentFile=/etc/grota/grota.env
ExecStart=/usr/local/bin/grota backup all
TimeoutStartSec=14400
StandardOutput=journal
StandardError=journal

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/backup /var/log/grota /var/lock/grota /tmp
PrivateTmp=true
```

### `scripts/systemd/grota-backup.timer`

```ini
[Unit]
Description=Grota daily backup timer

[Timer]
OnCalendar=*-*-* 01:00:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

### `scripts/systemd/grota-verify.service`

```ini
[Unit]
Description=Grota weekly backup verification
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=grota
Group=grota
EnvironmentFile=/etc/grota/grota.env
ExecStart=/usr/local/bin/grota audit backup
TimeoutStartSec=7200
StandardOutput=journal
StandardError=journal

NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/backup /var/log/grota /var/lock/grota /tmp
PrivateTmp=true
```

### `scripts/systemd/grota-verify.timer`

```ini
[Unit]
Description=Grota weekly verification timer

[Timer]
OnCalendar=Sun *-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

### `scripts/lib/timers.sh`

```bash
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
```

## Implementation Steps

1. **Create systemd directory**
   ```bash
   mkdir -p scripts/systemd
   ```

2. **Create unit files**
   - `scripts/systemd/grota-backup.service`
   - `scripts/systemd/grota-backup.timer`
   - `scripts/systemd/grota-verify.service`
   - `scripts/systemd/grota-verify.timer`

3. **Create `scripts/lib/timers.sh`** -- chmod +x

4. **Verify with shellcheck**
   ```bash
   shellcheck scripts/lib/timers.sh
   ```

## Manual Test Script

```bash
# Must run on Ubuntu server with systemd (not macOS)

# 1. Install (as root)
sudo grota timers install
# Expect:
#   - grota user created
#   - Unit files installed in /etc/systemd/system/
#   - Timers enabled and started
#   - Timer list shown

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
# Expect: runs grota backup all

# 5. Check logs
journalctl -u grota-backup.service --no-pager -n 50
# Expect: backup logs

# 6. Verify hardening
systemctl show grota-backup.service | grep -E 'NoNewPrivileges|ProtectSystem'
# Expect: NoNewPrivileges=yes, ProtectSystem=strict

# 7. Test uninstall
sudo grota timers uninstall
# Expect: timers stopped, disabled, unit files removed

# 8. Verify uninstall
systemctl list-timers grota-*
# Expect: no grota timers

# 9. Re-install for production
sudo grota timers install
```

## Unresolved Questions

- `RandomizedDelaySec=300` on backup timer: 5 min jitter enough or too much?
