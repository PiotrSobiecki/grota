# 103: Single Account Backup

## Goal

Implement the core backup pipeline for a single Google account: sync Google Drive folders to local server, then sync local to Backblaze B2 -- per-category, with bandwidth scheduling, versioning, and proper error handling. Invoked via `grota backup account <email>`.

## Prerequisites

- Doc 100 (lib foundation)
- Doc 102 (rclone setup -- Drive + B2 remotes configured)
- rclone remotes verified (`grota verify remotes` passes)

## Scope

### IN

- `scripts/lib/backup.sh` -- functions: `cmd_backup_account`, `sync_gdrive_to_local`, `sync_local_to_b2`
- `cmd_backup_account` -- full pipeline for ONE account (GDrive -> local -> B2)
- `sync_gdrive_to_local` -- single account, all categories
- `sync_local_to_b2` -- local -> B2, per category
- Per-account locking (directory-based)
- Bandwidth scheduling (`--bwlimit`)
- Version backups (`--backup-dir`)
- Google Docs export (`--drive-export-formats`)
- Error handling: OAuth revoked (exit 6), disk full, API errors
- Retention: media local cleanup (>90d)

### OUT

- Multi-account orchestration (doc 104)
- Notifications (doc 104 -- `cmd_backup_account` returns exit codes, orchestrator notifies)
- Shared Drive migration (doc 105)
- Systemd scheduling (doc 106)

## Decisions

| Item | Decision |
|------|----------|
| Local dir structure | `{backup_root}/{email}/{category}/` e.g. `/srv/backup/gdrive/jan-gmail-com/dokumenty/` |
| Version dir | `{backup_root}/.versions/{email}/{timestamp}/` -- `--backup-dir` stores deleted/changed files |
| Export formats | `--drive-export-formats docx,xlsx,pptx,pdf` -- Google Docs exported to Office + PDF |
| Sync direction | `rclone sync` (mirror source), NOT `rclone copy` (additive). Deletions propagate. |
| Folder filtering | `--drive-root-folder-id {folder_id}` per folder, sync each tagged folder separately |
| Exit codes | 0=success, 1=general error, 5=disk full, 6=OAuth revoked, 7=partial failure |

## Files

### `scripts/lib/backup.sh`

