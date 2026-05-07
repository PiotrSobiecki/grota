# grota-runner — VPS deployment

HTTP control plane dla `grota backup` / `grota migrate`. Stoi na VPSie klienta, eksponowany przez Cloudflare Tunnel (bez publicznego IP / otwartych portow).

## Architektura

```
[admin UI: dashboard/$id/migration]
          |
          v
[user-application Worker]  --(server fn)-->  [data-service Worker]
                                                      |
                                  Bearer GROTA_TOKEN  | (config: runner_url + runner_token)
                                                      v
                                          [Cloudflare Tunnel]
                                                      |
                                                      v
                                  [grota-runner @ VPS] --spawn--> rclone
```

## Wymagania na VPSie (Debian/Ubuntu)

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git rclone

# pnpm
sudo npm i -g pnpm

# cloudflared (Cloudflare Tunnel)
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

## Instalacja runnera

### (a) Tryb git clone (publiczny repo lub deploy-key na VPSie)

```bash
curl -fsSL https://raw.githubusercontent.com/PiotrSobiecki/grota/main/apps/runner/deploy/install.sh \
  | sudo bash -s -- git@github.com:PiotrSobiecki/grota.git main
```

### (b) Tryb `--no-clone` (private repo / lokalny branch — kod wgrywany przez rsync)

Z lokalnej maszyny (PowerShell w katalogu repo):

```powershell
tar --exclude=node_modules --exclude=.turbo --exclude=dist --exclude=.wrangler --exclude=.next --exclude=.git -czf $env:TEMP\grota.tar.gz .
scp "$env:TEMP\grota.tar.gz" root@<vps>:/tmp/
```

Na VPSie (jako root):

```bash
useradd --system --home /opt/grota --shell /usr/sbin/nologin grota || true
install -d -o grota -g grota -m 750 /opt/grota
tar -xzf /tmp/grota.tar.gz -C /opt/grota
chown -R grota:grota /opt/grota
sudo bash /opt/grota/apps/runner/deploy/install.sh --no-clone
```

### Co skrypt robi
1. Tworzy uzytkownika systemowego `grota` (nologin), katalogi `/opt/grota`, `/var/backups/grota`, `/etc/grota`.
2. (Tylko bez `--no-clone`) Klonuje repo, instaluje deps (`pnpm install --frozen-lockfile`), buduje `@repo/data-ops`.
3. (Z `--no-clone`) Pomija clone, leci od razu pnpm install + build.
4. Generuje losowy `GROTA_TOKEN` do `/etc/grota/runner.env` (chmod 600). **Skopiuj token** — wstaw go w UI panelu **Konfiguracja serwera → Zaawansowane → runner_token**.
5. Instaluje i uruchamia `grota-runner.service` (systemd).
6. Pokazuje `systemctl status` i komende do testu lokalnego.

## Cloudflare Tunnel

```bash
# Login (otwiera browser)
sudo cloudflared tunnel login

# Stworz tunel
sudo cloudflared tunnel create grota-runner-<klient>
# Skopiuj UUID z outputu — credentials JSON laduje w /root/.cloudflared/<UUID>.json

# Skopiuj credentials JSON do /etc/cloudflared/ (tam czyta service)
sudo mkdir -p /etc/cloudflared
sudo cp /root/.cloudflared/<UUID>.json /etc/cloudflared/<UUID>.json

# Wgraj template configu i podstaw UUID + hostname
sudo cp /opt/grota/apps/runner/deploy/cloudflared.config.example.yml /etc/cloudflared/config.yml
sudo nano /etc/cloudflared/config.yml   # podstaw UUID + hostname

# Route DNS
sudo cloudflared tunnel route dns grota-runner-<klient> runner.<klient>.example.com

# Service
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

W UI ustaw **runner_url = `https://runner.<klient>.example.com`** (panel Konfiguracja serwera).

## Smoke test

```bash
# lokalnie z VPSa
curl -s -H "Authorization: Bearer $GROTA_TOKEN" http://localhost:7878/health

# z zewnatrz przez tunel
curl -s -H "Authorization: Bearer $GROTA_TOKEN" https://runner.<klient>.example.com/health
# {"status":"ok","version":"0.1.0"}
```

W panelu admina **`/dashboard/<deploymentId>/migration`** → przycisk **Backup** powinien wystartowac job, ktory pojawi sie w karcie Aktywny job, a po zakonczeniu w Historii.

## Operacje

| Akcja | Komenda |
|---|---|
| Status | `systemctl status grota-runner` |
| Logi (live) | `journalctl -u grota-runner -f` |
| Restart | `systemctl restart grota-runner` |
| Update kodu | `cd /opt/grota && sudo -u grota git pull && pnpm install && systemctl restart grota-runner` |
| Rotacja tokenu | edytuj `/etc/grota/runner.env`, restart service, wgraj nowy token w UI |

## Bezpieczenstwo

- `/etc/grota/runner.env` chmod 600, owner root — token nie jest dostepny dla `grota` user (czytany tylko przez systemd przed exec).
- Service hardening: `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`, `ReadWritePaths=/var/backups/grota` (tylko ta sciezka writable).
- Bearer auth na kazdym endpoincie (`/health` tez), 401 bez tokenu.
- Sanityzacja logow: regex maskuje `Bearer ...`, `account=`, `key=`, `app_key=`, `refresh_token=` przed zapisem do ring buffera — sekrety nie trafiaja do SSE/historii.
- Cloudflare Tunnel = brak publicznego IP, brak otwartych portow, TLS terminowany na CF edge.
