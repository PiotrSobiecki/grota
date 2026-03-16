#!/usr/bin/env bash
# Config loader: reads deployment config JSON from R2 or local file
set -euo pipefail

# Source common if not already loaded
[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# -- Config loading --
CONFIG_JSON=""
_config_tmp=""

load_config() {
  local deployment_id="${1:-${DEPLOYMENT_ID:-}}"

  # Local override
  if [[ -n "${CONFIG_PATH:-}" && -f "${CONFIG_PATH}" ]]; then
    CONFIG_JSON=$(cat "$CONFIG_PATH")
    log_info "Config loaded from local file: $CONFIG_PATH"
    return 0
  fi

  # Download from R2
  require_env R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ENDPOINT R2_BUCKET
  [[ -n "$deployment_id" ]] || log_fatal "DEPLOYMENT_ID required for R2 download"

  require_cmd rclone

  _config_tmp=$(mktemp)
  on_exit "rm -f '$_config_tmp'"

  local r2_path="configs/${deployment_id}/config.json"
  log_info "Downloading config from R2: ${R2_BUCKET}/${r2_path}"

  # Use rclone with on-the-fly remote config (no rclone.conf dependency)
  RCLONE_CONFIG_R2_TYPE=s3 \
  RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
  RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT" \
  RCLONE_CONFIG_R2_ACL=private \
    rclone copyto "r2:${R2_BUCKET}/${r2_path}" "$_config_tmp" \
    || log_fatal "Failed to download config from R2"

  CONFIG_JSON=$(cat "$_config_tmp")
  log_info "Config loaded from R2 (${#CONFIG_JSON} bytes)"
}

# -- Config accessors (jq wrappers) --
cfg() {
  local query="$1"
  echo "$CONFIG_JSON" | jq -r "$query"
}

cfg_raw() {
  local query="$1"
  echo "$CONFIG_JSON" | jq "$query"
}

cfg_client_name()  { cfg '.client_name'; }
cfg_domain()       { cfg '.domain'; }
cfg_deployment_id(){ cfg '.deployment_id'; }

cfg_account_count() {
  echo "$CONFIG_JSON" | jq '.accounts | length'
}

cfg_account_email() {
  local idx="$1"
  cfg ".accounts[$idx].email"
}

cfg_account_name() {
  local idx="$1"
  cfg ".accounts[$idx].name"
}

cfg_account_token() {
  local idx="$1"
  cfg ".accounts[$idx].oauth_refresh_token"
}

cfg_account_folders() {
  local idx="$1"
  cfg_raw ".accounts[$idx].folders"
}

cfg_account_folders_by_drive() {
  local idx="$1"
  local drive_name="$2"
  cfg_raw ".accounts[$idx].folders | map(select(.shared_drive_name == \"$drive_name\"))"
}

cfg_shared_drive_names() {
  cfg_raw '.workspace.shared_drives // [] | .[].name' | tr -d '"'
}

cfg_b2_key_id()   { cfg '.b2.key_id // empty'; }
cfg_b2_app_key()  { cfg '.b2.app_key // empty'; }
cfg_b2_prefix()   { cfg '.b2.bucket_prefix // empty'; }

cfg_server_backup_path() { cfg '.server.backup_path // "/srv/backup/gdrive"'; }
cfg_server_bwlimit()     { cfg '.server.bwlimit // "08:00,5M 23:00,50M"'; }

# Workspace config
cfg_workspace_token()     { cfg '.workspace.oauth_refresh_token // empty'; }
cfg_shared_drives()       { cfg_raw '.workspace.shared_drives // []'; }
cfg_shared_drive_name()   {
  local idx="$1"
  cfg ".workspace.shared_drives[$idx].name"
}
