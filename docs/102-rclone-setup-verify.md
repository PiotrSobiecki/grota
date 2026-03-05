# 102: rclone Setup & Verification

## Goal

Create setup functions in `lib/setup.sh` that generate `rclone.conf` from the R2 config JSON (OAuth tokens from web app), configure B2 remotes from Terraform outputs, and verify all remotes are functional. Invoked via `grota setup rclone`, `grota setup b2`, `grota verify remotes`.

## Prerequisites

- Doc 100 (lib foundation -- common.sh, config.sh)
- Doc 101 (Terraform B2 -- bucket names + app keys)
- `rclone` >= 1.65 installed
- Config JSON accessible (R2 or local)

## Scope

### IN

- `scripts/lib/setup.sh` -- functions: `cmd_setup_rclone`, `cmd_setup_b2`, `cmd_verify_remotes`
- `cmd_setup_rclone` -- generates Google Drive remotes from config JSON tokens
- `cmd_setup_b2` -- creates B2 remotes from Terraform outputs or env vars
- `cmd_verify_remotes` -- tests all configured remotes
- Token format: rclone-compatible JSON token from OAuth refresh_token

### OUT

- Backup execution (doc 103)
- Token refresh logic (rclone handles automatically)
- Manual OAuth flow (replaced by web app)

## Decisions

| Item | Decision |
|------|----------|
| rclone config location | `$RCLONE_CONFIG` (default `/etc/rclone/rclone.conf`). Scripts write directly. |
| Drive remote naming | `gdrive-{sanitized_email}` e.g. `gdrive-jan-gmail-com` |
| B2 remote naming | `b2-{category}` e.g. `b2-dokumenty`, `b2-projekty`, `b2-media` |
| Token format | rclone expects `{"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}`. Built from config JSON `oauth_refresh_token` + Google client credentials. |
| Drive scope | Employee tokens: `drive.readonly` (backup only). Workspace admin token: `drive` (full access for migration, doc 105). |

## Files

### `scripts/lib/setup.sh`

```bash
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
  jq -n \
    --arg refresh "$refresh_token" \
    '{access_token: "", token_type: "Bearer", refresh_token: $refresh, expiry: "2000-01-01T00:00:00Z"}'
}

# ── grota setup rclone ─────────────────────────────
cmd_setup_rclone() {
  init_logging "setup-rclone"
  require_cmd rclone jq

  mkdir -p "$(dirname "$RCLONE_CONFIG")"
  require_env GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET

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

    rclone config delete "$remote_name" 2>/dev/null || true

    # Employee tokens: readonly scope (backup only)
    rclone config create "$remote_name" drive \
      client_id "$GOOGLE_CLIENT_ID" \
      client_secret "$GOOGLE_CLIENT_SECRET" \
      scope "drive.readonly" \
      token "$rclone_token" \
      --non-interactive

    created=$((created + 1))
  done

  # Workspace admin remote (full scope for migration)
  local ws_token
  ws_token=$(cfg_workspace_token)
  if [[ -n "$ws_token" ]]; then
    local ws_rclone_token
    ws_rclone_token=$(build_rclone_token "$ws_token")

    log_info "Configuring workspace remote: workspace-drive"
    rclone config delete "workspace-drive" 2>/dev/null || true

    rclone config create "workspace-drive" drive \
      client_id "$GOOGLE_CLIENT_ID" \
      client_secret "$GOOGLE_CLIENT_SECRET" \
      scope "drive" \
      token "$ws_rclone_token" \
      --non-interactive

    created=$((created + 1))
    log_info "Created workspace-drive remote (full Drive scope)"
  fi

  log_info "Created $created remotes in $RCLONE_CONFIG"
}

# ── grota setup b2 ─────────────────────────────────
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
      --non-interactive

    log_info "Remote $remote_name created (bucket: $bucket_name)"
  done

  log_info "B2 remote setup complete"
}

# ── grota verify remotes ───────────────────────────
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
```

## Implementation Steps

1. **Create `scripts/lib/setup.sh`** -- chmod +x

2. **Verify with shellcheck**
   ```bash
   shellcheck scripts/lib/setup.sh
   ```

## Manual Test Script

```bash
# Setup: use local sample config
export CONFIG_PATH=scripts/test/sample-config.json
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export RCLONE_CONFIG="/tmp/grota-test-rclone.conf"

# 1. Generate Drive remotes
grota setup rclone
# Expect: 2 Drive remotes + 1 workspace remote created
rclone listremotes --config "$RCLONE_CONFIG"
# Expect: gdrive-jan-gmail-com:, gdrive-anna-gmail-com:, workspace-drive:

# 2. Check rclone.conf content
cat "$RCLONE_CONFIG"
# Expect: [gdrive-jan-gmail-com] with type=drive, scope=drive.readonly, token JSON
# Expect: [workspace-drive] with type=drive, scope=drive (full access)

# 3. Generate B2 remotes (using sample config single key)
grota setup b2
# Expect: 3 B2 remotes created
rclone listremotes --config "$RCLONE_CONFIG"
# Expect: includes b2-dokumenty:, b2-projekty:, b2-media:

# 4. Verify remotes (will fail with test tokens but tests the script flow)
grota verify remotes
# Expect: attempts verification, likely fails with test credentials
# With REAL credentials:
# Expect: all remotes pass

# 5. Test with per-category B2 keys (Terraform output)
export B2_DOKUMENTY_KEY_ID="real-key-id"
export B2_DOKUMENTY_APP_KEY="real-app-key"
grota setup b2
# Expect: dokumenty uses per-category key, others fall back to config JSON

# 6. Cleanup
rm -f "$RCLONE_CONFIG"
```

## Unresolved Questions

- Token expiry handling: rclone auto-refreshes, but what if refresh_token itself is revoked? Exit code 6 per PLAN.md -- who detects this, verify-remotes or backup scripts?
