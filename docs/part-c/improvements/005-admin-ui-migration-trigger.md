# Admin UI: Migration Trigger (Direct-Call)

## Context

Currently admin musi SSH-ować na VPS i odpalać `grota backup` / `grota migrate` ręcznie z CLI. Po onboardingu pracownika (OAuth + wybór folderów) brakuje finalnego kroku w UI: **admin klika "Migruj" → backend uruchamia migrację → UI pokazuje status i logi**.

**Skala**: do ~50 pracowników na deployment, single-tenant per VPS. Jednorazowy batch lub kilka tur.

**Decyzja architektoniczna**: direct-call (HTTP) zamiast job-queue. CLI na VPS wystawia mały HTTP serwis chroniony tokenem; `data-service` proxuje requesty z UI admina. Bez Redis/BullMQ — overkill przy tej skali.

**Tradeoff**: VPS musi mieć publiczny endpoint — rozwiązanie przez Cloudflare Tunnel (bez otwierania portów / publicznego IP).

---

## Next session (2026-05-07)

Plan na jutro — kolejnosc:
1. **Setup B2** — utworz application key w panelu Backblaze (read+write na bucket testowy), zanotuj `keyId` + `applicationKey` + `bucketName`.
2. **Setup VPS** — sprawdz dostep ssh, zainstaluj wymagania (Node 22 + pnpm + rclone + cloudflared zgodnie z `apps/runner/deploy/README.md`), uruchom `install.sh`, zanotuj wygenerowany `GROTA_TOKEN`.
3. **Cloudflare Tunnel** — `cloudflared tunnel create grota-runner-test`, route DNS na np. `runner.test.<domena>`, restart cloudflared, `curl /health` przez tunel.
4. **Setup data-service prod/staging** — sprawdz ze `ENCRYPTION_KEY` i `API_TOKEN` sa ustawione (Worker secrets), redeploy jezeli potrzeba.
5. **W UI** — utworz testowe wdrozenie (lub uzyj istniejacego), wpisz B2 keys + `runner_url` (CF Tunnel URL) + `runner_token` (z kroku 2), kliknij **Test polaczenia** → expected `{ok:true}`.
6. **Smoke backup** — kliknij Backup w panelu migracji, sprawdz `journalctl -u grota-runner -f` na VPSie + wpis w `migration_jobs` w DB + status w UI.
7. **Smoke dry-run + migrate** — analogicznie.
8. **Slice 8 runbook** — w trakcie krokow 1-7 zapisujemy faktyczne komendy/wartosci do `docs/part-c/improvements/005-admin-ui-migration-trigger-runbook.md`.

Po runbooku — pozostale TODO: live log SSE viewer w UI, audit log zmian config, rate limit, persystencja logow (jezeli okaze sie potrzebna).

---

## Status (2026-05-05, EOD)

**Branch**: `feat/admin-migration-trigger` — lokalny, nic nie commitowane, nic nie pushowane.

**Zrobione (Slice 0 — backend kompletny):**
- ✅ `data-ops` schema: `validateBandwidthLimit`, refinement na `bwlimit`, `runner_url` + `runner_token` w `ServerConfigSchema`, `ServerConfigUpdateRequestSchema` (partial)
- ✅ `data-ops` encryption: `encryptServerConfig` / `decryptServerConfig` (AES-256-GCM, tylko `runner_token`), `maskSecret`
- ✅ `data-ops` queries: `getDeploymentServerConfig`, `setDeploymentServerConfig`
- ✅ `data-ops` migration kontrakt: `runner-protocol.ts` (Zod schemas dla runnera ↔ data-service)
- ✅ Test infra: vitest unit + integration w `data-ops` i `data-service`, fixtures (`createTestDeployment`, `resetTestDatabase`)
- ✅ `data-service` services: `getServerConfigForAdmin`, `setServerConfigFromAdmin` (partial merge), `testRunnerConnection`
- ✅ `data-service` handlers: GET / PUT / POST-test pod `/deployments/:id/server-config*`

**Liczby**: data-ops 42/42 unit + 5/5 integration. data-service 12/12 integration. Types OK, build OK.

**Do zrobienia jutro+:**
- ⏳ UI `apps/user-application`: formularz `/admin/deployments/$id/server-config` (Slice 0 frontend)
- ⏳ Slice 1: CLI runner (`apps/cli serve` + endpointy `/health`, `/jobs/backup`, `/jobs/migrate`, `/jobs/:id`, SSE logs, `/verify`)
- ⏳ Slice 2: VPS deployment (systemd + Cloudflare Tunnel + install script)
- ⏳ Slice 3-7: `migration_jobs` table, handlery proxy, UI panel migracji, hardening

---

## Implementation log

- **2026-05-07** — Sesja deploy + smoke 32: VPS deployment przeprowadzony end-to-end (Ubuntu 22.04, Contabo `31.220.90.131`). Doinstalowane: Node 20, pnpm 10, rclone, cloudflared, git. Kod wgrany przez `tar | scp` (repo prywatne, branch niepushowany — pominięty `git clone` z install.sh). User `grota` + dirs (`/opt/grota`, `/var/backups/grota`, `/etc/grota`) utworzone manualnie. Token `GROTA_TOKEN` wygenerowany i zapisany w `/etc/grota/runner.env` (chmod 600). systemd unit `grota-runner.service` zainstalowany, **bug**: `ExecStart=/opt/grota/node_modules/.bin/tsx` — w pnpm workspace tsx siedzi w `apps/runner/node_modules/.bin/`. Fix wprowadzony w repo (`apps/runner/deploy/grota-runner.service:13`). Cloudflare Tunnel: `cloudflared tunnel login` → `tunnel create grota-runner-test` (UUID `ab4bb93b-...`) → DNS route `runner.sobiecki.org` → `cloudflared service install` → `systemctl enable --now cloudflared`. Manualnie: skopiowane credentials JSON z `/root/.cloudflared/` do `/etc/cloudflared/` (install.sh tego nie robi — bug). `/health` GET przez tunel: `{"status":"ok","version":"0.1.0"}` ✅. UI server-config: B2 keys + `runner_url=https://runner.sobiecki.org` + `runner_token` + `backup_path=/srv/backup/gdrive`. Test połączenia: OK. Bug w UI: pole `bucketPrefix` domyślnie podpowiada `slugify(clientName)` (`index.tsx:582`) — produkuje mylące wartości jak `sobieckigrota-runner-test`. Przy migrate B2 odrzuca request bo klucz jest restricted do `grota-test-sobiecki`. Po naprawie wartości w UI smoke backup OK: `test.txt` (39B) wgrany do B2 przez pełen pipeline UI → data-service → CF Tunnel → runner → rclone → B2. Bug w UI #2: polling `listMigrationJobs` nie aktualizuje statusu w DB (DB update odbywa się tylko przy GET-by-id). Fix: dodany drugi `useQuery` w `migration.tsx` na `getMigrationJobStatus(activeJob.id)` z `refetchInterval: 2000` — odpala się gdy aktywny job, na zmianę statusu refetchuje listę. Bug do poprawy: AlertDialog migracji kłamie ("przeniesione do konta Google") — runner robi tylko B2 → /srv/backup/gdrive, drugi hop (lokalny → docelowy GDrive z OAuth) nie istnieje.

