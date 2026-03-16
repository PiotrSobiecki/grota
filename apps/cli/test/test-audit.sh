#!/usr/bin/env bash
# Unit tests for audit.sh
# Run: bash apps/cli/test/test-audit.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# -- Minimal test framework --
_tests_run=0 _tests_passed=0 _tests_failed=0
_current_test=""

assert_eq() {
  local expected="$1" actual="$2" msg="${3:-}"
  if [[ "$expected" == "$actual" ]]; then
    return 0
  fi
  echo "  FAIL: ${msg:-assert_eq}"
  echo "    expected: '$expected'"
  echo "    actual:   '$actual'"
  return 1
}

assert_contains() {
  local haystack="$1" needle="$2" msg="${3:-}"
  if [[ "$haystack" == *"$needle"* ]]; then
    return 0
  fi
  echo "  FAIL: ${msg:-assert_contains}"
  echo "    missing: '$needle'"
  echo "    in:      '$haystack'"
  return 1
}

assert_not_contains() {
  local haystack="$1" needle="$2" msg="${3:-}"
  if [[ "$haystack" != *"$needle"* ]]; then
    return 0
  fi
  echo "  FAIL: ${msg:-assert_not_contains}"
  echo "    unexpected: '$needle'"
  echo "    in:         '$haystack'"
  return 1
}

run_test() {
  local name="$1"
  _current_test="$name"
  _tests_run=$((_tests_run + 1))
  echo "TEST: $name"
  if "$name"; then
    _tests_passed=$((_tests_passed + 1))
    echo "  PASS"
  else
    _tests_failed=$((_tests_failed + 1))
  fi
}

print_summary() {
  echo ""
  echo "=== Results: $_tests_passed/$_tests_run passed, $_tests_failed failed ==="
  (( _tests_failed == 0 ))
}

# -- Test environment setup --
export LOG_DIR="/tmp/grota-test-logs-$$"
export LOCK_DIR="/tmp/grota-test-locks-$$"
export CONFIG_PATH="$SCRIPT_DIR/sample-config.json"
export RCLONE_CONFIG="/tmp/grota-test-rclone-$$.conf"
export REPORT_DIR="/tmp/grota-test-reports-$$"
mkdir -p "$LOG_DIR" "$LOCK_DIR" "$REPORT_DIR"

_rclone_calls_file="/tmp/grota-test-rclone-calls-$$"
: > "$_rclone_calls_file"

cleanup() {
  rm -rf "$LOG_DIR" "$LOCK_DIR" "$RCLONE_CONFIG" "$_rclone_calls_file" "$REPORT_DIR"
}
trap cleanup EXIT

# Source lib modules
source "$CLI_DIR/lib/common.sh"
source "$CLI_DIR/lib/config.sh"
load_config
source "$CLI_DIR/lib/audit.sh"

# -- Mock external commands --
_rclone_mock_mode=""

rclone() {
  echo "rclone $*" >> "$_rclone_calls_file"
  case "$_rclone_mock_mode" in
    permissions_with_drives)
      if [[ "$1" == "backend" && "$2" == "drives" ]]; then
        echo '[{"name":"TestFirma-Dokumenty","id":"drive-dok-123"},{"name":"TestFirma-Projekty","id":"drive-proj-456"}]'
        return 0
      fi
      if [[ "$1" == "backend" && "$2" == "get" ]]; then
        echo ""
        return 1
      fi
      if [[ "$1" == "size" ]]; then
        echo '{"count":42,"bytes":10485760}'
        return 0
      fi
      ;;
    permissions_no_drives)
      if [[ "$1" == "backend" && "$2" == "drives" ]]; then
        echo '[]'
        return 0
      fi
      ;;
    storage_b2)
      if [[ "$1" == "listremotes" ]]; then
        echo "b2_testfirma-dokumenty:"
        echo "b2_testfirma-projekty:"
        echo "b2_testfirma-media:"
        return 0
      fi
      if [[ "$1" == "size" ]]; then
        echo '{"count":100,"bytes":52428800}'
        return 0
      fi
      ;;
    storage_b2_no_remotes)
      if [[ "$1" == "listremotes" ]]; then
        echo "workspace_drive:"
        return 0
      fi
      ;;
    check_ok)
      if [[ "$1" == "listremotes" ]]; then
        echo "b2_testfirma-dokumenty:"
        echo "b2_testfirma-projekty:"
        echo "b2_testfirma-media:"
        return 0
      fi
      if [[ "$1" == "check" ]]; then
        return 0
      fi
      ;;
    check_fail)
      if [[ "$1" == "listremotes" ]]; then
        echo "b2_testfirma-dokumenty:"
        echo "b2_testfirma-projekty:"
        echo "b2_testfirma-media:"
        return 0
      fi
      if [[ "$1" == "check" ]]; then
        echo "ERROR : file1.txt: sizes differ" >&2
        echo "ERROR : file2.txt: not found" >&2
        return 1
      fi
      ;;
  esac
  return 0
}

# Mock notify functions
notify_error() { _notify_calls+=("error: $*"); }
notify_info()  { _notify_calls+=("info: $*"); }
_notify_calls=()

