#!/usr/bin/env bash
# Audit functions: permissions, storage, backup verify
# Called via: grota audit storage|permissions|backup
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"


REPORT_DIR="${REPORT_DIR:-}"

_out_file=""
_init_report() {
  local name="$1"
  if [[ -n "$REPORT_DIR" ]]; then
    mkdir -p "$REPORT_DIR"
    _out_file="${REPORT_DIR}/${name}-$(date '+%Y%m%d-%H%M%S').txt"
  fi
}

_out() {
  echo "$@"
  [[ -n "$_out_file" ]] && echo "$@" >> "$_out_file" || true
}

# ── grota audit permissions ────────────────────────
cmd_audit_permissions() {
  init_logging "audit-permissions"
  require_cmd rclone jq
  _init_report "permission-audit"

  local workspace_remote="workspace-drive"

  _out "========================================="
  _out "Grota Permission Audit - $(date '+%Y-%m-%d %H:%M')"
  _out "Client: $(cfg_client_name)"
  _out "========================================="
  _out ""

  local drives_json drive_count
  drives_json=$(rclone backend drives "${workspace_remote}:" 2>/dev/null || echo "[]")
  drive_count=$(echo "$drives_json" | jq 'length')

  if (( drive_count == 0 )); then
    _out "No Shared Drives found"
    exit 0
  fi

  for (( d=0; d<drive_count; d++ )); do
    local drive_name drive_id
    drive_name=$(echo "$drives_json" | jq -r ".[$d].name")
    drive_id=$(echo "$drives_json" | jq -r ".[$d].id")

    _out "--- Shared Drive: $drive_name ---"
    _out "  ID: $drive_id"

    local perms
    perms=$(rclone backend get "${workspace_remote},team_drive=${drive_id}:" \
      --drive-team-drive-id "$drive_id" \
      -- permissions 2>/dev/null || echo "")

    if [[ -n "$perms" && "$perms" != "null" ]]; then
      echo "$perms" | jq -r '.[] | "  \(.role): \(.emailAddress // .displayName // "unknown")"' 2>/dev/null \
        || _out "  (could not parse permissions)"
    else
      local file_count total_size
      file_count=$(rclone size "${workspace_remote},team_drive=${drive_id}:" --json 2>/dev/null \
        | jq '.count' || echo "?")
      total_size=$(rclone size "${workspace_remote},team_drive=${drive_id}:" --json 2>/dev/null \
        | jq -r '.bytes | . / 1048576 | floor | tostring + " MB"' || echo "?")
      _out "  Files: $file_count, Size: $total_size"
      _out "  (Permissions API not available via rclone -- check Google Admin Console)"
    fi
    _out ""
  done

  _out "========================================="
  _out "Audit complete"
  _out "========================================="

  if [[ -n "$_out_file" ]]; then
    log_info "Report saved to $_out_file"
  fi
}