- **2026-05-07** — Sesja 40 (operator runbook): nowy plik `docs/part-c/improvements/005-admin-ui-migration-trigger-runbook.md` — kompletny runbook end-to-end. 7 sekcji: (1) mapa zmiennych srodowiskowych w tabeli (gdzie ustawic / wartosc / komponent), (2) setup lokalny dev, (3) setup VPS (prereqs + rsync `--no-clone` + CF Tunnel + Cloudflare secrets dla data-service + env user-application), (4) smoke test E2E krok po kroku z konkretnymi komendami, (5) troubleshooting (10+ symptomow → przyczyny → fix, oparte na realnych incydentach z dzisiejszego deploya), (6) rotacja kluczy (GROTA_TOKEN, ENCRYPTION_KEY z ostrzezeniem o re-encrypt, API_TOKEN, B2 keys), (7) co NIE jest pokryte (drugi hop migrate-do-GDrive). Plan section 7 zamkniety.

- **2026-05-07** — Sesja 39 (admin role check — closed): decyzja: kazdy zalogowany + zatwierdzony user (`session.approved === true`) jest adminem panelu. Brak per-deployment ownership check. `protectedFunctionMiddleware` w `core/middleware/auth.ts` juz to gwarantuje (rzuca "Unauthorized"/"Account pending approval"). Zaden kod do dodania. Single-tenant deploy = jednorodne uprawnienia. Jezeli kiedys pojawi sie multi-tenant lub roles (super-admin/admin/viewer), wtedy wprowadzimy Better Auth admin plugin + DB migracja.

- **2026-05-07** — Sesja 38 (live log SSE viewer): nowy TanStack Start API route `/api/migration/jobs/$jobId/logs/stream` (`apps/user-application/src/routes/api/migration/jobs/$jobId/logs/stream.ts`) — proxy SSE z data-service. Auth: `getAuth().api.getSession(request)` + `approved` check (Better Auth session cookie z browsera, bez Bearer w EventSource — który nie wspiera headerów). Body upstream przekazany 1:1, headery `text/event-stream` + `cache-control: no-cache` + `x-accel-buffering: no`. Hook `useMigrationJobLogs(jobId)` w `core/hooks/use-migration-job-logs.ts` — EventSource na relative URL, akumuluje linie (max 5000, FIFO), expose `{lines, connected, error}`. Komponent `LiveLogsPanel` w `migration.tsx` — Card z badge connected/disconnected, checkbox autoscroll, scroll container z monospace. Wyświetla się tylko gdy aktywny job. stderr linie w `text-destructive`. Repo URL w README zaktualizowany na `PiotrSobiecki/grota`. Types OK (tsc --noEmit clean).

- **2026-05-07** — Sesja 37 (install.sh hardening): dodany tryb `--no-clone` w `apps/runner/deploy/install.sh` — pomija `git clone`/`git pull` gdy kod juz jest w `/opt/grota` (np. wgrany przez `tar | scp` dla prywatnych repo / lokalnych branchy). Walidacja: `package.json` musi byc obecny, inaczej exit 3. README rozszerzony o sekcje "Tryb (b) `--no-clone`" z konkretnymi komendami PowerShell + bash. CF Tunnel sekcja w README wyjasnia teraz krok kopiowania credentials JSON z `/root/.cloudflared/` do `/etc/cloudflared/` (operator dzis musial sam to wykombinowac). Bash syntax check OK.

- **2026-05-07** — Sesja TDD 36 (rclone verbose): `buildRcloneSyncArgs` (backup) i `buildRcloneMigrateArgs` (migrate) dodają `-v` do args. Powód: dziś przy smoke teście rclone exit 0 + zerowe logi w buforze → operator nie wiedział czy plik się przeniósł. Z `-v` dostajemy m.in. `INFO  : There was nothing to transfer` albo `Copied (new) ...`. 2 nowe testy unit, 53/53 runner GREEN. Sanityzacja logów (regex na sekrety) wciąż w mocy — `-v` nie wycieka credentiali, tylko meta o transferach.

- **2026-05-07** — Sesja TDD 35 (audit log zmian server-config): nowa domena `data-ops/audit-log` z tabelą `server_config_audit_log` (id uuid pk, deployment_id fk cascade, user_id fk auth_user restrict, changed_fields text[], changed_at timestamp default now). Migracja `0013_cloudy_hercules.sql`. Index `(deployment_id, changed_at desc)`. Queries: `recordServerConfigChange`, `getServerConfigAuditLog`. 2 nowe integration testy data-ops (persists+returns, newest-first + cross-deployment isolation). 21/21 GREEN. W `data-service/migration-service.ts`: `setServerConfigFromAdmin` przyjmuje opcjonalny `triggeredByUserId` jako 4-ty arg, computes diff przez `diffServerConfigFields(prev, next)` (porównuje 6 trackowanych pól: backup_path, bwlimit, ssh_host, ssh_user, runner_url, runner_token), wywołuje `recordServerConfigChange` tylko gdy `triggeredByUserId` ustawiony **i** są zmiany (idempotent save bez zmian = brak audit row). Handler `PUT /deployments/:id/server-config` czyta `X-Operator-Id` header, przekazuje. Frontend `updateServerConfig` w `core/functions/server-config/binding.ts` ustawia `X-Operator-Id: context.userId` z protectedFunctionMiddleware. **Bez wartości w logu** — tylko nazwy pól. 36/36 data-service GREEN.

- **2026-05-07** — Sesja 34 (cosmetic + ops): (a) UI dialog migracji nie kłamie — `migration.tsx` MigrateAllButton/MigrateRowButton mowiły "przeniesione do konta {email}", a runner robi tylko B2 → /srv/backup/gdrive lokalnie. Tekst zaktualizowany: "sciagnie pliki z B2 do lokalnego katalogu na VPSie (`backup_path`); jesli B2 jest pusty, lokalny katalog zostanie wyczyszczony". (b) `grota-runner.service` — dodane `Environment=HOME=/tmp` + `Environment=XDG_CACHE_HOME=/tmp/.cache` żeby rclone mialo gdzie zapisywac plugin cache (był warning "/opt/grota/.cache/rclone/webgui/plugins/config" przez ProtectSystem=strict + brak ReadWritePaths na home grota). PrivateTmp=true wciąż w mocy — /tmp prywatny per service.

- **2026-05-07** — Sesja TDD 33 (Slice 7 — rate limit): kompletny flow per-deployment. `getActiveMigrationJob(deploymentId)` w `data-ops/migration/queries.ts` — zwraca najnowszy job ze status IN ("queued","running") albo null, filtruje po deploymentId (cross-deployment isolation), ignoruje terminal jobs. 4 nowe integration testy data-ops (null bez jobów, returns queued, ignores done/failed→returns running, cross-deployment isolation). 19/19 data-ops GREEN. W `data-service/migration-service.ts`: nowy stan `JOB_ALREADY_RUNNING` (409), `triggerBackup`/`triggerMigrate` early-return z tym kodem gdy `getActiveMigrationJob` zwróci row, **nie wywołują runnera** (asercja przez fetch spy z runner-call counter). Per-deployment, niezależnie od typu (cross-type: aktywny backup blokuje migrate). 3 nowe integration testy data-service (backup blocked, backup proceeds with prior terminal, migrate blocked by active backup). 35/35 data-service GREEN.

