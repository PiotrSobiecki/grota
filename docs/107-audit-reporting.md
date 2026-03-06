# 107: Audit & Reporting

## Goal

Create 3 audit functions in `lib/audit.sh`: permission audit for Shared Drives, storage usage report across all accounts/buckets, and backup integrity verification using `rclone check` -- providing ongoing operational visibility. Invoked via `grota audit storage|permissions|backup`.

## Prerequisites

- Doc 100 (lib foundation)
- Doc 102 (rclone setup -- all remotes configured)
- Doc 103 (backup data exists locally + B2)
- Doc 105 (Shared Drives exist for permission audit)

## Scope

### IN

- `apps/cli/lib/audit.sh` -- functions: `cmd_audit_permissions`, `cmd_audit_storage`, `cmd_audit_backup`
- `cmd_audit_permissions` -- list permissions on all Shared Drives
- `cmd_audit_storage` -- disk usage per account (local), per bucket (B2), summary
- `cmd_audit_backup` -- `rclone check` local vs B2 per account/category
- Reports output to stdout and optional file (for scheduled runs)
- Notification on verification failures (via data-service `POST /notify`)

### OUT

- Automated remediation (manual action required)
- Web dashboard display (Phase 3)
- Historical trend tracking (future)

## Decisions

| Item | Decision |
|------|----------|
| Report format | Plain text, human-readable. Parseable by grep for alerting. |
| Verify method | `rclone check` compares file sizes + hashes (B2 stores SHA1). |
| Permission audit | Uses `rclone backend` to list Shared Drive permissions via Google Drive API. |
| Output | stdout + optional `REPORT_DIR` for file output. |
| Notifications | `POST /notify` to data-service (SRP -- data-service routes to Telegram). |

## Files

### `apps/cli/lib/audit.sh`

```bash
#!/usr/bin/env bash
# Audit functions: permissions, storage, backup verify
# Called via: grota audit storage|permissions|backup
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/rclone/rclone.conf}"
export RCLONE_CONFIG

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
  [[ -n "$_out_file" ]] && echo "$@" >> "$_out_file"
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
```

## Implementation Steps

1. **Create `apps/cli/lib/audit.sh`** -- chmod +x

2. **Verify with shellcheck**
   ```bash
   shellcheck apps/cli/lib/audit.sh
   ```

## Manual Test Script

```bash
# Prerequisites:
# - Backups exist locally + B2 (grota backup account ran successfully)
# - Shared Drives exist (for permission audit)
# - rclone remotes configured

# ── Permission Audit ──────────────────────────────
# 1. Run permission audit
grota audit permissions
# Expect: lists all Shared Drives with file counts

# 2. Run with report file
REPORT_DIR=/tmp/grota-reports grota audit permissions
# Expect: same output + file saved in /tmp/grota-reports/

# ── Storage Report ────────────────────────────────
# 3. Run storage report
grota audit storage
# Expect:
#   Local storage per account per category
#   B2 storage per bucket
#   Disk usage summary

# 4. Verify local numbers
du -sh /srv/backup/gdrive/*/
# Expect: matches report

# ── Backup Verify ─────────────────────────────────
# 5. Run backup verification
grota audit backup
# Expect: "Verification: X ok, 0 mismatched, 0 errors"

# 6. Introduce a mismatch (create extra local file)
touch /srv/backup/gdrive/jan-gmail-com/dokumenty/test-extra-file.txt
grota audit backup
# Expect: MISMATCH for dokumenty category
# Expect: notification to data-service about failure

# 7. Clean up test file
rm /srv/backup/gdrive/jan-gmail-com/dokumenty/test-extra-file.txt

# 8. Test with report output
REPORT_DIR=/tmp/grota-reports grota audit backup
cat /tmp/grota-reports/backup-verify-*.txt
# Expect: report file with verification results

# 9. Test notification
export DATA_SERVICE_URL="https://api.grota.app"
export API_TOKEN="your-token"
grota audit backup
# Expect: POST /notify to data-service "Backup verification PASSED"
```

## Unresolved Questions

- `rclone check --one-way --size-only`: size-only is fast but doesn't verify content. Use `--checksum` (slower, requires B2 SHA1 computation) for weekly check?
- Permission audit: rclone `backend` commands for Drive permissions are limited. May need direct Google Admin SDK API call via curl for full permission listing. Good enough for MVP?
- Storage report: B2 `rclone size` can be slow for large buckets. Cache results? Accept delay for weekly report?
