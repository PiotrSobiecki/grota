# Multi-Deployment Support on Single VPS

## Context

Currently grota supports one deployment per VPS (`DEPLOYMENT_ID` in `/etc/grota/grota.env`). Goal: support N deployments with minimal changes, backward-compatible with single-deployment setups.

## Approach: `DEPLOYMENT_IDS` env var + `each` command

Add comma-separated `DEPLOYMENT_IDS` to `grota.env`. New `grota each <cmd>` loops over them. No new files, no directory restructuring.

## Changes

### 1. `apps/cli/grota.env.example` — add DEPLOYMENT_IDS
```
# Multi-deployment (optional, comma-separated)
# If set, `grota each <cmd>` runs <cmd> for each deployment
DEPLOYMENT_IDS=""
```

### 2. `apps/cli/grota` — add `--deployment` flag + `each` command

**Flag parsing** before command routing (~line 55):
```bash
# Parse --deployment flag
if [[ "${1:-}" == "--deployment" ]]; then
  export DEPLOYMENT_ID="$2"
  shift 2
fi
```

**New `each` command** in the case block:
```bash
each)
  shift 1
  # Resolve list: DEPLOYMENT_IDS (comma-sep) or fall back to single DEPLOYMENT_ID
  local ids_str="${DEPLOYMENT_IDS:-${DEPLOYMENT_ID:-}}"
  [[ -n "$ids_str" ]] || { echo "No DEPLOYMENT_ID or DEPLOYMENT_IDS set"; exit 1; }
  IFS=',' read -ra ids <<< "$ids_str"

  worst_rc=0
  for id in "${ids[@]}"; do
    id="${id// /}"  # trim whitespace
    log_info "── deployment: $id ──"
    bash "$0" --deployment "$id" "$@" || rc=$?
    (( rc > worst_rc )) && worst_rc=$rc
  done
  exit $worst_rc
  ;;
```

**Update usage** to show `each` and `--deployment`.

### 3. `apps/cli/lib/orchestrator.sh` — scope lock key
```bash
# Line 32: change
acquire_lock "backup-all"
# to
acquire_lock "backup-all-${deployment_id}"
```

### 4. `apps/cli/lib/backup.sh` — scope per-account lock key
```bash
# Change
acquire_lock "backup-${sanitized_email}"
# to
acquire_lock "backup-${DEPLOYMENT_ID:-unknown}-${sanitized_email}"
```

### 5. `apps/cli/systemd/grota-backup.service`
```
ExecStart=/usr/local/bin/grota each backup all
```

### 6. `apps/cli/systemd/grota-verify.service`
```
ExecStart=/usr/local/bin/grota each audit backup
```

## File Summary

| File | Change |
|------|--------|
| `apps/cli/grota` | `--deployment` flag, `each` command, usage update |
| `apps/cli/grota.env.example` | `DEPLOYMENT_IDS` line |
| `apps/cli/lib/orchestrator.sh:32` | Lock key `backup-all-${deployment_id}` |
| `apps/cli/lib/backup.sh:42` | Lock key `backup-${DEPLOYMENT_ID}-${email}` |
| `apps/cli/systemd/grota-backup.service:11` | `grota each backup all` |
| `apps/cli/systemd/grota-verify.service:11` | `grota each audit backup` |

## Verification

1. Single deployment (backward compat): `DEPLOYMENT_ID=xxx grota backup all` — works as before
2. Single via each: `DEPLOYMENT_ID=xxx grota each backup all` — loops over 1 deployment
3. Multi: `DEPLOYMENT_IDS=id1,id2 grota each backup all` — runs for each
4. Override: `grota --deployment id1 backup all` — targets specific deployment
5. Systemd: timer triggers `grota each backup all`, reads DEPLOYMENT_IDS from env

## Decisions

- `each` runs **sequential** — safer for shared disk I/O
- Per-deployment notifications stand alone (no aggregation)
- Same-email across deployments: non-issue — lock keys scoped by deployment_id, backup_path differs per config
