# Admin UI: Migration Trigger (Direct-Call)

## Context

Currently admin musi SSH-ować na VPS i odpalać `grota backup` / `grota migrate` ręcznie z CLI. Po onboardingu pracownika (OAuth + wybór folderów) brakuje finalnego kroku w UI: **admin klika "Migruj" → backend uruchamia migrację → UI pokazuje status i logi**.

**Skala**: do ~50 pracowników na deployment, single-tenant per VPS. Jednorazowy batch lub kilka tur.

**Decyzja architektoniczna**: direct-call (HTTP) zamiast job-queue. CLI na VPS wystawia mały HTTP serwis chroniony tokenem; `data-service` proxuje requesty z UI admina. Bez Redis/BullMQ — overkill przy tej skali.

**Tradeoff**: VPS musi mieć publiczny endpoint — rozwiązanie przez Cloudflare Tunnel (bez otwierania portów / publicznego IP).

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

- [x] `POST /verify` body: `{ b2KeyId, b2AppKey, bucketPrefix }` → handler + walidacja + DI `verifyB2Fn` (sesja TDD 13). Real implementation `verifyB2Fn` (rclone shell-out z tymczasowym configiem in-memory) — TODO w kolejnej sesji.
- [ ] Endpointy `/jobs/backup` i `/jobs/migrate` przyjmują `serverConfig` w body — runner buduje rclone.conf przed spawnem komendy, czyści po sobie
- [ ] Sanityzacja: sekrety nigdy nie trafiają do logów joba

### UI (`user-application`)

Nowy route `/admin/deployments/$id/server-config`:
- [ ] Formularz: B2 Key ID, App Key, Bucket Prefix, Backup Path, Bandwidth Limit (+ opcjonalne `sshHost`/`sshUser` w sekcji "Zaawansowane")
- [ ] Sekcja "Zaawansowane" zwijana
- [ ] Walidacja po stronie klienta (Zod) + serwera
- [ ] Przycisk `[Zapisz]` + `[Testuj połączenie]` (wywołuje `/server-config/test`)
- [ ] Status badge: "Skonfigurowany" / "Nieskonfigurowany" / "Test failed"
- [ ] Maskowanie sekretów przy edycji (placeholder `K001****`, fill tylko jeśli user wpisze nową wartość)

### Bezpieczeństwo

- [ ] Sekrety szyfrowane at-rest (reuse encryption layer)
- [ ] TLS 1.3 między `data-service` a runnerem (Cloudflare Tunnel domyślnie)
- [ ] Sekrety nie logowane w `migration_jobs.logs`
- [ ] Audit log zmian config (kto, kiedy, które pole — bez wartości)

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

- [ ] Systemd unit `grota-runner.service` (auto-restart, logi do journald)
- [ ] Token w `/etc/grota/runner.env` (chmod 600)
- [ ] Cloudflare Tunnel → `runner.<klient>.sobiecki.org` (eliminuje publiczne IP + firewall)
- [ ] Skrypt instalacyjny `apps/cli/install-runner.sh` (systemd + cloudflared + token gen)
- [ ] Dokumentacja w `apps/cli/README.md` — sekcja "Runner mode"

---

## 3. `data-service`: proxy + persystencja

### Schema (`packages/data-ops`)

- [x] Migracja: tabela `migration_jobs` (sesja TDD 17 — 0012_nice_may_parker.sql, zaaplikowane na dev). Kolumny i index zgodne ze specem.
- [x] Zod schemas + `createMigrationJob` + `getMigrationJob` (sesja TDD 17). `updateMigrationJobStatus` + `listMigrationJobs` — TODO (potrzebne do background-fetch statusu i historii).

### Handlery (`apps/data-service/src/hono/handlers/migration-handlers.ts`)

- [x] `POST /admin/migration/backup` body: `{ deploymentId, account? }` (sesja TDD 17)
- [ ] `POST /admin/migration/migrate` body: `{ deploymentId, account?, dryRun? }`
- [ ] `GET /admin/migration/jobs/:id` → status + metadane
- [ ] `GET /admin/migration/jobs/:id/logs` (SSE passthrough z runnera)
- [ ] `GET /admin/migration/jobs?deploymentId=...` → historia (paginated, last 50)

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

Nowy route `/admin/deployments/$id/migration`:

- [ ] Sekcja "Pracownicy gotowi do migracji" — lista employees ze statusem `ready` (OAuth + folders confirmed)
- [ ] Per wiersz: przyciski `[Backup]` `[Dry-run]` `[Migruj]`
- [ ] Globalne akcje: `[Backup wszystkich]` `[Migruj wszystkich]`
- [ ] Panel aktywnego joba:
  - Status badge (running / done / failed)
  - Live log viewer (SSE z `data-service`) z auto-scroll + pause
  - Czas trwania, exit code
- [ ] Historia ostatnich 50 jobów (collapsible) z linkiem do logów (re-fetch z DB)
- [ ] Confirm dialog przed `Migruj` (destrukcyjna akcja — przenosi pliki)
- [ ] Server functions wołają `data-service` przez istniejący API client
- [ ] Mutacje: TanStack Query, polling co 2s jako fallback gdy SSE padnie

---

## 5. Bezpieczeństwo

- [ ] Tylko rola admin (Better Auth) wywoła endpointy migracji
- [ ] `RUNNER_TOKEN` rotowalny (env w Workerze + `/etc/grota/runner.env`)
- [ ] Rate limit na `data-service`: max 1 globalna migracja w toku per deployment (409)
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
- [ ] **Slice 6**: Cloudflare Tunnel + systemd unit + skrypt instalacyjny (deploy na realnym VPS)
- [ ] **Slice 7**: Hardening — rate limit, sanityzacja logów, historia jobów, confirm dialog

Estymacja: slice 1-4 ≈ 2-3 dni; całość ≈ tydzień roboczy.

---

## Out of scope (przyszłe iteracje)

- Job queue (BullMQ / Cloudflare Queues) — gdy multi-tenant lub >kilkuset kont
- Pause/resume/retry per-account — obecnie cały job leci albo cały failuje
- Webhook do Slacka / e-mail po zakończeniu migracji
- Scheduling migracji (cron z UI)