- **2026-05-06** — Sesja 31 (Slice 6): VPS deployment artifacts. `apps/runner/deploy/grota-runner.service` — systemd unit (Type=simple, EnvironmentFile=/etc/grota/runner.env, ExecStart=/opt/grota/node_modules/.bin/tsx src/index.ts, Restart=always, hardening: NoNewPrivileges/PrivateTmp/ProtectSystem=strict/ReadWritePaths=/var/backups/grota/ProtectKernelTunables/RestrictRealtime/LockPersonality, LimitNOFILE=65536, journal stdio). `apps/runner/deploy/cloudflared.config.example.yml` — tunnel ingress `localhost:7878` z keepAliveTimeout 7200s (long-running backups), placeholders na UUID + hostname. `apps/runner/deploy/install.sh` (set -euo pipefail) — args: repo URL + branch; tworzy systemowego usera `grota` (nologin), katalogi `/opt/grota`, `/var/backups/grota` (owner grota, 750), `/etc/grota` (owner root, 700); klon/pull repo; `pnpm install --frozen-lockfile` + `pnpm --filter @repo/data-ops build`; generuje 48-znakowy GROTA_TOKEN (head /dev/urandom + base64) do `/etc/grota/runner.env` chmod 600 root, drukuje token na stdout do skopiowania do UI; instaluje + enable + restart systemd unit; smoke check przez `systemctl status` + komenda curl. `apps/runner/deploy/README.md` — pelna dokumentacja: architektura (admin UI → user-app → data-service → CF Tunnel → runner → rclone), wymagania VPS (Node 22, pnpm, rclone, cloudflared), instalacja jednolinijkowa, setup CF Tunnel (login/create/route DNS/service install), smoke test lokalnie i przez tunel, tabela operacji (status/logs/restart/update/rotacja tokenu), bezpieczenstwo (env file 600, hardening systemd, bearer auth, sanityzacja logow, brak public IP).
- **2026-05-06** — Sesja 30 (Slice 4): UI panel migracji. `apps/user-application/src/core/functions/migration/binding.ts` — 4 server fns: `triggerBackupJob`/`triggerMigrateJob` POST do `/admin/migration/{backup,migrate}` z `X-Operator-Id` z `context.userId`; `getMigrationJobStatus` GET `/admin/migration/jobs/:id`; `listMigrationJobs` GET `/admin/migration/jobs?deploymentId&limit&offset`. Wszystkie używają `protectedFunctionMiddleware` + `fetchDataService` + `AppError`. Nowy route `apps/user-application/src/routes/_auth/dashboard/$id/migration.tsx` — Card "Aktywny job" (najnowszy running/queued, polling 2s gdy aktywny przez `refetchInterval` na state.data), Card "Akcje globalne" (`Backup wszystkich`/`Dry-run wszystkich`/`Migruj wszystkich` z AlertDialog confirm), Card "Pracownicy" (lista z badgem Gotowy/Niegotowy + per-row Backup/Dry-run/Migruj, Migruj z AlertDialog confirm), Card "Historia" (lista jobów z status badge, typem, account, czasem startu, duration, exit code). Wszystkie buttony disabled gdy active job (single-job-at-a-time invariant w UI, wzmocniony przez 409 z runnera). Link do `/dashboard/$id/migration` dodany w `dashboard/$id/index.tsx` obok "Eksportuj konfiguracje" (gdy status=ready/active). Types OK. Frontend test browserowy do zrobienia po wpieciu z runnerem na realnej sciezce (data-service → runner). **Brakuje**: live log viewer (SSE EventSource w UI) — proxy w data-service juz dziala (sesja 22), wystarczy wrapper React po stronie klienta (osobna sesja).
- **2026-05-06** — Sesja TDD 29: sanityzacja logów w runnerze. `apps/runner/src/sanitize-log.ts` — pure `sanitizeLogLine(line)` z regex patterns: `Bearer ...`, rclone-style `account = ...` / `key = ...`, query/JSON `app_key=`, JSON `"refresh_token"|"access_token"|"app_key"|"api_key"|"password":"..."`, env exposure `GROTA_TOKEN|API_TOKEN|RUNNER_TOKEN|ENCRYPTION_KEY=...`. Każdy match podmieniany na `***REDACTED***`. Wpięte w `emit` callback w `createApp` (`app.ts`) — sanityzacja przed `RingBuffer.push` i fan-out do subskrybentów, więc **plaintext sekrety nie trafiają nigdzie** (snapshot JSON, SSE replay, live SSE). 6 unit testów + 1 end-to-end test w `app.test.ts` (emit linijki z `account=K001abc, key=supersecret`, GET /logs, asercja że ani K001abc ani supersecret nie ma w response). 51/51 runner GREEN, types OK.

- **2026-05-06** — Sesja TDD 25-28: realny pipeline backup/migrate przez runner. (25) `RunnerJobConfigSchema` w `@repo/data-ops/migration` (`b2KeyId`/`b2AppKey`/`bucketPrefix`/`backupPath` required, `bwlimit` optional) + `BackupRequestSchema`/`MigrateRequestSchema` rozszerzone o opcjonalny `runnerConfig`; 7 nowych unit testów, 22/22 GREEN. (26) `apps/runner/src/run-backup.ts`: pure helpers `buildRcloneB2Config`/`buildRcloneSyncArgs` (z opcjonalnym `--bwlimit`) + factory `createRunBackup(SpawnRcloneFn)` (exit=1 + stderr log gdy brak `runnerConfig`, w przeciwnym razie spawn `rclone sync $backupPath b2:$bucketPrefix --config <tmp> [--bwlimit X]`); `realRcloneSpawnForBackup` pisze rclone.conf do `mkdtemp(grota-rclone-backup-*)` chmod 600, używa `spawnJob` (line-by-line stdout/stderr capture do `LogEmitter`), sprząta w finally; 7 testów. (27) `apps/runner/src/run-migrate.ts` — lustrzanka, `buildRcloneMigrateArgs` (`sync b2:→path` + opcjonalny `--dry-run`); 5 testów. Wpięte w `apps/runner/src/index.ts` jako real impl. (28) `data-service`: helper `buildRunnerJobConfig(deployment, serverConfig)` w `migration-service.ts` zwraca `RunnerJobConfig | null` z `deployment.b2Config` + `serverConfig.backup_path`/`bwlimit`; nowy stan `CONFIG_INCOMPLETE` ("Brak konfiguracji B2 lub backup_path") obok istniejącego dla `runner_url/runner_token`; body POST do runnera teraz zawiera pełen `runnerConfig`. Existing integration testy zaktualizowane (assert na `body.runnerConfig` + `body.account`) + nowy test CONFIG_INCOMPLETE-no-B2. **44/44 runner + 32/32 data-service integration GREEN**, types OK we wszystkich pakietach.

