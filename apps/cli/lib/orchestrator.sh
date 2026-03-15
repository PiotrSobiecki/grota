#!/usr/bin/env bash
# Orchestrator: backup all accounts in parallel with error isolation
# Called via: grota backup all
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# ── grota backup all ──────────────────────────────
cmd_backup_all() {
  init_logging "backup-all"
  require_cmd jq

  local max_parallel="${MAX_PARALLEL:-3}"

  log_info "=== Grota backup-all started (max parallel: $max_parallel) ==="

  local backup_root account_count client_name deployment_id
  backup_root=$(cfg_server_backup_path)
  account_count=$(cfg_account_count)
  client_name=$(cfg_client_name)
  deployment_id=$(cfg_deployment_id)

  if (( account_count == 0 )); then
    log_warn "No accounts in config, nothing to backup"
    exit 0
  fi

  log_info "Client: $client_name, accounts: $account_count"

  check_disk_space "$backup_root" 10

  acquire_lock "backup-all-${deployment_id}"

  # ── Run backups in parallel ────────────────────────
  local results_dir
  results_dir=$(mktemp -d)
  on_exit "rm -rf '$results_dir'"

  local grota_bin
  grota_bin="$(command -v grota 2>/dev/null || echo "${GROTA_ROOT:-$(dirname "${BASH_SOURCE[0]}")/..}/grota")"

  for (( i=0; i<account_count; i++ )); do
    local email
    email=$(cfg_account_email "$i")

    # Throttle: wait if at max parallel
    while (( $(jobs -rp | wc -l) >= max_parallel )); do
      wait -n 2>/dev/null || true
    done

    (
      local start_ts rc=0
      start_ts=$(date +%s)

      # Run backup via grota CLI (inherits env)
      bash "$grota_bin" backup account "$email" || rc=$?

      local end_ts duration
      end_ts=$(date +%s)
      duration=$(( end_ts - start_ts ))

      echo "${rc}|${email}|${duration}" > "${results_dir}/${i}"
    ) &
  done

  # Wait for all
  wait

  # ── Collect results ────────────────────────────────
  local succeeded=0 failed=0 oauth_revoked=0 partial=0
  local summary_lines=()

  for (( i=0; i<account_count; i++ )); do
    local result_file="${results_dir}/${i}"
    if [[ ! -f "$result_file" ]]; then
      local email
      email=$(cfg_account_email "$i")
      summary_lines+=("  UNKNOWN: $email (no result file)")
      failed=$((failed + 1))
      continue
    fi

    local rc email duration
    IFS='|' read -r rc email duration < "$result_file"

    case "$rc" in
      0)
        summary_lines+=("  OK:      $email (${duration}s)")
        succeeded=$((succeeded + 1))
        ;;
      6)
        summary_lines+=("  OAUTH:   $email -- token revoked (${duration}s)")
        oauth_revoked=$((oauth_revoked + 1))
        ;;
      7)
        summary_lines+=("  PARTIAL: $email -- some folders failed (${duration}s)")
        partial=$((partial + 1))
        ;;
      *)
        summary_lines+=("  FAIL:    $email -- exit code $rc (${duration}s)")
        failed=$((failed + 1))
        ;;
    esac
  done

  # ── Summary ───────────────────────────────────────
  log_info "=== Backup summary for $client_name ==="
  log_info "Accounts: $account_count total, $succeeded ok, $partial partial, $failed failed, $oauth_revoked oauth-revoked"
  for line in "${summary_lines[@]}"; do
    log_info "$line"
  done

  # ── Notifications (via data-service POST /notify) ──
  local total_errors=$(( failed + oauth_revoked ))

  if (( total_errors == 0 && partial == 0 )); then
    notify_info "Backup ALL OK: $client_name ($succeeded/$account_count accounts)" "$deployment_id"
  elif (( total_errors == 0 )); then
    notify_warn "Backup partial: $client_name ($succeeded ok, $partial partial)" "$deployment_id"
  else
    local detail="$succeeded ok, $partial partial, $failed failed, $oauth_revoked oauth-revoked"
    notify_error "Backup FAILED: $client_name ($detail)" "$deployment_id"
  fi

  # ── Exit code ─────────────────────────────────────
  if (( total_errors > 0 )); then
    exit 1
  elif (( partial > 0 )); then
    exit 7
  fi

  log_info "=== Grota backup-all completed ==="
}
