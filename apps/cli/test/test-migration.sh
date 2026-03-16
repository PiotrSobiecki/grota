#!/usr/bin/env bash
# Unit tests for migration.sh
# Run: bash apps/cli/test/test-migration.sh
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
mkdir -p "$LOG_DIR" "$LOCK_DIR"

cleanup() {
  rm -rf "$LOG_DIR" "$LOCK_DIR" "$RCLONE_CONFIG" "$_rclone_calls_file"
}
trap cleanup EXIT

# Source lib modules (common -> config -> migration)
source "$CLI_DIR/lib/common.sh"
source "$CLI_DIR/lib/config.sh"
load_config
source "$CLI_DIR/lib/migration.sh"

# -- Mock external commands --
# Override rclone with a function stub
_rclone_mock_mode=""
_rclone_calls_file="/tmp/grota-test-rclone-calls-$$"
: > "$_rclone_calls_file"

rclone() {
  echo "rclone $*" >> "$_rclone_calls_file"
  case "$_rclone_mock_mode" in
    drives_found)
      # mock: rclone backend drives workspace_drive:
      if [[ "$1" == "backend" && "$2" == "drives" ]]; then
        echo '[{"name":"TestFirma-Dokumenty","id":"drive-dok-123"},{"name":"TestFirma-Projekty","id":"drive-proj-456"},{"name":"TestFirma-Media","id":"drive-media-789"}]'
        return 0
      fi
      ;;
    drives_not_found)
      if [[ "$1" == "backend" && "$2" == "drives" ]]; then
        echo '[]'
        return 0
      fi
      ;;
    listremotes_ok)
      if [[ "$1" == "listremotes" ]]; then
        echo "workspace_drive:"
        echo "gdrive_jan_gmail_com:"
        echo "gdrive_anna_gmail_com:"
        return 0
      fi
      ;;
    copy_ok)
      if [[ "$1" == "copy" ]]; then
        echo "Transferred: 5 files"
        return 0
      fi
      ;;
    copy_fail)
      if [[ "$1" == "copy" ]]; then
        return 1
      fi
      ;;
    size_match)
      if [[ "$1" == "size" ]]; then
        echo '{"count":42,"bytes":1024}'
        return 0
      fi
      ;;
    size_mismatch)
      if [[ "$1" == "size" ]]; then
        # Alternate: source=42, target=40
        if [[ "$2" == *"drive_root_folder_id"* ]]; then
          echo '{"count":42,"bytes":1024}'
        else
          echo '{"count":40,"bytes":900}'
        fi
        return 0
      fi
      ;;
  esac

  # Default for unmatched calls
  case "$1" in
    listremotes) echo "workspace_drive:"; return 0 ;;
    backend)
      if [[ "$2" == "drives" ]]; then
        echo '[{"name":"TestFirma-Dokumenty","id":"drive-dok-123"},{"name":"TestFirma-Projekty","id":"drive-proj-456"},{"name":"TestFirma-Media","id":"drive-media-789"}]'
        return 0
      fi
      ;;
    copy) return 0 ;;
    size) echo '{"count":10,"bytes":500}'; return 0 ;;
  esac
  return 0
}

# Mock notify functions (already sourced but override)
notify_error() { _notify_calls+=("error: $*"); }
notify_info()  { _notify_calls+=("info: $*"); }
_notify_calls=()

# -- Tests --

test_get_shared_drive_id_found() {
  _rclone_mock_mode="drives_found"
  local result
  result=$(_get_shared_drive_id "TestFirma-Dokumenty")
  assert_eq "drive-dok-123" "$result" "should return drive ID"
}

test_get_shared_drive_id_not_found() {
  _rclone_mock_mode="drives_not_found"
  local output rc=0
  output=$(_get_shared_drive_id "NonExistent" 2>&1) || rc=$?
  assert_eq "1" "$rc" "should exit with error"
  assert_contains "$output" "Shared Drive not found" "should log fatal"
}

test_get_drive_field_dokumenty() {
  local result
  result=$(_get_drive_field "TestFirma-Dokumenty" "name")
  assert_eq "TestFirma-Dokumenty" "$result" "should return drive name"
}