- **2026-05-05** — Sesja TDD 1: walidator `validateBandwidthLimit` w `packages/data-ops/src/deployment/server-config-schema.ts` (12 testów, GREEN). Vitest dodany do `data-ops`. Branch: `feat/admin-migration-trigger`.
- **2026-05-05** — Audyt: `ServerConfigSchema` i `B2ConfigSchema` już istnieją w `deployment/schema.ts` jako JSONB. **Migracja DB nie jest potrzebna** — pola lecą do istniejących kolumn `b2_config` / `server_config`. `ssh_host` / `ssh_user` zostają (opcjonalne, do diagnostyki).
- **2026-05-05** — Sesja TDD 2: `ServerConfigSchema.bwlimit` ma teraz `superRefine(validateBandwidthLimit)`. 3 nowe testy (zły bwlimit odrzucony, valid multi-slot, error path = `bwlimit`). 15/15 GREEN, build OK. Dodany `vitest.config.ts` (include `src/**/*.test.ts`) + `tsconfig.json` exclude testów z buildu.
- **2026-05-05** — Sesja TDD 3: `runner_url` (z `.url()`) + `runner_token` (z `.min(1)`) jako opcjonalne pola w `ServerConfigSchema`. 4 nowe testy. 19/19 GREEN, build OK. Backward compat dla configów bez runner fields zachowana.
- **2026-05-05** — Sesja TDD 4: nowa domena `packages/data-ops/src/migration/` z `runner-protocol.ts` (Zod kontrakt runner ↔ data-service). Schematy: `RunnerJobStatus`, `RunnerJob`, `BackupRequest`, `MigrateRequest` (default dryRun=false), `JobCreatedResponse`, `LogLine`. 15 testów. 34/34 GREEN, build OK. Eksport `@repo/data-ops/migration` dodany do package.json.
- **2026-05-05** — Sesja TDD 5: `maskSecret(value)` w `packages/data-ops/src/encryption/mask.ts`. Format: 4 + `****` + 4. Sekrety < 9 znaków → `****`. Pusty string passthrough. 4 testy, 38/38 GREEN, build OK. Użyte przez handler GET `/server-config` (sekrety zamaskowane przed wysłaniem do UI).
- **2026-05-05** — Sesja 6: setup integration tests. `vitest.integration.config.ts`, `src/test/integration-setup.ts` (initDatabase + truncate beforeEach), skrypt `pnpm test:integration` (dotenvx z `.env.dev` — istniejąca baza dev to test DB). Tracer bullet `smoke.integration.test.ts` przeszedł. Unit (38/38) i integration (1/1) działają niezależnie.
- **2026-05-05** — Sesja TDD 7: pierwszy realny query z TDD-DB. `getDeploymentServerConfig(deploymentId)` w `deployment/queries.ts` zwraca `ServerConfig | null`. Fixtury `createTestUser` + `createTestDeployment` w `src/test/fixtures.ts`. 3 integration testy (null gdy brak configu, zwraca zapisany config, null dla nieistniejącego id). 4/4 integration GREEN. Truncate poszerzony o `auth_*` żeby fixtury były czyste.
- **2026-05-05** — Sesja TDD 8: encryption layer dla `ServerConfig`. Pure unit `encryptServerConfig(config, key)` / `decryptServerConfig(config, key)` w `encryption/server-config.ts` szyfrują tylko `runner_token` (AES-256-GCM, format `iv_hex:cipher_hex`). Integration test E2E roundtrip: encrypt → `setDeploymentServerConfig` → `getDeploymentServerConfig` → decrypt = original. Queries operują na plaintext JSONB (zgodnie z istniejącym wzorcem `setWorkspaceOAuthToken`). 42/42 unit + 5/5 integration.
- **2026-05-05** — Sesja 9: setup integration tests w `apps/data-service` (vitest + dotenvx z `.dev.vars`). Przeniesiony `resetTestDatabase()` z setup do `data-ops/test-fixtures` (reusable). Dodany subpath export `@repo/data-ops/test-fixtures` + barrel `@repo/data-ops/encryption` (encrypt/decrypt/mask/server-config). `getDeploymentServerConfig` + `setDeploymentServerConfig` wyeksportowane z `deployment` barrel.
- **2026-05-05** — Sesja TDD 9.1: pierwszy serwis `getServerConfigForAdmin(deploymentId, encryptionKey)` w `migration-service.ts`. Zwraca `Result<ServerConfig | null>`: NOT_FOUND dla nieistniejącego deployment, null gdy brak configu, w innych przypadkach decrypt + mask `runner_token` (4+`****`+4). 3 integration testy GREEN, types OK.
- **2026-05-05** — Sesja 9.2: handler `GET /deployments/:id/server-config` w `deployment-handlers.ts` (auth middleware + `zValidator(DeploymentIdParamSchema)` + `migrationService.getServerConfigForAdmin(id, c.env.ENCRYPTION_KEY)` + `resultToResponse`). Bez własnego HTTP-test (logika pokryta przez integration test serwisu — handler to thin wrapper). Types OK, integration 3/3 nadal GREEN.
- **2026-05-05** — Sesja TDD 10: serwis `setServerConfigFromAdmin(deploymentId, partial, encryptionKey)`. Behaviors: NOT_FOUND dla brakującego deployment, fresh save z szyfrowaniem `runner_token`, merge partial update z istniejącym (untouched fields preserved). 3 nowe integration testy. 6/6 GREEN.
- **2026-05-05** — Sesja 10.2: handler `PUT /deployments/:id/server-config` + nowy `ServerConfigUpdateRequestSchema = ServerConfigSchema.partial()` w `data-ops/deployment/schema.ts`. Wszystkie pola opcjonalne — admin wysyła tylko to co zmienia. Build OK, types OK, integration 6/6 GREEN.
- **2026-05-05** — Sesja TDD 11: serwis `testRunnerConnection(deploymentId, encryptionKey)` w `migration-service.ts`. Behaviors: NOT_FOUND, CONFIG_INCOMPLETE (brak runner_url/runner_token lub b2Config), happy path POST do `runner_url/verify` z Bearer token i B2 keys, propagacja błędu z runnera, RUNNER_UNREACHABLE przy network error. 6 nowych integration testów z mockowanym `globalThis.fetch` (selektywnie — tylko URL runnera; DB queries lecą do prawdziwego Neon). Naprawione: `fileParallelism: false` (literówka) w obu vitest.integration.config.ts. 12/12 GREEN.
- **2026-05-05** — Sesja 11.2: handler `POST /deployments/:id/server-config/test` → `migrationService.testRunnerConnection`. Types OK.
- **2026-05-06** — Sesja TDD 12 (Slice 1 start): nowy app `apps/runner/` (Hono + `@hono/node-server` na Node, bo runner musi spawnować `rclone`/`grota` na VPS — Hono dla spójności z `data-service`). Tracer bullet: `createApp({ token, version })` w `src/app.ts` z `bearerAuth("*")` + `GET /health` → `{ status: "ok", version }`. 3 testy: happy path z Bearer (200), brak Authorization (401), zły token (401). 3/3 GREEN, types OK. Stack: hono 4.12, @hono/node-server, vitest, tsx.
- **2026-05-06** — Sesja 23 (Slice 0 frontend): rozszerzenie istniejącego `ServerConfigCard` w `apps/user-application/src/routes/_auth/dashboard/$id/index.tsx` zamiast osobnego route (cohesion — wszystko "konfiguracja serwera" w jednej karcie). Nowy `core/functions/server-config/binding.ts` (3 server fns: `getServerConfig` masked, `updateServerConfig` partial+encrypted, `testRunnerConnection`). Karta: useQuery na masked config, badge "Runner: Skonfigurowany/Nieskonfigurowany", przycisk [Testuj połączenie] obok [Pencil] (visible gdy runner skonfigurowany), pola `runnerUrl` + `runnerToken` w sekcji Zaawansowane. Mutacja split: B2 → `updateExistingDeployment` (plaintext JSONB), serverConfig (incl. runner) → `updateServerConfig` (encrypted+merge by backend). Maskowanie: runner_token z GET pokazuje `abcd****wxyz` w polu; przy save pomijany jeśli user go nie zmienił (porównanie value === maskedValue). Toast OK/error po teście. Types OK; lint warning na complexity 20 vs 15 (do refactoru). **Browser test**: nie wykonany w tej sesji — trzeba zweryfikować e2e po stronie usera (otworzyć `/dashboard/{id}`, edycja, save, test).
- **2026-05-06** — Sesja TDD 22: SSE log passthrough. `streamJobLogs(jobId, encryptionKey)` w `migration-service.ts` zwraca `Result<Response>` — fetch GET `runner_url/jobs/:runnerJobId/logs/stream` z Bearer, propaguje upstream Response. Stany: NOT_FOUND / CONFIG_INCOMPLETE / RUNNER_UNREACHABLE. Handler `GET /admin/migration/jobs/:id/logs/stream` zwraca `result.data` bezpośrednio (zachowuje `text/event-stream` + body stream — Hono passthrough). 4 nowe integration testy (NOT_FOUND, CONFIG_INCOMPLETE, happy-path z asercją URL+Bearer+SSE body, RUNNER_UNREACHABLE). 31/31 GREEN, types OK.
- **2026-05-06** — Sesja TDD 21: (a) `listMigrationJobs({ deploymentId, limit, offset })` query — `WHERE deployment_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?` (uses idx). 2 nowe integration testy data-ops (empty, filter+order+pagination across 2 deployments). 15/15 GREEN. (b) cienki serwis `listMigrationJobsForAdmin` (passthrough do query, pasuje `resultToResponse`) + handler `GET /admin/migration/jobs` z `zValidator("query", MigrationJobListRequestSchema)` (deploymentId required, limit default 50, offset default 0). 27/27 GREEN data-service.
- **2026-05-06** — Sesja TDD 20: handler `GET /admin/migration/jobs/:id` (zValidator `MigrationJobIdParamSchema` + `getMigrationJobStatus` + `resultToResponse`). Thin wrapper, logika pokryta przez integration test serwisu. 27/27 GREEN, types OK.
- **2026-05-06** — Sesja TDD 19: (a) `updateMigrationJobStatus(id, { status, exitCode? })` w `data-ops/migration/queries.ts` — patch status, opcjonalny `exitCode`, automatyczny `finishedAt = now()` przy terminal (`done`/`failed`). 4 nowe integration testy data-ops (null dla unknown id, running bez finishedAt, done z finishedAt+exitCode, failed z exitCode). 13/13 GREEN. (b) `getMigrationJobStatus(jobId, encryptionKey)` w `migration-service.ts`: NOT_FOUND dla unknown, terminal job — zwraca z DB bez fetch z runnera, non-terminal — GET `runner_url/jobs/:runnerJobId` z Bearer, jeśli runner zwróci nowy status to `updateMigrationJobStatus` + zwróć fresh row. **Graceful degradation**: brak runner config / network error / non-2xx / invalid response → zwróć stale DB row (nie błąd, lepsze UX dla pollingu). 4 nowe integration testy data-service (NOT_FOUND, terminal-skip-runner z asercją zerowych runner calls, non-terminal-update-DB z asercją URL+Bearer, runner-unreachable-stale). 27/27 GREEN.
- **2026-05-06** — Sesja TDD 18: `triggerMigrate(input)` w `migration-service.ts` (lustrzanka `triggerBackup` + `dryRun`). Stany identyczne: NOT_FOUND / CONFIG_INCOMPLETE / RUNNER_UNREACHABLE / RUNNER_REJECTED / RUNNER_INVALID_RESPONSE. POST do `runner_url/jobs/migrate` z body `{ account?, dryRun }` (default false), persist `migration_jobs` z `type='migrate'` + `dry_run`. Handler `POST /admin/migration/migrate` (zValidator `TriggerMigrateRequestSchema`, 202). 5 nowych integration testów (tracer happy-path z dryRun=true + body assert, NOT_FOUND, CONFIG_INCOMPLETE, dryRun default=false forwarded, RUNNER_UNREACHABLE, RUNNER_REJECTED). 23/23 GREEN, types OK.
- **2026-05-06** — Sesja TDD 17 (Slice 3 start): tabela `migration_jobs` + proxy w `data-service`.
  - **data-ops**: nowa domena `src/migration/` (table + schema + queries). Tabela `migration_jobs` (id uuid pk, deployment_id fk cascade, type enum backup/migrate, account text nullable=all, dry_run bool, status enum queued/running/done/failed, runner_job_id uuid notnull, started_at default now, finished_at, exit_code, triggered_by_user_id fk auth_user restrict). Index `(deployment_id, started_at desc)`. Migracja `0012_nice_may_parker.sql` wygenerowana i zaaplikowana na dev DB. Drizzle relations dodane (deployment ↔ migrationJobs, triggeredBy ↔ auth_user). Wszystkie 3 drizzle-{dev,staging,production}.config.ts dostały migration/table.ts w schema array. Zod schemas: `MigrationJobSchema`, `TriggerBackupRequestSchema`, `TriggerMigrateRequestSchema` (default dryRun=false), `MigrationJobListRequestSchema`. Queries: `createMigrationJob`, `getMigrationJob`. Barrel `@repo/data-ops/migration` rozszerzony. **Testy**: 10 unit dla schema, 4 integration dla queries → 52 + 9 = 61 GREEN w data-ops.
  - **data-service**: `triggerBackup({ deploymentId, account?, triggeredByUserId, encryptionKey })` w `migration-service.ts`. Decrypt server-config, POST do `runner_url/jobs/backup` z Bearer + body `{ account? }`, parse `JobCreatedResponseSchema`, persist `migration_jobs` row, return `MigrationJob`. Stany: NOT_FOUND / CONFIG_INCOMPLETE / RUNNER_UNREACHABLE (network) / RUNNER_REJECTED (non-2xx) / RUNNER_INVALID_RESPONSE. Nowy handler `POST /admin/migration/backup` z auth middleware + zValidator + `resultToResponse` (status 202). Route zarejestrowana pod `/admin/migration` w `app.ts`. **Testy**: 5 integration (NOT_FOUND, CONFIG_INCOMPLETE, happy-path z weryfikacją body i headers + persistence, RUNNER_UNREACHABLE, RUNNER_REJECTED). 17/17 integration GREEN, types OK.
  - Auth admin role check (Better Auth) — TODO; obecnie polega na `API_TOKEN` jak inne admin endpointy.
