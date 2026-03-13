#!/usr/bin/env bash
set -euo pipefail
source /etc/grota/grota.env
source /usr/local/lib/grota/common.sh
source /usr/local/lib/grota/config.sh
load_config
source /usr/local/lib/grota/setup.sh

TOKEN=$(cfg_account_token 0)
EMAIL=$(cfg_account_email 0)
TK=$(build_rclone_token "$TOKEN")
REMOTE="gdrive-$(sanitize_email "$EMAIL")"

echo "Testing env-based rclone for $EMAIL..."
echo "Token JSON (first 80 chars): ${TK:0:80}"

RCLONE_CONFIG_DRIVE_TYPE=drive \
RCLONE_CONFIG_DRIVE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
RCLONE_CONFIG_DRIVE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
RCLONE_CONFIG_DRIVE_SCOPE=drive.readonly \
RCLONE_CONFIG_DRIVE_TOKEN="$TK" \
  rclone lsd drive: --max-depth 0

echo "SUCCESS"
