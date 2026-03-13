#!/usr/bin/env bash
# Backup functions: sync-gdrive_to-local, sync-local-to-b2, backup-account
# Called via: grota backup account <email>
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"


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

  sanitized_email=$(echo "$email" | tr '@.' '_')
  remote_name="gdrive_${sanitized_email}"
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

  sanitized_email=$(echo "$email" | tr '@.' '_')
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

    remote_name="b2_${category}"
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
  sanitized_email=$(echo "$email" | tr '@.' '_')

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

  # ── Step 3: Local -> B2 (optional)
  local b2_rc=0
  local b2_prefix
  b2_prefix=$(cfg_b2_prefix)

  if [[ -n "$b2_prefix" ]]; then
    log_info "Step 2/3: Local -> B2"
    sync_local_to_b2 "$idx" || b2_rc=$?

    if (( b2_rc != 0 && b2_rc != 7 )); then
      log_error "B2 sync failed for $email (exit $b2_rc)"
      exit 1
    fi

    # Local retention cleanup only when B2 is the archive
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
  else
    log_info "Step 2/3: B2 not configured, skipping remote sync (local-only backup)"
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
