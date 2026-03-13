#!/usr/bin/env bash
# Setup functions: rclone init, B2 init, verify remotes
# Called via: grota setup rclone | grota setup b2 | grota verify remotes
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/rclone/rclone.conf}"
export RCLONE_CONFIG

sanitize_email() {
  echo "$1" | tr '@.' '-'
}

build_rclone_token() {
  local refresh_token="$1"
  jq -cn \
    --arg refresh "$refresh_token" \
    '{access_token: "", token_type: "Bearer", refresh_token: $refresh, expiry: "2000-01-01T00:00:00Z"}'
}

write_rclone_remote() {
  local name="$1" client_id="$2" client_secret="$3" scope="$4" token_json="$5"
  # Remove existing section if present
  if [[ -f "$RCLONE_CONFIG" ]]; then
    sed -i "/^\[${name}\]$/,/^\[/{ /^\[${name}\]$/d; /^\[/!d; }" "$RCLONE_CONFIG"
  fi
  cat >> "$RCLONE_CONFIG" <<EOF
[${name}]
type = drive
client_id = ${client_id}
client_secret = ${client_secret}
scope = ${scope}
token = ${token_json}

EOF
}

# -- grota setup rclone ----------------------------------------
cmd_setup_rclone() {
  init_logging "setup-rclone"
  require_cmd jq

  mkdir -p "$(dirname "$RCLONE_CONFIG")"
  require_env GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET

  # Start fresh config
  : > "$RCLONE_CONFIG"

  local account_count
  account_count=$(cfg_account_count)
  log_info "Configuring rclone for $account_count accounts"

  local created=0
  for (( i=0; i<account_count; i++ )); do
    local email token remote_name rclone_token
    email=$(cfg_account_email "$i")
    token=$(cfg_account_token "$i")

    if [[ -z "$token" || "$token" == "null" ]]; then
      log_warn "Skipping $email -- no OAuth token"
      continue
    fi

    remote_name="gdrive-$(sanitize_email "$email")"
    rclone_token=$(build_rclone_token "$token")

    log_info "Configuring remote: $remote_name ($email)"

    write_rclone_remote "$remote_name" "$GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_SECRET" "drive.readonly" "$rclone_token"

    created=$((created + 1))
  done

  # Workspace admin remote (full scope for migration)
  local ws_token
  ws_token=$(cfg_workspace_token)
  if [[ -n "$ws_token" ]]; then
    local ws_rclone_token
    ws_rclone_token=$(build_rclone_token "$ws_token")

    log_info "Configuring workspace remote: workspace-drive"

    write_rclone_remote "workspace-drive" "$GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_SECRET" "drive" "$ws_rclone_token"

    created=$((created + 1))
    log_info "Created workspace-drive remote (full Drive scope)"
  fi

  log_info "Created $created remotes in $RCLONE_CONFIG"
}

# -- grota setup b2 --------------------------------------------
cmd_setup_b2() {
  init_logging "setup-b2"
  require_cmd rclone

  mkdir -p "$(dirname "$RCLONE_CONFIG")"

  local bucket_prefix
  bucket_prefix=$(cfg_b2_prefix)
  if [[ -z "$bucket_prefix" ]]; then
    log_fatal "b2.bucket_prefix not set in config JSON"
  fi

  for category in dokumenty projekty media; do
    local upper key_id_var app_key_var key_id app_key remote_name bucket_name
    upper=$(echo "$category" | tr '[:lower:]' '[:upper:]')
    key_id_var="B2_${upper}_KEY_ID"
    app_key_var="B2_${upper}_APP_KEY"

    key_id="${!key_id_var:-}"
    app_key="${!app_key_var:-}"

    # Fallback: single B2 key from config JSON
    if [[ -z "$key_id" ]]; then
      key_id=$(cfg_b2_key_id)
      app_key=$(cfg_b2_app_key)
    fi

    if [[ -z "$key_id" || -z "$app_key" ]]; then
      log_warn "Skipping B2 remote for $category -- no credentials"
      continue
    fi

    remote_name="b2-${category}"
    bucket_name="${bucket_prefix}-${category}"

    log_info "Configuring B2 remote: $remote_name -> $bucket_name"
    rclone config delete "$remote_name" 2>/dev/null || true

    rclone config create "$remote_name" b2 \
      account "$key_id" \
      key "$app_key" \
      --non-interactive >/dev/null

    log_info "Remote $remote_name created (bucket: $bucket_name)"
  done

  log_info "B2 remote setup complete"
}

# -- grota verify remotes --------------------------------------
cmd_verify_remotes() {
  init_logging "verify-remotes"
  require_cmd rclone jq

  local failed=0 passed=0 total=0

  verify_remote() {
    local remote="$1"
    local description="$2"
    total=$((total + 1))

    log_info "Verifying: $remote ($description)"

    if rclone lsd "${remote}:" --max-depth 0 --timeout 30s >/dev/null 2>&1; then
      log_info "  PASS: $remote"
      passed=$((passed + 1))
    else
      log_error "  FAIL: $remote"
      failed=$((failed + 1))
    fi
  }

  # Verify Drive remotes
  local account_count
  account_count=$(cfg_account_count)
  for (( i=0; i<account_count; i++ )); do
    local email remote_name
    email=$(cfg_account_email "$i")
    remote_name="gdrive-$(echo "$email" | tr '@.' '-')"
    verify_remote "$remote_name" "Google Drive: $email"
  done

  # Verify workspace remote
  if rclone listremotes | grep -q "^workspace-drive:$"; then
    verify_remote "workspace-drive" "Workspace admin Drive"
  fi

  # Verify B2 remotes
  local bucket_prefix
  bucket_prefix=$(cfg_b2_prefix)
  for category in dokumenty projekty media; do
    local remote_name bucket_name
    remote_name="b2-${category}"
    bucket_name="${bucket_prefix}-${category}"

    if ! rclone listremotes | grep -q "^${remote_name}:$"; then
      log_warn "Remote $remote_name not configured, skipping"
      continue
    fi

    total=$((total + 1))
    log_info "Verifying: $remote_name ($bucket_name)"

    if rclone lsd "${remote_name}:${bucket_name}" --max-depth 0 --timeout 30s >/dev/null 2>&1; then
      log_info "  PASS: $remote_name"
      passed=$((passed + 1))
    else
      log_error "  FAIL: $remote_name"
      failed=$((failed + 1))
    fi
  done

  log_info "Verification complete: $passed/$total passed, $failed failed"

  if (( failed > 0 )); then
    log_error "Some remotes failed verification"
    exit 1
  fi

  log_info "All remotes OK"
}
