#!/usr/bin/env bash
# Sync data-service secrets from apps/data-service/.{env}.vars to Cloudflare Workers.
# user-application uses Vite — env baked at build time, just redeploy.
#
# Usage: bash scripts/sync-secrets.sh <staging|production>

set -euo pipefail

ENV="${1:-}"
if [[ -z "$ENV" || ! "$ENV" =~ ^(staging|production)$ ]]; then
	echo "Usage: $0 <staging|production>" >&2
	exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DS_VARS="$REPO_ROOT/apps/data-service/.${ENV}.vars"

if [[ ! -f "$DS_VARS" ]]; then
	echo "ERROR: missing $DS_VARS" >&2
	exit 1
fi

# Keys never pushed as secrets:
# - CLOUDFLARE_ENV: lives in wrangler.jsonc env config
SKIP_KEYS=("CLOUDFLARE_ENV")

is_skipped() {
	local k="$1"
	for s in "${SKIP_KEYS[@]}"; do
		[[ "$k" == "$s" ]] && return 0
	done
	return 1
}

echo ">>> Syncing data-service secrets to env=$ENV from $DS_VARS"
cd "$REPO_ROOT/apps/data-service"

pushed=0
skipped=0
while IFS= read -r line || [[ -n "$line" ]]; do
	# Skip empty + comments
	[[ -z "${line// }" || "$line" =~ ^[[:space:]]*# ]] && continue
	# Split on first =
	key="${line%%=*}"
	value="${line#*=}"
	# Trim whitespace around key
	key="$(echo "$key" | tr -d '[:space:]')"
	[[ -z "$key" ]] && continue
	# Strip surrounding double quotes from value (single line only)
	if [[ "$value" == \"*\" ]]; then
		value="${value%\"}"
		value="${value#\"}"
	fi

	if is_skipped "$key"; then
		echo "  skip   $key (excluded)"
		skipped=$((skipped + 1))
		continue
	fi

	echo "  set    $key"
	printf '%s' "$value" | pnpm exec wrangler secret put "$key" --env "$ENV" >/dev/null
	pushed=$((pushed + 1))
done < "$DS_VARS"

cd "$REPO_ROOT"

echo ""
echo ">>> data-service: pushed $pushed, skipped $skipped"

UA_ENV="$REPO_ROOT/apps/user-application/.env.${ENV}"
if [[ -f "$UA_ENV" ]]; then
	echo ""
	echo ">>> user-application: Vite bakes .env.${ENV} into the build at deploy time."
	echo "    Redeploy when ready: pnpm run deploy:${ENV}:user-application"
fi
