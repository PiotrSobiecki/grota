#!/usr/bin/env bash
# Migration: copy folders from private accounts to Shared Drives
# Called via: grota migrate [--dry-run] [--account EMAIL] [--verify]
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/rclone/rclone.conf}"
export RCLONE_CONFIG

WORKSPACE_REMOTE="workspace-drive"

# ── Get Shared Drive ID by name ────────────────────
_get_shared_drive_id() {
  local name="$1"
  local drive_id
  drive_id=$(rclone backend drives "${WORKSPACE_REMOTE}:" 2>/dev/null \
    | jq -r ".[] | select(.name == \"$name\") | .id" \
    || echo "")

  if [[ -z "$drive_id" ]]; then
    log_fatal "Shared Drive not found: $name"
  fi
  echo "$drive_id"
}

# ── Map category -> Shared Drive name from config ──
_get_drive_name_for_category() {
  local category="$1"
  local drives_json
  drives_json=$(cfg_shared_drives)
  echo "$drives_json" | jq -r ".[] | select(.category == \"$category\") | .name"
}

# ── grota migrate ──────────────────────────────────
cmd_migrate() {
  init_logging "migrate"
  require_cmd rclone jq

  local dry_run="" account_filter="" verify_only=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)  dry_run="--dry-run"; shift ;;
      --account)  account_filter="$2"; shift 2 ;;
      --verify)   verify_only=true; shift ;;
      *)          log_fatal "Unknown arg: $1" ;;
    esac
  done

  if [[ "$verify_only" == true ]]; then
    _verify_migration "$account_filter"
    return
  fi

  # Verify workspace remote exists
  if ! rclone listremotes | grep -q "^${WORKSPACE_REMOTE}:$"; then
    log_fatal "Remote '$WORKSPACE_REMOTE' not found. Run: grota setup rclone"
  fi

  # Resolve Shared Drive IDs from config
  local dok_name dok_id proj_name proj_id
  dok_name=$(_get_drive_name_for_category "dokumenty")
  proj_name=$(_get_drive_name_for_category "projekty")

  [[ -n "$dok_name" ]] || log_fatal "No shared_drive configured for 'dokumenty' in workspace.shared_drives"
  [[ -n "$proj_name" ]] || log_fatal "No shared_drive configured for 'projekty' in workspace.shared_drives"

  log_info "Looking up Shared Drive IDs..."
  dok_id=$(_get_shared_drive_id "$dok_name")
  proj_id=$(_get_shared_drive_id "$proj_name")
  log_info "  $dok_name: $dok_id"
  log_info "  $proj_name: $proj_id"

  [[ -n "$dry_run" ]] && log_info "DRY RUN mode -- no files will be copied"

  # ── Migrate ───────────────────────────────────────
  local account_count migrated=0 failed=0 skipped=0
  account_count=$(cfg_account_count)

  for (( i=0; i<account_count; i++ )); do
    local email name sanitized_email remote_name
    email=$(cfg_account_email "$i")

    # Filter by account if specified
    if [[ -n "$account_filter" && "$account_filter" != "$email" ]]; then
      continue
    fi

    name=$(cfg_account_name "$i")
    sanitized_email=$(echo "$email" | tr '@.' '-')
    remote_name="gdrive-${sanitized_email}"

    log_info "Processing account: $name ($email)"

    local folders_json folder_count
    folders_json=$(cfg_account_folders "$i")
    folder_count=$(echo "$folders_json" | jq 'length')

    for (( f=0; f<folder_count; f++ )); do
      local folder_id folder_name category target_drive_id target_path
      folder_id=$(echo "$folders_json" | jq -r ".[$f].id")
      folder_name=$(echo "$folders_json" | jq -r ".[$f].name")
      category=$(echo "$folders_json" | jq -r ".[$f].category")

      case "$category" in
        dokumenty) target_drive_id="$dok_id" ;;
        projekty)  target_drive_id="$proj_id" ;;
        *)         skipped=$((skipped + 1)); continue ;;
      esac

      target_path="${WORKSPACE_REMOTE},team_drive=${target_drive_id}:${name}/${folder_name}"

      log_info "  Migrating: $folder_name ($category) -> $target_path"

      local rc=0
      rclone copy "${remote_name},drive_root_folder_id=${folder_id}:" "$target_path" \
        --drive-server-side-across-configs \
        --drive-export-formats "docx,xlsx,pptx,pdf" \
        --retries 3 \
        --retries-sleep 30s \
        --timeout 300s \
        --stats-one-line \
        --stats 30s \
        --log-level INFO \
        $dry_run \
        2>&1 | while IFS= read -r line; do log_info "    rclone: $line"; done \
        || rc=$?

      if (( rc == 0 )); then
        migrated=$((migrated + 1))
        log_info "  Done: $folder_name"
      else
        log_error "  Failed: $folder_name (rclone exit $rc)"
        failed=$((failed + 1))
      fi
    done
  done

  log_info "=== Migration complete: $migrated migrated, $skipped skipped, $failed failed ==="

  if (( failed > 0 )); then
    notify_error "Migration partial failure: $migrated ok, $failed failed"
    exit 7
  fi

  notify_info "Migration complete: $migrated folders migrated"
}