# Mock numfmt (may not exist on macOS)
numfmt() {
  if [[ "${1:-}" == "--to=iec" ]]; then
    echo "${2:-0}B"
  fi
}

# Mock du/df for storage tests
_mock_du_mode=""

# -- Tests --

test_init_report_creates_file_when_report_dir_set() {
  _out_file=""
  _init_report "test-report"
  # _out_file should be set
  assert_contains "$_out_file" "test-report" "should contain report name"
  assert_contains "$_out_file" "$REPORT_DIR" "should be in REPORT_DIR"
}

test_init_report_no_file_when_report_dir_empty() {
  local saved="$REPORT_DIR"
  REPORT_DIR=""
  _out_file=""
  _init_report "test-report"
  assert_eq "" "$_out_file" "should be empty when REPORT_DIR unset"
  REPORT_DIR="$saved"
}

test_out_writes_to_stdout() {
  _out_file=""
  local output
  output=$(_out "hello world")
  assert_eq "hello world" "$output" "should echo to stdout"
}

test_out_writes_to_file_when_set() {
  local tmpfile="/tmp/grota-test-out-$$"
  _out_file="$tmpfile"
  _out "test line" >/dev/null
  local content
  content=$(cat "$tmpfile")
  assert_eq "test line" "$content" "should write to file"
  rm -f "$tmpfile"
  _out_file=""
}

test_permissions_no_drives() {
  _rclone_mock_mode="permissions_no_drives"
  : > "$_rclone_calls_file"
  local output rc=0
  output=$(cmd_audit_permissions 2>/dev/null) || rc=$?
  assert_contains "$output" "No Shared Drives found" "should report no drives"
}

test_permissions_with_drives() {
  _rclone_mock_mode="permissions_with_drives"
  : > "$_rclone_calls_file"
  local output rc=0
  output=$(cmd_audit_permissions 2>/dev/null) || rc=$?
  assert_contains "$output" "TestFirma-Dokumenty" "should list drive name"
  assert_contains "$output" "drive-dok-123" "should list drive ID"
  assert_contains "$output" "Permission Audit" "should have header"
  assert_contains "$output" "Audit complete" "should have footer"
}

test_permissions_report_file_created() {
  _rclone_mock_mode="permissions_with_drives"
  : > "$_rclone_calls_file"
  local before_count after_count
  before_count=$(ls "$REPORT_DIR"/permission-audit-* 2>/dev/null | wc -l || echo 0)
  (cmd_audit_permissions) >/dev/null 2>/dev/null || true
  after_count=$(ls "$REPORT_DIR"/permission-audit-* 2>/dev/null | wc -l || echo 0)
  local diff=$((after_count - before_count))
  assert_eq "1" "$diff" "should create report file"
}

test_storage_no_local_dir() {
  _rclone_mock_mode="storage_b2_no_remotes"
  : > "$_rclone_calls_file"
  local output
  output=$(cmd_audit_storage 2>/dev/null) || true
  # backup_root from config = /srv/backup/gdrive, won't exist in test
  assert_contains "$output" "Directory not found" "should report missing dir"
}

test_storage_b2_no_remotes() {
  _rclone_mock_mode="storage_b2_no_remotes"
  : > "$_rclone_calls_file"
  local output
  output=$(cmd_audit_storage 2>/dev/null) || true
  assert_contains "$output" "(remote not configured)" "should note unconfigured remotes"
}

test_storage_b2_with_remotes() {
  _rclone_mock_mode="storage_b2"
  : > "$_rclone_calls_file"
  local output
  output=$(cmd_audit_storage 2>/dev/null) || true
  assert_contains "$output" "testfirma-" "should list drive bucket"
  assert_contains "$output" "100 files" "should show file count"
}

test_backup_no_local_data_skips() {
  _rclone_mock_mode="check_ok"
  : > "$_rclone_calls_file"
  _notify_calls=()
  local output rc=0
  # No local dirs exist -> all skipped -> 0 verified, 0 mismatched
  output=$(cmd_audit_backup 2>/dev/null) || rc=$?
  assert_eq "0" "$rc" "should pass with no data to check"
  assert_contains "$output" "0 ok, 0 mismatched" "should report zero checks"
}

test_backup_header_footer() {
  _rclone_mock_mode="check_ok"
  : > "$_rclone_calls_file"
  _notify_calls=()
  local output
  output=$(cmd_audit_backup 2>/dev/null) || true
  assert_contains "$output" "Backup Verification" "should have header"
  assert_contains "$output" "Verification:" "should have summary line"
}

# -- Run all tests --
run_test test_init_report_creates_file_when_report_dir_set
run_test test_init_report_no_file_when_report_dir_empty
run_test test_out_writes_to_stdout
run_test test_out_writes_to_file_when_set
run_test test_permissions_no_drives
run_test test_permissions_with_drives
run_test test_permissions_report_file_created
run_test test_storage_no_local_dir
run_test test_storage_b2_no_remotes
run_test test_storage_b2_with_remotes
run_test test_backup_no_local_data_skips
run_test test_backup_header_footer

print_summary
