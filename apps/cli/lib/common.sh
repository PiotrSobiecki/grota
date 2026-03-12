#!/usr/bin/env bash
# Common utilities: logging, locking, disk checks, traps
set -euo pipefail

# ── Paths ──────────────────────────────────────────
# shellcheck disable=SC2034 # used by sourcing scripts
GROTA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-/var/log/grota}"
LOCK_DIR="${LOCK_DIR:-/var/lock/grota}"
LOG_FILE=""

# ── Logging ────────────────────────────────────────
_ts() { date '+%Y-%m-%d %H:%M:%S'; }

log_info()  { echo "[$(_ts)] [INFO]  $*" >&2; [[ -n "$LOG_FILE" ]] && echo "[$(_ts)] [INFO]  $*" >> "$LOG_FILE" || true; }
log_warn()  { echo "[$(_ts)] [WARN]  $*" >&2; [[ -n "$LOG_FILE" ]] && echo "[$(_ts)] [WARN]  $*" >> "$LOG_FILE" || true; }
log_error() { echo "[$(_ts)] [ERROR] $*" >&2; [[ -n "$LOG_FILE" ]] && echo "[$(_ts)] [ERROR] $*" >> "$LOG_FILE" || true; }
log_fatal() { log_error "$@"; exit 1; }

init_logging() {
  local name="${1:-grota}"
  mkdir -p "$LOG_DIR"
  LOG_FILE="${LOG_DIR}/${name}-$(date '+%Y%m%d').log"
  log_info "=== $name started ==="
}

# ── Locking (mkdir-based, atomic) ──────────────────
_lock_path=""

acquire_lock() {
  local key="$1"
  _lock_path="${LOCK_DIR}/${key}"
  mkdir -p "$LOCK_DIR"

  if ! mkdir "$_lock_path" 2>/dev/null; then
    log_fatal "Lock already held: $_lock_path (another instance running?)"
  fi

  # Store PID for debugging
  echo $$ > "${_lock_path}/pid"
  log_info "Lock acquired: $_lock_path"
}

release_lock() {
  if [[ -n "$_lock_path" && -d "$_lock_path" ]]; then
    rm -rf "$_lock_path"
    log_info "Lock released: $_lock_path"
    _lock_path=""
  fi
}

# ── Disk check ─────────────────────────────────────
check_disk_space() {
  local path="$1"
  local min_pct="${2:-10}"
  local avail_pct

  avail_pct=$(df "$path" | awk 'NR==2 {gsub(/%/,"",$5); print 100 - $5}')
  if (( avail_pct < min_pct )); then
    log_fatal "Disk space critical: ${avail_pct}% free on $path (minimum: ${min_pct}%)"
  fi
  log_info "Disk OK: ${avail_pct}% free on $path"
}

# ── Trap handler ───────────────────────────────────
_cleanup_handlers=()

on_exit() {
  _cleanup_handlers+=("$1")
}

_run_cleanup() {
  local exit_code=$?
  # Release lock if held
  release_lock
  # Run registered handlers
  for handler in "${_cleanup_handlers[@]+"${_cleanup_handlers[@]}"}"; do
    eval "$handler" || true
  done
  if (( exit_code != 0 )); then
    log_error "Exited with code $exit_code"
  fi
}

trap _run_cleanup EXIT

# ── Helpers ────────────────────────────────────────
require_cmd() {
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || log_fatal "Required command not found: $cmd"
  done
}

require_env() {
  for var in "$@"; do
    [[ -n "${!var:-}" ]] || log_fatal "Required env var not set: $var"
  done
}

load_env() {
  local env_file="${1:-/etc/grota/grota.env}"
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file"
    log_info "Loaded env from $env_file"
  else
    log_warn "Env file not found: $env_file"
  fi
}