```bash
#!/usr/bin/env bash
# Backup functions: sync-gdrive-to-local, sync-local-to-b2, backup-account
# Called via: grota backup account <email>
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/rclone/rclone.conf}"
export RCLONE_CONFIG

# ── Helpers ────────────────────────────────────────
_find_account_index() {
  local email="$1"
  local count
  count=$(cfg_account_count)
  for (( i=0; i<count; i++ )); do
    if [[ "$(cfg_account_email "$i")" == "$email" ]]; then
      echo "$i"
      return 0
    fi
  done
  return 1
}

# ── sync_gdrive_to_local <account_index> ──────────
sync_gdrive_to_local() {
  local idx="$1"
  require_cmd rclone jq

  local email sanitized_email remote_name backup_root bwlimit timestamp
  email=$(cfg_account_email "$idx")
  [[ "$email" != "null" && -n "$email" ]] || log_fatal "Invalid account index: $idx"

  sanitized_email=$(echo "$email" | tr '@.' '-')
  remote_name="gdrive-${sanitized_email}"
  backup_root=$(cfg_server_backup_path)
  bwlimit=$(cfg_server_bwlimit)
  timestamp=$(date '+%Y%m%d-%H%M%S')

  log_info "Syncing Drive -> local for $email (account $idx)"

  check_disk_space "$backup_root" 10

  acquire_lock "backup-${sanitized_email}"

  local folders_json folder_count synced=0 failed=0
  folders_json=$(cfg_account_folders "$idx")
  folder_count=$(echo "$folders_json" | jq 'length')

  for (( f=0; f<folder_count; f++ )); do
    local folder_id folder_name category local_dir version_dir
    folder_id=$(echo "$folders_json" | jq -r ".[$f].id")
    folder_name=$(echo "$folders_json" | jq -r ".[$f].name")
    category=$(echo "$folders_json" | jq -r ".[$f].category")

    # Skip private folders
    if [[ "$category" == "prywatne" ]]; then
      log_info "  Skipping: $folder_name (prywatne)"
      continue
    fi

    local_dir="${backup_root}/${sanitized_email}/${category}/${folder_name}"
    version_dir="${backup_root}/.versions/${sanitized_email}/${timestamp}"
    mkdir -p "$local_dir" "$version_dir"

    log_info "  Syncing: $folder_name ($category) -> $local_dir"

    local rc=0
    rclone sync "${remote_name}:" "$local_dir" \
      --drive-root-folder-id "$folder_id" \
      --drive-export-formats "docx,xlsx,pptx,pdf" \
      --backup-dir "$version_dir" \
      --bwlimit "$bwlimit" \
      --track-renames \
      --fast-list \
      --retries 3 \
      --retries-sleep 30s \
      --timeout 300s \
      --stats-one-line \
      --stats 30s \
      --log-level INFO \
      2>&1 | while IFS= read -r line; do log_info "    rclone: $line"; done \
      || rc=$?

    if (( rc == 0 )); then
      synced=$((synced + 1))
      log_info "  Done: $folder_name"
    elif (( rc == 9 )); then
      log_error "  OAuth error for $email (folder: $folder_name)"
      exit 6
    else
      log_error "  Failed: $folder_name (rclone exit $rc)"
      failed=$((failed + 1))
    fi
  done

  log_info "Drive -> local complete for $email: $synced synced, $failed failed"

  if (( failed > 0 )); then
    exit 7
  fi
}

# ── sync_local_to_b2 <account_index> ──────────────
sync_local_to_b2() {
  local idx="$1"
  require_cmd rclone jq

  local email sanitized_email backup_root bucket_prefix
  email=$(cfg_account_email "$idx")
  [[ "$email" != "null" && -n "$email" ]] || log_fatal "Invalid account index: $idx"

  sanitized_email=$(echo "$email" | tr '@.' '-')
  backup_root=$(cfg_server_backup_path)
  bucket_prefix=$(cfg_b2_prefix)

  log_info "Syncing local -> B2 for $email (account $idx)"

  local synced=0 failed=0

  for category in dokumenty projekty media; do
    local local_dir remote_name bucket_name b2_path
    local_dir="${backup_root}/${sanitized_email}/${category}"

    if [[ ! -d "$local_dir" ]]; then
      log_info "  No local data for $category, skipping"
      continue
    fi

    remote_name="b2-${category}"
    bucket_name="${bucket_prefix}-${category}"
    b2_path="${remote_name}:${bucket_name}/${sanitized_email}"

    log_info "  Syncing: $local_dir -> $b2_path"

    local rc=0
    rclone sync "$local_dir" "$b2_path" \
      --fast-list \
      --retries 3 \
      --retries-sleep 30s \
      --timeout 300s \
      --stats-one-line \
      --stats 30s \
      --log-level INFO \
      2>&1 | while IFS= read -r line; do log_info "    rclone: $line"; done \
      || rc=$?

    if (( rc == 0 )); then
      synced=$((synced + 1))
      log_info "  Done: $category -> B2"
    else
      log_error "  Failed: $category (rclone exit $rc)"
      failed=$((failed + 1))
    fi
  done

  log_info "Local -> B2 complete for $email: $synced synced, $failed failed"

  if (( failed > 0 )); then
    exit 7
  fi
}

# ── grota backup account <email> ──────────────────
cmd_backup_account() {
  local email="${1:?Usage: grota backup account <email>}"
  init_logging "backup-account"
  require_cmd rclone jq

  local idx
  idx=$(_find_account_index "$email") || log_fatal "Account not found: $email"

  local backup_root sanitized_email
  backup_root=$(cfg_server_backup_path)
  sanitized_email=$(echo "$email" | tr '@.' '-')

  log_info "=== Backup pipeline: $email (index $idx) ==="

  # ── Step 1: Pre-flight checks
  check_disk_space "$backup_root" 10 || exit 5

  # ── Step 2: Drive -> Local
  log_info "Step 1/3: Google Drive -> Local"
  local rc=0
  sync_gdrive_to_local "$idx" || rc=$?

  if (( rc == 6 )); then
    log_error "OAuth token revoked for $email"
    exit 6
  elif (( rc != 0 && rc != 7 )); then
    log_error "Drive sync failed for $email (exit $rc)"
    exit 1
  fi

  local drive_status=$rc

  # ── Step 3: Local -> B2
  log_info "Step 2/3: Local -> B2"
  local b2_rc=0
  sync_local_to_b2 "$idx" || b2_rc=$?

  if (( b2_rc != 0 && b2_rc != 7 )); then
    log_error "B2 sync failed for $email (exit $b2_rc)"
    exit 1
  fi

  # ── Step 4: Local retention cleanup
  log_info "Step 3/3: Local retention cleanup (media >90d)"
  local media_dir="${backup_root}/${sanitized_email}/media"
  if [[ -d "$media_dir" ]]; then
    local old_count
    old_count=$(find "$media_dir" -type f -mtime +90 | wc -l)
    if (( old_count > 0 )); then
      log_info "  Cleaning $old_count files older than 90d from $media_dir"
      find "$media_dir" -type f -mtime +90 -delete
    fi
  fi

  # Clean old version dirs (>30d)
  local versions_dir="${backup_root}/.versions/${sanitized_email}"
  if [[ -d "$versions_dir" ]]; then
    find "$versions_dir" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
  fi

  # ── Summary
  if (( drive_status == 7 || b2_rc == 7 )); then
    log_warn "Backup completed with partial failures for $email"
    exit 7
  fi

  log_info "=== Backup pipeline complete: $email ==="
}
```