test_get_drive_field_unknown() {
  local result
  result=$(_get_drive_field "NonExistent" "name")
  assert_eq "" "$result" "unknown drive -> empty"
}

test_cmd_migrate_dry_run_flag() {
  _rclone_mock_mode=""
  : > "$_rclone_calls_file"
  _notify_calls=()
  local output
  output=$(cmd_migrate --dry-run 2>&1) || true
  assert_contains "$output" "DRY RUN" "should log dry run mode"
  # Check rclone copy was called with --dry-run via file log
  local calls
  calls=$(cat "$_rclone_calls_file")
  assert_contains "$calls" "copy" "rclone copy should be called"
  assert_contains "$calls" "--dry-run" "rclone copy should receive --dry-run"
}

test_cmd_migrate_account_filter() {
  _rclone_mock_mode=""
  : > "$_rclone_calls_file"
  _notify_calls=()
  local output
  output=$(cmd_migrate --account anna@gmail.com 2>&1) || true
  # Should only process anna, not jan
  assert_not_contains "$output" "Processing account: Jan" "should skip jan"
  assert_contains "$output" "Processing account: Anna" "should process anna"
}

test_cmd_migrate_skips_null_drive() {
  _rclone_mock_mode=""
  : > "$_rclone_calls_file"
  _notify_calls=()
  local output
  output=$(cmd_migrate --account anna@gmail.com 2>&1) || true
  # anna has: Dokumenty projektowe (TestFirma-Projekty), Zdjecia (TestFirma-Media), Prywatne (null)
  # null should be skipped -> 1 skipped
  assert_contains "$output" "1 skipped" "should skip null drive folder"
  assert_not_contains "$output" "Migrating: Prywatne" "should not migrate null drive folder"
}

test_cmd_migrate_verify_flag() {
  _rclone_mock_mode="size_match"
  _notify_calls=()
  local output rc=0
  output=$(cmd_migrate --verify 2>&1) || rc=$?
  assert_eq "0" "$rc" "verify should pass when counts match"
  assert_contains "$output" "Migration verification PASSED" "should report passed"
}

test_cmd_migrate_unknown_arg() {
  local output rc=0
  output=$(cmd_migrate --bogus 2>&1) || rc=$?
  assert_eq "1" "$rc" "should fail on unknown arg"
  assert_contains "$output" "Unknown arg" "should log unknown arg"
}

test_verify_migration_counts_match() {
  _rclone_mock_mode="size_match"
  local output rc=0
  output=$(_verify_migration "" 2>&1) || rc=$?
  assert_eq "0" "$rc" "should exit 0 on match"
  assert_contains "$output" "PASSED" "should report passed"
}

test_verify_migration_counts_mismatch() {
  _rclone_mock_mode="size_mismatch"
  local output rc=0
  output=$(_verify_migration "" 2>&1) || rc=$?
  assert_eq "1" "$rc" "should exit 1 on mismatch"
  assert_contains "$output" "MISMATCH" "should report mismatch"
  assert_contains "$output" "FAILED" "should report failed"
}

test_verify_migration_account_filter() {
  _rclone_mock_mode="size_match"
  local output rc=0
  output=$(_verify_migration "jan@gmail.com" 2>&1) || rc=$?
  assert_contains "$output" "Verifying: Jan" "should verify jan"
  assert_not_contains "$output" "Verifying: Anna" "should skip anna"
}

# -- Run all tests --
run_test test_get_shared_drive_id_found
run_test test_get_shared_drive_id_not_found
run_test test_get_drive_field_dokumenty
run_test test_get_drive_field_unknown
run_test test_cmd_migrate_dry_run_flag
run_test test_cmd_migrate_account_filter
run_test test_cmd_migrate_skips_null_drive
run_test test_cmd_migrate_verify_flag
run_test test_cmd_migrate_unknown_arg
run_test test_verify_migration_counts_match
run_test test_verify_migration_counts_mismatch
run_test test_verify_migration_account_filter

print_summary
