#!/usr/bin/env bash
# Migration: copy folders from private accounts to Shared Drives
# Called via: grota migrate [--dry-run] [--account EMAIL] [--verify]
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"


WORKSPACE_REMOTE="workspace_drive"

# -- Get Shared Drive ID by name --
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

# -- Get Shared Drive field from config by name --
_get_drive_field() {
  local drive_name="$1" field="$2"
  local drives_json
  drives_json=$(cfg_shared_drives)
  echo "$drives_json" | jq -r ".[] | select(.name == \"$drive_name\") | .$field // empty"
}

# -- grota migrate --
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

  # Build drive name -> ID map from config (use stored ID if available, fallback to rclone)
  declare -A drive_id_map
  local drive_name drive_id_from_config
  while IFS= read -r drive_name; do
    [[ -n "$drive_name" ]] || continue
    drive_id_from_config=$(_get_drive_field "$drive_name" "id")
    if [[ -z "$drive_id_from_config" ]]; then
      log_info "Looking up Shared Drive ID for '$drive_name' via rclone..."
      drive_id_from_config=$(_get_shared_drive_id "$drive_name")
    fi
    drive_id_map["$drive_name"]="$drive_id_from_config"
    log_info "  $drive_name: $drive_id_from_config"
  done < <(cfg_shared_drive_names)

  [[ -n "$dry_run" ]] && log_info "DRY RUN mode -- no files will be copied"

  # -- Migrate --
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
    sanitized_email=$(echo "$email" | tr '@.' '_')
    remote_name="gdrive_${sanitized_email}"

    log_info "Processing account: $name ($email)"

    local folders_json folder_count
    folders_json=$(cfg_account_folders "$i")
    folder_count=$(echo "$folders_json" | jq 'length')

    for (( f=0; f<folder_count; f++ )); do
      local folder_id folder_name shared_drive_name target_drive_id target_path
      folder_id=$(echo "$folders_json" | jq -r ".[$f].id")
      folder_name=$(echo "$folders_json" | jq -r ".[$f].name")
      shared_drive_name=$(echo "$folders_json" | jq -r ".[$f].shared_drive_name")

      # Skip folders not assigned to a shared drive
      if [[ "$shared_drive_name" == "null" || -z "$shared_drive_name" ]]; then
        skipped=$((skipped + 1))
        continue
      fi

      target_drive_id="${drive_id_map[$shared_drive_name]:-}"
      if [[ -z "$target_drive_id" ]]; then
        log_warn "  No drive ID for '$shared_drive_name', skipping $folder_name"
        skipped=$((skipped + 1))
        continue
      fi

      target_path="${WORKSPACE_REMOTE},team_drive=${target_drive_id}:${name}/${folder_name}"

      log_info "  Migrating: $folder_name ($shared_drive_name) -> $target_path"

      local rc=0
      rclone copy "${remote_name},drive_root_folder_id=${folder_id}:" "$target_path" \
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

  # Grant employees read access to Shared Drives (non-fatal)
  local deployment_id
  deployment_id=$(cfg_deployment_id)
  if [[ -n "${DATA_SERVICE_URL:-}" ]]; then
    local grant_response
    grant_response=$(curl -s -X POST \
      "${DATA_SERVICE_URL}/shared-drives/${deployment_id}/grant-access" \
      -H "Authorization: Bearer ${API_TOKEN:-}")
    log_info "Grant access response: ${grant_response}"
    if [[ $? -ne 0 ]]; then
      notify_error "Grant shared drive access failed (non-fatal)" "$deployment_id"
    fi
  fi
}

# -- grota migrate --verify --
_verify_migration() {
  local account_filter="${1:-}"
  init_logging "verify-migration"
  require_cmd rclone jq

  # Build drive name -> ID map
  declare -A drive_id_map
  local drive_name drive_id_from_config
  while IFS= read -r drive_name; do
    [[ -n "$drive_name" ]] || continue
    drive_id_from_config=$(_get_drive_field "$drive_name" "id")
    if [[ -z "$drive_id_from_config" ]]; then
      drive_id_from_config=$(_get_shared_drive_id "$drive_name")
    fi
    drive_id_map["$drive_name"]="$drive_id_from_config"
  done < <(cfg_shared_drive_names)

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
    sanitized_email=$(echo "$email" | tr '@.' '_')
    remote_name="gdrive_${sanitized_email}"

    log_info "Verifying: $name ($email)"

    local folders_json folder_count
    folders_json=$(cfg_account_folders "$i")
    folder_count=$(echo "$folders_json" | jq 'length')

    for (( f=0; f<folder_count; f++ )); do
      local folder_id folder_name shared_drive_name target_drive_id
      folder_id=$(echo "$folders_json" | jq -r ".[$f].id")
      folder_name=$(echo "$folders_json" | jq -r ".[$f].name")
      shared_drive_name=$(echo "$folders_json" | jq -r ".[$f].shared_drive_name")

      # Skip unassigned folders
      if [[ "$shared_drive_name" == "null" || -z "$shared_drive_name" ]]; then
        continue
      fi

      target_drive_id="${drive_id_map[$shared_drive_name]:-}"
      if [[ -z "$target_drive_id" ]]; then
        continue
      fi

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

      report_lines+=("  $status: $email / $folder_name ($shared_drive_name) -- source: $source_count, target: $target_count")
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