## Implementation Steps

1. **Create `scripts/lib/backup.sh`** -- chmod +x

2. **Verify with shellcheck**
   ```bash
   shellcheck scripts/lib/backup.sh
   ```

## Manual Test Script

```bash
# Prerequisites:
# - rclone configured with at least 1 real Drive + B2 remote (doc 102)
# - Config JSON with at least 1 account with real OAuth token
# - Local backup dir writable

export CONFIG_PATH=scripts/test/sample-config.json  # or real config
export RCLONE_CONFIG="/etc/rclone/rclone.conf"

# 1. Test single account backup
grota backup account jan@gmail.com
# Expect: Drive -> local -> B2 pipeline runs
# Exit code: 0

# 2. Verify local files
ls -la /srv/backup/gdrive/jan-gmail-com/dokumenty/
# Expect: files from Google Drive

# 3. Verify B2 upload
rclone ls b2-dokumenty:testfirma-dokumenty/jan-gmail-com/
# Expect: same files as local

# 4. Test disk full scenario (simulate)
# Fill disk to >90%, run:
grota backup account jan@gmail.com
# Expect: exit code 5, "Disk space critical" error

# 5. Test invalid account
grota backup account nonexistent@example.com
# Expect: exit code 1, "Account not found"

# 6. Test locking (run two instances)
grota backup account jan@gmail.com &
grota backup account jan@gmail.com
# Expect: second instance fails with "Lock already held"

# 7. Check version backup
# Modify a file in Drive, re-run sync
grota backup account jan@gmail.com
ls /srv/backup/gdrive/.versions/jan-gmail-com/
# Expect: timestamped directory with old version

# 8. Check media retention
touch -d "100 days ago" /srv/backup/gdrive/jan-gmail-com/media/test/old-file.mp4
grota backup account jan@gmail.com
ls /srv/backup/gdrive/jan-gmail-com/media/test/old-file.mp4
# Expect: file deleted (>90d)
```

## Unresolved Questions

- `--drive-root-folder-id` with `rclone sync` syncs folder contents to destination root. Folder name preserved in local path (`{category}/{folder_name}/`) but what if two folders have same name?
- Bandwidth scheduling: `--bwlimit` only applies to Drive sync, not B2 sync. Apply to both?
- Version cleanup: 30d hardcoded. Should this be configurable in config JSON?