# ── grota audit storage ───────────────────────────
cmd_audit_storage() {
  init_logging "audit-storage"
  require_cmd rclone jq du
  _init_report "storage-report"

  local backup_root bucket_prefix
  backup_root=$(cfg_server_backup_path)
  bucket_prefix=$(cfg_b2_prefix)

  _out "========================================="
  _out "Grota Storage Report - $(date '+%Y-%m-%d %H:%M')"
  _out "Client: $(cfg_client_name)"
  _out "========================================="
  _out ""

  # ── Local storage ─────────────────────────────────
  _out "--- Local Storage ($backup_root) ---"

  if [[ -d "$backup_root" ]]; then
    local disk_total disk_used disk_avail disk_pct
    disk_total=$(df -h "$backup_root" | awk 'NR==2 {print $2}')
    disk_used=$(df -h "$backup_root" | awk 'NR==2 {print $3}')
    disk_avail=$(df -h "$backup_root" | awk 'NR==2 {print $4}')
    disk_pct=$(df "$backup_root" | awk 'NR==2 {print $5}')
    _out "  Disk: ${disk_used} used / ${disk_total} total (${disk_pct} full, ${disk_avail} available)"
    _out ""

    local account_count total_local=0
    account_count=$(cfg_account_count)

    for (( i=0; i<account_count; i++ )); do
      local email sanitized_email account_dir
      email=$(cfg_account_email "$i")
      sanitized_email=$(echo "$email" | tr '@.' '-')
      account_dir="${backup_root}/${sanitized_email}"

      if [[ -d "$account_dir" ]]; then
        local size_bytes size_human
        size_bytes=$(du -sb "$account_dir" 2>/dev/null | awk '{print $1}')
        size_human=$(du -sh "$account_dir" 2>/dev/null | awk '{print $1}')
        total_local=$((total_local + size_bytes))

        for category in dokumenty projekty media; do
          local cat_dir="${account_dir}/${category}"
          if [[ -d "$cat_dir" ]]; then
            local cat_size
            cat_size=$(du -sh "$cat_dir" 2>/dev/null | awk '{print $1}')
            _out "  $email / $category: $cat_size"
          fi
        done
        _out "  $email TOTAL: $size_human"
      else
        _out "  $email: (no local data)"
      fi
    done

    local versions_dir="${backup_root}/.versions"
    if [[ -d "$versions_dir" ]]; then
      local versions_size
      versions_size=$(du -sh "$versions_dir" 2>/dev/null | awk '{print $1}')
      _out "  .versions: $versions_size"
    fi

    local total_human
    total_human=$(numfmt --to=iec "$total_local" 2>/dev/null || echo "${total_local} bytes")
    _out "  LOCAL TOTAL: $total_human"
  else
    _out "  Directory not found: $backup_root"
  fi

  _out ""

  # ── B2 storage ────────────────────────────────────
  _out "--- B2 Storage ---"

  for category in dokumenty projekty media; do
    local remote_name="b2-${category}"
    local bucket_name="${bucket_prefix}-${category}"

    if ! rclone listremotes | grep -q "^${remote_name}:$"; then
      _out "  $bucket_name: (remote not configured)"
      continue
    fi

    local size_json count bytes human
    size_json=$(rclone size "${remote_name}:${bucket_name}" --json 2>/dev/null || echo '{"count":0,"bytes":0}')
    count=$(echo "$size_json" | jq '.count')
    bytes=$(echo "$size_json" | jq '.bytes')
    human=$(echo "$bytes" | numfmt --to=iec 2>/dev/null || echo "${bytes} bytes")

    _out "  $bucket_name: $count files, $human"
  done

  _out ""
  _out "========================================="
  _out "Report complete"
  _out "========================================="

  if [[ -n "$_out_file" ]]; then
    log_info "Report saved to $_out_file"
  fi
}

# ── grota audit backup ────────────────────────────
cmd_audit_backup() {
  init_logging "audit-backup"
  require_cmd rclone jq
  _init_report "backup-verify"

  local backup_root bucket_prefix account_count
  backup_root=$(cfg_server_backup_path)
  bucket_prefix=$(cfg_b2_prefix)
  account_count=$(cfg_account_count)

  _out "========================================="
  _out "Grota Backup Verification - $(date '+%Y-%m-%d %H:%M')"
  _out "Client: $(cfg_client_name)"
  _out "========================================="
  _out ""

  local verified=0 mismatches=0 errors=0

  for (( i=0; i<account_count; i++ )); do
    local email sanitized_email
    email=$(cfg_account_email "$i")
    sanitized_email=$(echo "$email" | tr '@.' '-')

    _out "--- $email ---"

    for category in dokumenty projekty media; do
      local local_dir="${backup_root}/${sanitized_email}/${category}"
      local remote_name="b2-${category}"
      local bucket_name="${bucket_prefix}-${category}"
      local b2_path="${remote_name}:${bucket_name}/${sanitized_email}"

      if [[ ! -d "$local_dir" ]]; then
        continue
      fi

      if ! rclone listremotes | grep -q "^${remote_name}:$"; then
        _out "  $category: SKIP (B2 remote not configured)"
        continue
      fi

      _out "  $category: checking $local_dir vs $b2_path"

      local check_output rc=0
      check_output=$(mktemp)
      on_exit "rm -f '$check_output'"

      rclone check "$local_dir" "$b2_path" \
        --one-way \
        --size-only \
        2>"$check_output" \
        || rc=$?

      if (( rc == 0 )); then
        _out "  $category: OK"
        verified=$((verified + 1))
      else
        local diff_count
        diff_count=$(grep -c "ERROR" "$check_output" 2>/dev/null || echo "?")
        _out "  $category: MISMATCH ($diff_count differences)"
        grep "ERROR" "$check_output" 2>/dev/null | head -5 | while IFS= read -r line; do
          _out "    $line"
        done
        mismatches=$((mismatches + 1))
      fi

      rm -f "$check_output"
    done
    _out ""
  done

  _out "========================================="
  _out "Verification: $verified ok, $mismatches mismatched, $errors errors"
  _out "========================================="

  if [[ -n "$_out_file" ]]; then
    log_info "Report saved to $_out_file"
  fi

  # ── Notifications (via data-service POST /notify) ──
  if (( mismatches > 0 || errors > 0 )); then
    notify_error "Backup verification FAILED: $mismatches mismatches, $errors errors" \
      "$(cfg_deployment_id)"
    exit 1
  fi

  notify_info "Backup verification PASSED ($verified checks)" "$(cfg_deployment_id)"
  log_info "Backup verification complete: all checks passed"
}