- **2026-05-06** — Sesja TDD 16 (Slice 2): log capture + SSE w runnerze.
  - `src/spawn-job.ts` — helper `spawnJob({ command, args, env, onLog })` → `Promise<{exitCode}>` z line-by-line capture stdout/stderr (CRLF tolerant), `onLog(LogLine)` per linia. 5 testów spawnujących real Node przez `process.execPath`: success+stdout, failure+stderr+exitCode, env passthrough, LogLine shape, nonexistent command (exitCode≠0).
  - `src/ring-buffer.ts` — generic `RingBuffer<T>(capacity)` z FIFO eviction. 3 testy.
  - `RunBackupFn` / `RunMigrateFn` rozszerzone o 3-ci arg `emitLog: LogEmitter`. Per-job ring buffer (5000 linii) zasilany przez `emit`. Endpoint `GET /jobs/:id/logs` → JSON snapshot. 2 testy: lines forwarded + 404.
  - **SSE**: `GET /jobs/:id/logs/stream` używa `hono/streaming` `streamSSE`. Replay buffera → subskrypcja przez `Set<sub>` na jobie → push live linii → zamknięcie gdy `finishWaiters` zostaną wywołane (refactor `finalize()` notyfikuje czekających). 2 testy: replay+live+close, 404. Test używa real ReadableStream reader na `app.request()` body — sprawdza `text/event-stream` content-type i obecność `"line":"..."`.
  - 28/28 GREEN, types OK.