# ── grota migrate --verify ────────────────────────
_verify_migration() {
  local account_filter="${1:-}"
  init_logging "verify-migration"
  require_cmd rclone jq

  local dok_name dok_id proj_name proj_id
  dok_name=$(_get_drive_name_for_category "dokumenty")
  proj_name=$(_get_drive_name_for_category "projekty")
  dok_id=$(_get_shared_drive_id "$dok_name")
  proj_id=$(_get_shared_drive_id "$proj_name")

  _count_files() {
    local remote_path="$1"
    rclone size "$remote_path" --json 2>/dev/null | jq '.count' || echo "0"
  }

  local account_count mismatches=0 verified=0
  local report_lines=()
  account_count=$(cfg_account_count)

  for (( i=0; i<account_count; i++ )); do
    local email name sanitized_email remote_name
    email=$(cfg_account_email "$i")

    if [[ -n "$account_filter" && "$account_filter" != "$email" ]]; then
      continue
    fi

    name=$(cfg_account_name "$i")
    sanitized_email=$(echo "$email" | tr '@.' '-')
    remote_name="gdrive-${sanitized_email}"

    log_info "Verifying: $name ($email)"

    local folders_json folder_count
    folders_json=$(cfg_account_folders "$i")
    folder_count=$(echo "$folders_json" | jq 'length')

    for (( f=0; f<folder_count; f++ )); do
      local folder_id folder_name category target_drive_id
      folder_id=$(echo "$folders_json" | jq -r ".[$f].id")
      folder_name=$(echo "$folders_json" | jq -r ".[$f].name")
      category=$(echo "$folders_json" | jq -r ".[$f].category")

      case "$category" in
        dokumenty) target_drive_id="$dok_id" ;;
        projekty)  target_drive_id="$proj_id" ;;
        *)         continue ;;
      esac

      local source_path target_path source_count target_count status
      source_path="${remote_name},drive_root_folder_id=${folder_id}:"
      target_path="${WORKSPACE_REMOTE},team_drive=${target_drive_id}:${name}/${folder_name}"

      source_count=$(_count_files "$source_path")
      target_count=$(_count_files "$target_path")

      if [[ "$source_count" == "$target_count" ]]; then
        status="OK"
        verified=$((verified + 1))
      else
        status="MISMATCH"
        mismatches=$((mismatches + 1))
      fi

      report_lines+=("  $status: $email / $folder_name ($category) -- source: $source_count, target: $target_count")
      log_info "  $status: $folder_name -- source: $source_count, target: $target_count"
    done
  done

  log_info "=== Verification report ==="
  log_info "Verified: $verified, mismatches: $mismatches"
  for line in "${report_lines[@]}"; do
    log_info "$line"
  done

  if (( mismatches > 0 )); then
    log_error "Migration verification FAILED: $mismatches mismatches"
    exit 1
  fi

  log_info "Migration verification PASSED"
}
