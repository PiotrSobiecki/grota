#!/usr/bin/env bash
# Pluggable secret backend: env or file
set -euo pipefail

[[ "$(type -t log_info)" == "function" ]] || source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# Backend: "env" (default) or "file"
SECRETS_BACKEND="${SECRETS_BACKEND:-env}"
SECRETS_DIR="${SECRETS_DIR:-/etc/grota/secrets}"

get_secret() {
  local key="$1"
  local value=""

  case "$SECRETS_BACKEND" in
    env)
      value="${!key:-}"
      ;;
    file)
      local file="${SECRETS_DIR}/${key}"
      if [[ -f "$file" ]]; then
        value=$(cat "$file")
      fi
      ;;
    *)
      log_fatal "Unknown secrets backend: $SECRETS_BACKEND"
      ;;
  esac

  if [[ -z "$value" ]]; then
    log_fatal "Secret not found: $key (backend: $SECRETS_BACKEND)"
  fi

  echo "$value"
}

# Convenience wrappers
get_r2_access_key_id()     { get_secret "R2_ACCESS_KEY_ID"; }
get_r2_secret_access_key() { get_secret "R2_SECRET_ACCESS_KEY"; }
get_google_client_id()     { get_secret "GOOGLE_CLIENT_ID"; }
get_google_client_secret() { get_secret "GOOGLE_CLIENT_SECRET"; }