- **2026-05-06** — Sesja TDD 15: `POST /jobs/migrate` (per-type concurrency) + entrypoint runnera. Refactor: `createJob<T>()` helper + `jobRoute<T>()` factory, `InternalJob extends RunnerJob & { type: 'backup' | 'migrate' }`, GET strippuje `type`. 4 nowe testy: migrate happy path z `runMigrate` mock + dryRun default false, dryRun=true forwarded, 409 dla równoczesnego migrate, **per-type concurrency** (backup running pozwala na migrate). Entrypoint `src/index.ts` z `@hono/node-server`, env `GROTA_TOKEN` (required) + `GROTA_PORT` (default 7878). **Smoke test E2E**: runner odpalony lokalnie, `/health` 401/200, POST `/jobs/backup` → 202+jobId, GET stripped (`failed`+exitCode=1 z default fallback). 16/16 testów GREEN, types OK. **Plumbing fix**: data-ops dostało `"type": "module"` w package.json + `src/migration/index.ts` używa `.js` ext przy re-eksporcie — Node ESM wymaga obu (vitest/Wrangler/Vite były tolerancyjne, tsx z Node 22 nie). data-service types/tests + data-ops unit (42/42) potwierdzone GREEN po zmianie.
- **2026-05-06** — Sesja TDD 14: `POST /jobs/backup` + `GET /jobs/:id` w runnerze. In-memory `Map<jobId, RunnerJob>`. DI `runBackup: (jobId, BackupRequest) => Promise<exitCode>`. POST waliduje przez `BackupRequestSchema`, generuje uuid, zapisuje `running` job, fire-and-forget odpala `runBackup`, na resolve aktualizuje `done` (exitCode=0) / `failed` (exitCode≠0 lub reject). Concurrency: tylko 1 aktywny job (queued/running) — kolejny POST → 409. GET zwraca `RunnerJob` lub 404. 5 nowych testów: tracer (POST 202 + jobId, GET running), 404 unknown, lifecycle done, lifecycle failed (exit 3), 409 concurrent. 12/12 GREEN, types OK.
- **2026-05-06** — Sesja TDD 13: `POST /verify` w runnerze. Nowe schematy w `@repo/data-ops/migration`: `B2VerifyRequestSchema` (`b2KeyId`/`b2AppKey`/`bucketPrefix`, każde `min(1)`) + `B2VerifyResponseSchema` (`{ok, error?}`). `createApp` przyjmuje opcjonalny `verifyB2: VerifyB2Fn` (DI — mock w testach, real shell-out do `rclone` w prod). Handler używa `zValidator("json", B2VerifyRequestSchema)` i przekazuje body do verifyB2. 4 nowe testy: happy path (verifyB2 zwraca `{ok:true}`, body forwarded), failure path (`{ok:false, error}` propagowane), invalid body → 400 (zValidator), brak Bearer → 401. 7/7 GREEN, types OK.

---

## 0. Konfiguracja serwera w UI (prerequisite)

Admin konfiguruje runner z poziomu UI — żadnego `grota setup b2` ręcznie na VPS. Config trzymany w DB (szyfrowane sekrety), wysyłany do runnera w body każdego joba; runner generuje `rclone.conf` on-the-fly i nie persystuje sekretów na dysku.

### Schema (`packages/data-ops`)

**Aktualny stan**: `b2_config` i `server_config` istnieją jako JSONB na `deployments`. Brak nowej migracji DB.

- [x] `validateBandwidthLimit` — pure validator (sesja TDD 1)
- [x] `ServerConfigSchema.bwlimit` — `superRefine(validateBandwidthLimit)` (sesja TDD 2)
- [x] Rozszerzyć `ServerConfigSchema`:
  - [x] Zostawić `ssh_host` / `ssh_user` jako opcjonalne (do diagnostyki/awaryjnego dostępu)
  - [x] Dodać refinement na `bwlimit`
  - [x] Dodać `runner_url` (z walidacją URL, opcjonalne)
  - [x] Dodać `runner_token` (min 1 znak, opcjonalne — szyfrowanie at-rest robione na warstwie query, nie schema)
- [x] ~~`config_version`~~ — **wycofane (YAGNI)**: runner dostaje config w body każdego joba, więc nie potrzebuje śledzić wersji
- [x] Encryption helpers `encryptServerConfig` / `decryptServerConfig` w `encryption/server-config.ts` (sesja TDD 8)
- [x] Queries: `getDeploymentServerConfig` + `setDeploymentServerConfig` (sesja TDD 7-8)
- [x] `maskSecret(value)` helper dla response (sesja TDD 5)
- [x] Kontrakt runner ↔ data-service: `@repo/data-ops/migration` (sesja TDD 4)

### Handlery (`apps/data-service`)

- [x] Service `getServerConfigForAdmin` (decrypt + mask, sesja 9.1)
- [x] `GET /deployments/:id/server-config` (handler w `deployment-handlers.ts`, sesja 9.2)
- [x] Service `setServerConfigFromAdmin` (partial merge + encrypt + save, sesja TDD 10)
- [x] `PUT /deployments/:id/server-config` (handler + `ServerConfigUpdateRequestSchema = ServerConfigSchema.partial()`, sesja 10.2)
- [x] Service `testRunnerConnection` (decrypt config + POST do runnera /verify, sesja TDD 11)
- [x] `POST /deployments/:id/server-config/test` (handler, sesja 11.2). Stany: NOT_FOUND / CONFIG_INCOMPLETE / RUNNER_UNREACHABLE / { ok, error? } z runnera

### CLI runner: nowy endpoint

- [x] `POST /verify` body: `{ b2KeyId, b2AppKey, bucketPrefix }` → handler + walidacja + DI `verifyB2Fn` (sesja TDD 13). Real `createVerifyB2(realRcloneSpawn)` (sesja TDD 24): `buildRcloneConfig` (pure) + `RcloneSpawnFn` DI, real impl pisze rclone.conf do mkdtemp(`grota-rclone-*`) chmod 600, spawn `rclone --config <tmp> lsd b2:`, sprzata temp dir w finally. 4 testy unit (config builder + 3 verify behaviors z mock spawn). Wpięte w `index.ts`.
- [x] Endpointy `/jobs/backup` i `/jobs/migrate` przyjmują `runnerConfig` w body — runner buduje rclone.conf przed spawnem komendy, czyści po sobie (sesje TDD 25-28: `RunnerJobConfigSchema` w `@repo/data-ops/migration`, `createRunBackup`/`createRunMigrate` w `apps/runner` z DI `SpawnRcloneFn`, `realRcloneSpawnForBackup` pisze conf do mkdtemp chmod 600, sprząta w finally; data-service `triggerBackup`/`triggerMigrate` builduje `runnerConfig` z `deployment.b2Config` + `serverConfig.backup_path`/`bwlimit` i forwarduje w body)
- [x] Sanityzacja: sekrety nigdy nie trafiają do logów joba (sesja TDD 29: `apps/runner/src/sanitize-log.ts` — pure `sanitizeLogLine` z regexami na `Bearer …`, `account = …`, `key = …`, `app_key=…`, JSON `"refresh_token"|"access_token"|"app_key"|"api_key"|"password"`, env `GROTA_TOKEN|API_TOKEN|RUNNER_TOKEN|ENCRYPTION_KEY=…`. Wpięte w `emit` w `app.ts` — sanityzacja przed zapisem do ring buffera, więc sekrety nie trafiają ani do JSON snapshot, ani do SSE, ani do replayu. 6 unit testów + 1 app-level test końcowy.)

