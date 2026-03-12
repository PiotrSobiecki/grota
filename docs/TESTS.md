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
