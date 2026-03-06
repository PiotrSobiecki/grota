# 104: Backup Orchestrator

## Goal

Implement `cmd_backup_all` in `lib/orchestrator.sh` -- the multi-account parallel backup orchestrator with locking, per-account error isolation, summary reporting, and notifications via data-service. Invoked via `grota backup all`.

## Prerequisites

- Doc 100 (lib foundation -- common.sh, config.sh, notify.sh)
- Doc 103 (single account backup -- lib/backup.sh)

## Scope

### IN

- `apps/cli/lib/orchestrator.sh` -- function: `cmd_backup_all`
- Parallel execution: different accounts run concurrently (configurable max parallelism)
- Per-account error isolation: one failure doesn't stop others
- Summary report: success/failure per account
- Notification on completion (via notify.sh -> data-service `POST /notify`)
- Global lock: prevent two `grota backup all` instances

### OUT

- Single account backup logic (doc 103)
- Systemd scheduling (doc 106)
- Config re-download on every run (optional feature -- uses cached config)

## Decisions

| Item | Decision |
|------|----------|
| Parallelism | `MAX_PARALLEL` env var (default 3). Uses `xargs -P` with background jobs. |
| Global lock | `mkdir`-based lock `backup-all` in addition to per-account locks. |
| Error reporting | Collect exit codes per account, summarize at end. Exit 0 only if ALL accounts succeed. |
| Config refresh | Download fresh config from R2 at start of each run. |
| Log isolation | Each account logs to separate file, orchestrator writes summary. |
| Notifications | `POST /notify` to data-service (SRP -- data-service routes to Telegram). |

## Files

### `apps/cli/lib/orchestrator.sh`

```bash
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

  acquire_lock "backup-all"

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
```

## Implementation Steps

1. **Create `apps/cli/lib/orchestrator.sh`** -- chmod +x

2. **Verify with shellcheck**
   ```bash
   shellcheck apps/cli/lib/orchestrator.sh
   ```

## Manual Test Script

```bash
# Prerequisites:
# - All doc 103 working (grota backup account)
# - Config with 2+ accounts with real OAuth tokens
# - rclone remotes configured

# 1. Test with sample config (2 accounts)
export CONFIG_PATH=apps/cli/test/sample-config.json
grota backup all
# Expect: attempts backup for both jan@gmail.com and anna@gmail.com
# With test tokens: will fail per account but orchestrator logic runs

# 2. Test with real config
grota backup all
# Expect:
#   "Grota backup-all started"
#   Per-account progress logs
#   Summary: "X ok, Y partial, Z failed"
#   Notification to data-service (if DATA_SERVICE_URL set)

# 3. Test parallelism (set MAX_PARALLEL=1 for serial)
MAX_PARALLEL=1 grota backup all
# Expect: accounts processed one at a time

# 4. Test global lock (run two instances)
grota backup all &
grota backup all
# Expect: second instance fails with "Lock already held: backup-all"

# 5. Test empty config (no accounts)
echo '{"accounts":[],"deployment_id":"test","client_name":"Empty","domain":"t.pl","created_at":"","workspace":null,"b2":null,"server":null}' > /tmp/empty-config.json
CONFIG_PATH=/tmp/empty-config.json grota backup all
# Expect: "No accounts in config, nothing to backup"

# 6. Test notification
export DATA_SERVICE_URL="https://api.grota.app"
export API_TOKEN="your-api-token"
grota backup all
# Expect: POST /notify to data-service with backup summary

# 7. Verify exit codes
grota backup all; echo "Exit: $?"
# All succeed -> 0
# Some partial -> 7
# Any hard fail -> 1
```

## Unresolved Questions

- If one account has OAuth revoked, should orchestrator trigger a web app re-auth notification (via data-service API) automatically?