### UI (`user-application`)

Nowy route `/admin/deployments/$id/server-config`:
- [x] Formularz: B2 Key ID, App Key, Bucket Prefix, Backup Path, Bandwidth Limit (+ opcjonalne `sshHost`/`sshUser` w sekcji "Zaawansowane") (sesja TDD 23 — rozszerzenie istniejącego `ServerConfigCard`, nie osobny route)
- [x] Sekcja "Zaawansowane" zwijana (już była)
- [x] Walidacja po stronie klienta (Zod) + serwera (Zod schemy z `@repo/data-ops`)
- [x] Przycisk `[Zapisz]` + `[Testuj połączenie]` (wywołuje `/server-config/test`) (sesja TDD 23)
- [x] Status badge: "Skonfigurowany" / "Nieskonfigurowany" — plus toast po teście (sesja TDD 23)
- [x] Maskowanie sekretów przy edycji: runner_token z GET masked (`abcd****wxyz`), pole pomijane przy save jeśli user nie wpisał nowej wartości (sesja TDD 23)

### Bezpieczeństwo

- [x] Sekrety szyfrowane at-rest (`runner_token` przez `encryptServerConfig` AES-256-GCM, sesja TDD 8; `b2_config.app_key` przez `encryptB2Config`, key_id i bucket_prefix plaintext bo nie sa tajne)
- [x] TLS 1.3 między `data-service` a runnerem (Cloudflare Tunnel terminuje TLS na CF edge, hop CF→origin tez TLS przez `cloudflared`)
- [x] Sekrety nie logowane (sesja TDD 29: `sanitizeLogLine` regex maskuje Bearer/account=/key=/app_key=/JSON token fields/ENV exposure przed zapisem do ring buffera; pdoc-przewidziane `migration_jobs.logs` w DB nie istnieje — logi tylko in-memory)
- [x] Audit log zmian config (kto, kiedy, które pole — bez wartości) — sesja TDD 35

---

## 1. CLI: tryb HTTP serve (`apps/cli`)

Nowa komenda: `grota serve --port 7878 --token $GROTA_TOKEN`

### Endpointy

Schematy request/response zdefiniowane w `@repo/data-ops/migration` (sesja TDD 4).

- [x] `GET /health` → `{ status: 'ok', version }` (sesja TDD 12)
- [x] `POST /jobs/backup` (`BackupRequestSchema` → `JobCreatedResponseSchema`) (sesja TDD 14, response = `{ jobId }`, 202)
- [x] `POST /jobs/migrate` (`MigrateRequestSchema` → `JobCreatedResponseSchema`) (sesja TDD 15)
- [x] `GET /jobs/:id` → `RunnerJobSchema` (sesja TDD 14, 404 dla nieznanych)
- [x] `GET /jobs/:id/logs` (JSON snapshot) + `GET /jobs/:id/logs/stream` (SSE z replayem buffera + live emits + close on finish) (sesja TDD 16). Reconnect z Last-Event-ID — TODO.

### Auth & state

- [x] Middleware `Authorization: Bearer $GROTA_TOKEN` na każdym endpoincie (sesja TDD 12 — `bearerAuth("*")` w `createApp`)
- [x] In-memory `Map<jobId, RunnerJob>` (sesja TDD 14). TTL po `finishedAt` — TODO
- [x] Ring buffer logów per job (5000 linii) — replay przy SSE connect (sesja TDD 16)
- [x] Tylko 1 aktywny job danego typu naraz — 409 Conflict, per-type (sesje TDD 14-15)

---

## 2. VPS deployment

- [x] Systemd unit `apps/runner/deploy/grota-runner.service` (auto-restart, logi do journald, hardening: NoNewPrivileges + ProtectSystem=strict + PrivateTmp + ReadWritePaths=/var/backups/grota) (sesja 31)
- [x] Token w `/etc/grota/runner.env` (chmod 600, owner root, generowany losowo w install.sh)
- [x] Cloudflare Tunnel → `apps/runner/deploy/cloudflared.config.example.yml` (template z UUID/hostname placeholders, ingress `localhost:7878`, keepAliveTimeout 7200s dla long-running jobs)
- [x] Skrypt instalacyjny `apps/runner/deploy/install.sh` — tworzy `grota` user (nologin), klonuje repo, `pnpm install` + buduje data-ops, generuje token, instaluje systemd unit, restart service, smoke check
- [x] Dokumentacja `apps/runner/deploy/README.md` — wymagania VPS, instalacja runnera, setup Cloudflare Tunnel, smoke test, operacje (status/logs/restart/update/rotacja tokenu), bezpieczenstwo

---

## 3. `data-service`: proxy + persystencja

### Schema (`packages/data-ops`)

- [x] Migracja: tabela `migration_jobs` (sesja TDD 17 — 0012_nice_may_parker.sql, zaaplikowane na dev). Kolumny i index zgodne ze specem.
- [x] Zod schemas + `createMigrationJob` + `getMigrationJob` (sesja TDD 17). `updateMigrationJobStatus` (sesja TDD 19). `listMigrationJobs` (sesja TDD 21).

### Handlery (`apps/data-service/src/hono/handlers/migration-handlers.ts`)

- [x] `POST /admin/migration/backup` body: `{ deploymentId, account? }` (sesja TDD 17)
- [x] `POST /admin/migration/migrate` body: `{ deploymentId, account?, dryRun? }` (sesja TDD 18)
- [x] `GET /admin/migration/jobs/:id` → status + metadane (sesja TDD 19-20)
- [x] `GET /admin/migration/jobs/:id/logs/stream` (SSE passthrough z runnera, sesja TDD 22)
- [x] `GET /admin/migration/jobs?deploymentId=...` → historia (paginated, last 50, sesja TDD 21)

### Service (`migration-service.ts`)

- [ ] `RUNNER_URL` + `RUNNER_TOKEN` per deployment (Worker secrets lub kolumna w `deployments`)
- [ ] Forward request → runner, save job do DB, return `Result<T>`
- [ ] Background fetch statusu z runnera + update DB (cron / on-demand przy GET)
- [ ] Sanityzacja logów przed wysłaniem do UI (regex na `Bearer ...`, `refresh_token=...`)

### Auth

- [ ] Sprawdzenie roli admin (Better Auth) w middleware tras `/admin/migration/*`
- [ ] Tylko admin tego deployment może triggerować jego migrację

---

## 4. `user-application`: UI admina

Nowy route `/_auth/dashboard/$id/migration`:

