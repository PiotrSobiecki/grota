#!/usr/bin/env bash
# Notification: POST to data-service /notify endpoint -> Telegram
# SRP: notification logic (formatting, routing, Telegram) lives in data-service
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

notify() {
  local level="$1"   # info, warn, error
  local message="$2"
  local deployment_id="${3:-${DEPLOYMENT_ID:-unknown}}"

  # Always log locally
  case "$level" in
    info)  log_info  "[NOTIFY] $message" ;;
    warn)  log_warn  "[NOTIFY] $message" ;;
    error) log_error "[NOTIFY] $message" ;;
  esac

  # Skip remote if no URL configured
  if [[ -z "${DATA_SERVICE_URL:-}" ]]; then
    log_warn "DATA_SERVICE_URL not set, skipping remote notification"
    return 0
  fi

  local payload
  payload=$(jq -n \
    --arg level "$level" \
    --arg message "$message" \
    --arg deployment_id "$deployment_id" \
    --arg hostname "$(hostname)" \
    --arg timestamp "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    '{level: $level, message: $message, deployment_id: $deployment_id, hostname: $hostname, timestamp: $timestamp}')

  # Non-blocking: fire and forget, log failures
  curl -s -X POST "${DATA_SERVICE_URL}/notify" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${API_TOKEN:-}" \
    -d "$payload" \
    --max-time 10 \
    >/dev/null 2>&1 \
    || log_warn "Failed to send remote notification"
}

notify_info()  { notify "info"  "$@"; }
notify_warn()  { notify "warn"  "$@"; }
notify_error() { notify "error" "$@"; }

notify_backup_start() {
  local account="$1"
  notify_info "Backup started: $account" "${DEPLOYMENT_ID:-}"
}

notify_backup_done() {
  local account="$1"
  notify_info "Backup completed: $account" "${DEPLOYMENT_ID:-}"
}

notify_backup_failed() {
  local account="$1"
  local reason="${2:-unknown error}"
  notify_error "Backup FAILED: $account -- $reason" "${DEPLOYMENT_ID:-}"
}
