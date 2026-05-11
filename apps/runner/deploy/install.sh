#!/usr/bin/env bash
# install.sh — instalator grota-runner na Debian/Ubuntu VPS.
#
# Wymagania wstepne (recznie przed odpaleniem):
#   - Node.js >= 20 (curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && apt install nodejs)
#   - pnpm    >= 9  (npm i -g pnpm)
#   - rclone        (apt install rclone)
#   - cloudflared   (https://pkg.cloudflare.com/index.html)
#   - git           (tylko dla trybu z git clone)
#
# Tryby:
#   (a) git clone (publiczny lub deploy-key na VPSie):
#       sudo bash install.sh <git-repo-url> [branch=main]
#       Przyklad: sudo bash install.sh git@github.com:auditmos/grota.git main
#
#   (b) Bez clone — kod juz w /opt/grota (np. wgrany przez rsync/scp):
#       sudo bash install.sh --no-clone
#       Workflow dla prywatnych repo / lokalnych branchy:
#         (lokalnie) tar -czf grota.tar.gz . && scp grota.tar.gz root@vps:/tmp/
#         (na VPSie) tar -xzf /tmp/grota.tar.gz -C /opt/grota && chown -R grota:grota /opt/grota
#         (na VPSie) sudo bash /opt/grota/apps/runner/deploy/install.sh --no-clone

set -euo pipefail

NO_CLONE=0
REPO_URL=""
BRANCH="main"

if [[ "${1:-}" == "--no-clone" ]]; then
  NO_CLONE=1
elif [[ -n "${1:-}" ]]; then
  REPO_URL="$1"
  BRANCH="${2:-main}"
else
  echo "usage:" >&2
  echo "  sudo bash install.sh <git-repo-url> [branch=main]" >&2
  echo "  sudo bash install.sh --no-clone   (kod juz w /opt/grota)" >&2
  exit 2
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "musi byc root (sudo)" >&2
  exit 2
fi

INSTALL_DIR="/opt/grota"
BACKUP_DIR="/var/backups/grota"
ENV_FILE="/etc/grota/runner.env"
SERVICE_FILE="/etc/systemd/system/grota-runner.service"
USER="grota"

# 1) user + katalogi
if ! id "$USER" &>/dev/null; then
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$USER"
fi
install -d -o "$USER" -g "$USER" -m 750 "$INSTALL_DIR"
install -d -o "$USER" -g "$USER" -m 750 "$BACKUP_DIR"
install -d -o root  -g root   -m 700 /etc/grota

# 2) clone / update repo (skip when --no-clone — code juz wgrany)
if [[ "$NO_CLONE" -eq 1 ]]; then
  if [[ ! -f "$INSTALL_DIR/package.json" ]]; then
    echo "ERROR: --no-clone wymaga ze /opt/grota ma juz kod (package.json brakuje)" >&2
    exit 3
  fi
  echo "Skipping git clone (--no-clone). Code source: $INSTALL_DIR"
elif [[ ! -d "$INSTALL_DIR/.git" ]]; then
  sudo -u "$USER" git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
  sudo -u "$USER" git -C "$INSTALL_DIR" fetch --all --prune
  sudo -u "$USER" git -C "$INSTALL_DIR" checkout "$BRANCH"
  # Po rewrite historii na origin brak FF — sam pull pada. Runnerowy VPS ma byc lustrem repo.
  if ! sudo -u "$USER" git -C "$INSTALL_DIR" pull --ff-only; then
    echo "WARN: git pull --ff-only niemozliwy (rozjechana historia). Ustawiam na origin/$BRANCH." >&2
    sudo -u "$USER" git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
  fi
fi

# 3) install deps + build data-ops (runner depends on workspace package)
sudo -u "$USER" bash -lc "cd '$INSTALL_DIR' && pnpm install --frozen-lockfile"
sudo -u "$USER" bash -lc "cd '$INSTALL_DIR' && pnpm --filter @repo/data-ops build"

# 4) env file (token gen jezeli brak)
if [[ ! -f "$ENV_FILE" ]]; then
  TOKEN="$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 48)"
  cat > "$ENV_FILE" <<EOF
# grota-runner env. NIE COMMITOWAC. chmod 600.
GROTA_TOKEN=$TOKEN
GROTA_PORT=7878
EOF
  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
  echo
  echo "Wygenerowany GROTA_TOKEN (skopiuj do data-service server-config.runner_token):"
  echo
  echo "  $TOKEN"
  echo
else
  echo "$ENV_FILE juz istnieje — pomijam generacje tokenu."
fi

# 5) systemd unit
install -m 644 "$INSTALL_DIR/apps/runner/deploy/grota-runner.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable grota-runner.service
systemctl restart grota-runner.service

# 6) status check
sleep 2
systemctl --no-pager --full status grota-runner.service || true
echo
echo "Sprawdz: curl -s -H \"Authorization: Bearer \$GROTA_TOKEN\" http://localhost:7878/health"
echo "Cloudflare Tunnel: edytuj /etc/cloudflared/config.yml na podstawie apps/runner/deploy/cloudflared.config.example.yml"