- [x] Sekcja "Pracownicy" — lista employees z badgem Gotowy/Niegotowy (OAuth `authorized` + selection `completed`) (sesja TDD 30)
- [x] Per wiersz: przyciski `[Backup]` `[Dry-run]` `[Migruj]` (Dry-run/Migruj disabled gdy niegotowy)
- [x] Globalne akcje: `[Backup wszystkich]` `[Dry-run wszystkich]` `[Migruj wszystkich]`
- [x] Panel aktywnego joba: status badge (queued/running/done/failed), czas trwania (computed), exit code
- [x] Live log viewer (SSE) z auto-scroll — sesja 38 (proxy w user-application route + `useMigrationJobLogs` hook + `LiveLogsPanel` komponent)
- [x] Historia ostatnich 50 jobów (lista wierszy: badge + typ + dryRun + account + startedAt + duration + exitCode)
- [x] Confirm dialog przed `Migruj` (AlertDialog na per-row i globalnym buttonie, opisuje destrukcyjnosc)
- [x] Server functions wołają `data-service` przez `fetchDataService` (`core/functions/migration/binding.ts`: `triggerBackupJob`, `triggerMigrateJob`, `getMigrationJobStatus`, `listMigrationJobs`; przekazuje `X-Operator-Id` z sesji)
- [x] Mutacje: TanStack Query, polling listy jobów co 2s gdy ktorykolwiek `running`/`queued` (refetchInterval na podstawie state.data) — fallback dla braku SSE

---

## 5. Bezpieczeństwo

- [x] Tylko zalogowany + zatwierdzony user wywola endpointy migracji — sesja 39 (decyzja: protectedFunctionMiddleware sufficient; user nie ma swoich danych logowania, panel obsluguje admin)
- [ ] `RUNNER_TOKEN` rotowalny (env w Workerze + `/etc/grota/runner.env`)
- [x] Rate limit na `data-service`: max 1 globalna migracja w toku per deployment (409) — sesja TDD 33
- [ ] Sanityzacja logów: maskowanie tokenów / refresh_tokens / OAuth credentials przed wysłaniem do UI
- [ ] Audit log: kto i kiedy odpalił migrację (`triggered_by_user_id` w `migration_jobs`)

---

## 6. Kolejność prac (vertical slices)

Każdy slice deployowalny i testowalny osobno.

- [ ] **Slice 0**: Server config — schema + handlery + UI form + `/verify` endpoint w runnerze (prerequisite)
- [ ] **Slice 1**: CLI `serve` + `/health` + `/jobs/backup` + token auth — testowane lokalnie curlem
- [ ] **Slice 2**: Job tracking + SSE logs w CLI (ring buffer, reconnect)
- [ ] **Slice 3**: Tabela `migration_jobs` + handlery proxy w `data-service` (bez UI, testowane curlem)
- [ ] **Slice 4**: UI — lista pracowników + przycisk Backup (najprostszy E2E happy path)
- [ ] **Slice 5**: Migrate + dry-run (CLI + UI)
- [x] **Slice 6**: Cloudflare Tunnel + systemd unit + skrypt instalacyjny (deploy na realnym VPS) — `apps/runner/deploy/{install.sh,grota-runner.service,cloudflared.config.example.yml,README.md}`
- [ ] **Slice 7**: Hardening — sanityzacja logów ✅, historia jobów ✅, confirm dialog ✅, rate limit per-deployment ✅ (TDD 33), **audit log zmian config** ✅ (TDD 35), admin role check Better Auth (TODO)
- [x] **Slice 8**: Operator runbook — `docs/part-c/improvements/005-admin-ui-migration-trigger-runbook.md` (sesja 40)

Estymacja: slice 1-4 ≈ 2-3 dni; całość ≈ tydzień roboczy.

---

## 7. Operator runbook (TODO)

Dokumentacja end-to-end "jak postawic i przetestowac caly migration flow" — pull together wszystkie zmienne srodowiskowe, miejsca ich ustawienia, kolejnosc startu, smoke testy. Dziś info jest rozsiane po `apps/runner/deploy/README.md` (tylko VPS), `CLAUDE.md` (tylko convention), `.env.example` (tylko data-service) i pdoc — operator nie ma jednego miejsca.

- [ ] Plik: `docs/part-c/improvements/005-admin-ui-migration-trigger-runbook.md` (lub `apps/runner/RUNBOOK.md` — do decyzji)
- [ ] **Sekcja 1: Mapa zmiennych srodowiskowych** — tabela: zmienna | gdzie ustawic | wartosc/skad | komponent ktory jej uzywa. Pokrycie:
  - `data-service` (`apps/data-service/.dev.vars` lokalnie / Cloudflare secrets prod): `DATABASE_HOST/USERNAME/PASSWORD`, `API_TOKEN`, `ENCRYPTION_KEY` (32 bajty hex), `CLOUDFLARE_ENV`
  - `user-application` (`apps/user-application/.env*`): `VITE_API_TOKEN` (musi == data-service `API_TOKEN`), `VITE_DATA_SERVICE_URL`, DB vars, `BETTER_AUTH_*`
  - `runner` (`/etc/grota/runner.env` na VPS / `.env` lokalnie): `GROTA_TOKEN`, `GROTA_PORT`
  - per-deployment w UI (Konfiguracja serwera): `runner_url`, `runner_token` (== `GROTA_TOKEN` z VPSa), `backup_path`, `bwlimit`
  - per-deployment w UI (Dane klienta / B2): `b2_config.key_id`, `app_key`, `bucket_prefix`
- [ ] **Sekcja 2: Setup lokalny (dev)** — kolejnosc: postgres/Neon dev DB → `pnpm setup` → uruchom 3 komponenty (data-service, user-app, runner) → utworz wdrozenie w UI → wpisz config (B2 + runner_url=`http://localhost:7878` + token) → kliknij Test polaczenia
- [ ] **Sekcja 3: Setup produkcyjny (VPS)** — link do `apps/runner/deploy/README.md` + co po stronie Cloudflare (Worker secrets dla data-service, env vars dla user-app, jak skopiowac wygenerowany GROTA_TOKEN do UI)
- [ ] **Sekcja 4: Smoke test end-to-end** — krok po kroku: (1) `/health` runnera, (2) Test polaczenia w UI (verify B2), (3) Backup pojedynczego pracownika, (4) sprawdz `migration_jobs` w DB, (5) sprawdz `journalctl -u grota-runner` na VPSie, (6) Dry-run migracji, (7) sprawdz historie w UI
- [ ] **Sekcja 5: Troubleshooting** — typowe bledy: 401 z runnera (token mismatch), CONFIG_INCOMPLETE (brak B2/backup_path), RUNNER_UNREACHABLE (CF Tunnel down / zly hostname), 409 (drugi job), exit_code=1 z `runnerConfig missing` (data-service nie buduje configu — sprawdz b2_config), rclone exit 5/6/7 (auth/network)
- [ ] **Sekcja 6: Rotacja kluczy** — jak rotowac `GROTA_TOKEN`, `ENCRYPTION_KEY` (re-encrypt server-configs), `API_TOKEN`, B2 app keys

---

## Out of scope (przyszłe iteracje)

- Job queue (BullMQ / Cloudflare Queues) — gdy multi-tenant lub >kilkuset kont
- Pause/resume/retry per-account — obecnie cały job leci albo cały failuje
- Webhook do Slacka / e-mail po zakończeniu migracji
- Scheduling migracji (cron z UI)
