# Scheduled migration cycle (cron w panelu migracji)

## Problem Statement

Operator (admin Auditmos) musi codziennie ręcznie klikać „Backup wszystkich" w panelu `/dashboard/$id/migration` dla każdego deploymentu. Przy 1-2 klientach jest do przeżycia, przy 5+ staje się obciążeniem i niesie ryzyko zapomnienia. Klienci pytają o „backup co 24h" jako standardowy element usługi — obecny brak harmonogramu jest luką w sprzedaży i operacjach.

Na VPSie istnieją systemd timery (`apps/cli/systemd/grota-backup.timer`), ale:
- Konfiguracja na VPSie, nie w UI — wymaga SSH i edycji plików per klient
- Tylko `Drive → VPS → B2`, bez integracji z `migration_jobs` ani historią w UI
- Brak widoczności statusu w panelu, brak alertów do operatora
- Trudno włączyć/wyłączyć dla konkretnego klienta z poziomu portalu

## Solution

W panelu `/dashboard/$id/migration`, w sekcji „Akcje globalne", dodać blok **„Harmonogram"** pozwalający operatorowi:
- Włączyć/wyłączyć cykliczne uruchamianie pełnego cyklu `ingest + backup`
- Wybrać interwał (preset: 1h / 6h / 12h / 24h / 7d)
- Wybrać porę dnia (anchor_time, default 02:00 Europe/Warsaw)
- Widzieć ostatnie i następne uruchomienie + status ostatniego cyklu

Pod spodem: nowy Cloudflare Worker Cron Trigger w `data-service` fire co 5 min, sprawdza w DB które deploymenty mają due cron, dla każdego POSTuje do runnera tak jak ręczny przycisk Backup. Runner wykonuje sekwencję `ingest-all → backup-all` jako jeden `migration_jobs` row typu `scheduled-cycle`, skipując cicho pracowników bez OAuth/folderów. Fail = Telegram + email do operatora.

Auto restore do Workspace (`gdrive-restore`) **nie wchodzi** w cykl — pozostaje wyłącznie ręczny, bo nadpisuje firmowy Drive i wymaga świadomej decyzji.

## User Stories

1. Jako operator Auditmos, chcę móc włączyć harmonogram backupu dla deploymentu z poziomu panelu migracji, żeby nie musieć codziennie ręcznie klikać „Backup wszystkich".
2. Jako operator, chcę wybierać interwał z presetów (1h / 6h / 12h / 24h / 7d), żeby unikać literówek i niesensownych wartości.
3. Jako operator, chcę określić porę dnia (np. 02:00), o której cykl ma się odpalać, żeby backupy szły w nocy i nie konkurowały o pasmo z normalną pracą.
4. Jako operator, po włączeniu harmonogramu chcę zobaczyć natychmiastowe pierwsze uruchomienie, żeby zweryfikować że konfiguracja działa, bez czekania całej doby.
5. Jako operator, chcę widzieć w panelu „następne uruchomienie: 2026-05-12 02:00" i „ostatnie: 2026-05-11 02:00 — success", żeby mieć pewność że cron żyje.
6. Jako operator, chcę żeby harmonogram NIE blokował manualnych akcji — mogę kliknąć „Backup" w trakcie, a cron pominie tick i ustawi następny na `now + interval`.
7. Jako operator, jeśli cron pominie tick z powodu manual joba, chcę widzieć w historii wpis `skipped: locked` z timestampem, żeby wiedzieć że zdarzenie miało miejsce.
8. Jako operator, gdy cykliczny job zakończy się błędem, chcę dostać powiadomienie na Telegram i email, żeby zareagować bez logowania do panelu.
9. Jako operator, jeśli runner na VPSie nie odpowiada (VPS down), chcę żeby system zrobił jedną automatyczną próbę za 5 min, a dopiero potem oznaczył job jako failed i wysłał alert — żeby chwilowe przerwy sieciowe nie generowały false-positive alertów.
10. Jako operator, jeśli pracownik nie skończył onboardingu (brak `driveOauthToken` lub brak wybranych folderów), chcę żeby cron go cicho pominął i kontynuował dla pozostałych, żeby jeden niedokończony onboarding nie blokował całego cyklu.
11. Jako operator, w historii każdego `scheduled-cycle` joba chcę widzieć listę pominiętych pracowników z powodem, żeby móc reagować na wygasłe tokeny.
12. Jako operator, gdy token OAuth pracownika wygasł, chcę żeby runner spróbował refresh raz; jeśli się nie uda — skip cicho z wpisem w logu joba.
13. Jako operator, chcę móc wyłączyć harmonogram dla deploymentu jednym togglem, np. na czas migracji infrastruktury.
14. Jako operator, harmonogram dotyczy tylko cyklu `ingest + backup`. Restore do Workspace (`gdrive-restore`) nigdy nie odpala się automatycznie — chcę robić to świadomie ręcznym kliknięciem.
15. Jako operator, chcę żeby `triggered_by_user_id` w `migration_jobs` jednoznacznie identyfikował jobs odpalone przez cron (vs ręczne), żeby audyt był czytelny.
16. Jako operator, chcę żeby zmiana konfiguracji harmonogramu (włączenie, wyłączenie, zmiana interwału) trafiała do `audit_log` deploymentu, żeby mieć ślad kto kiedy co zmienił.

## Implementation Decisions

### Architektura

- **Scheduler**: Cloudflare Worker Cron Trigger w `apps/data-service`. Reuse już istniejącego (zakomentowanego) bloku `triggers.crons` w `wrangler.jsonc`. Fire co 5 min. Worker `scheduled()` handler czyta z DB due deploymenty i dispatchuje.
- **Wykonanie**: dispatcher POSTuje do runnera na VPSie przez Cloudflare Tunnel (`runner_url` + `runner_token` z `server_config`, deszyfrowane per-request). Reuse istniejących `triggerBackupJob` patterns.
- **Job**: jeden wpis w `migration_jobs` per tick, typ `scheduled-cycle` (nowy wariant w `migrationJobTypeEnum`). Runner orkiestruje sekwencję `ingest-all → backup-all` w pojedynczym streamie SSE.
- **Skip-and-push**: gdy cron widzi aktywny job (status `queued`/`running`) → wpis `skipped: locked` + `next_run_at = now + interval` (NIE `last_anchor + interval`, by uniknąć kaskady catch-up).
- **VPS down retry**: dispatcher próbuje raz; przy network error / timeout / non-2xx oznacza schedule jako `retry_pending`, fire za 5 min jeden raz. Drugi fail = `failed` + alert.

### Dane

Nowa tabela `deployment_schedules`:
- `deployment_id` (PK, FK → deployments)
- `enabled` (bool)
- `interval_hours` (int — 1, 6, 12, 24, 168)
- `anchor_time` (time — np. `02:00`)
- `anchor_timezone` (text — `Europe/Warsaw`, na sztywno w v1)
- `last_run_at` / `next_run_at` (timestamptz)
- `last_job_id` (FK → migration_jobs, nullable)
- `last_status` (text — `done` / `failed` / `skipped` / `retry_pending`)
- `created_at` / `updated_at`

Rozszerzenia istniejących struktur:
- `migrationJobTypeEnum` += `'scheduled-cycle'`
- `triggered_by_user_id` w `migration_jobs` przyjmuje sentinel `'cron'` (special value) — interpretowane przez UI jako badge „Auto" zamiast nazwy admina

### Konfiguracja

- **Strefa czasowa**: `Europe/Warsaw` na sztywno (klienci PL only)
- **Email odbiorca alertu**: globalny adres operatora z env (`OPERATOR_ALERT_EMAIL`, default `piotr@sobiecki.org`) — nie pole per deployment w v1
- **Worker cron rate**: co 5 min (precyzja anchor_time ±5 min jest akceptowalna)
- **Bootstrap**: włączenie harmonogramu = `next_run_at = now()` (immediate first run) + kolejne kotwiczone do `anchor_time`

### Reuse istniejących systemów

- Telegram alert: istniejące `TELEGRAM_BOT_TOKEN` w data-service
- Email: istniejący Resend (już używany w onboarding)
- Token refresh dla pracowników: istniejący `buildGDriveCredentialsForRunner`
- Single-job lock: istniejący `getActiveMigrationJob` + 409 z runnera
- Audit log: istniejący system `audit_log` (z doc 005, sesja TDD 35)
- Encryption: istniejący `ENCRYPTION_KEY` (deszyfracja `runner_token` per-request)

### Zakres ticka

- `ingest` dla każdego pracownika z `driveOauthToken` + co najmniej 1 wybranym folderem/plikiem
- `backup` (VPS → B2) raz po zakończeniu wszystkich ingest
- Skip cicho: pracownik bez OAuth / bez folderów / token refresh failed
- Brak `gdrive-restore` w automatycznym cyklu — zawsze ręczny przycisk

## Validation Strategy

### Schedule evaluator (pure function — TDD z table tests)

`evaluateSchedule(now: Date, schedule: ScheduleRow): { shouldRun: bool, nextRunAt: Date, reason?: string }`

Test cases (minimum):
- Anchor 02:00, interval 24h, now=01:59 → shouldRun=false, nextRunAt=today 02:00
- Anchor 02:00, interval 24h, now=02:01 → shouldRun=true, nextRunAt=tomorrow 02:00
- Anchor 02:00, interval 24h, last_run_at=today 02:00, now=02:30 → shouldRun=false (już odpalone)
- Skip-and-push: aktywny lock, now=02:01 → nextRunAt = now + 24h (NIE jutro 02:00)
- DST spring forward (gdy aktualne): 02:00 nie istnieje → fallback 03:00
- DST fall back: 02:00 dwa razy → odpala raz
- Interval 1h, anchor 02:00, now=14:00 → kolejny 15:00 (interval-anchored), nie 02:00 jutro
- `enabled=false` → shouldRun=false zawsze

**Done = wszystkie table cases zielone, type-safe, 100% pokrycia ścieżek decyzyjnych.**

### Scheduled-cycle dispatcher (integration z mock runnerem)

Service test scenarios:
- Happy path: POST do runnera zwraca 200 → `migration_jobs` row `running`, schedule `last_run_at` ustawione
- Runner zwraca 409 (lock) → schedule `last_status = skipped`, `next_run_at = now + interval`, brak nowego job row
- Runner network error (mock fetch throw) → schedule `last_status = retry_pending`, jedna retry po 5 min
- Druga retry też fail → schedule `last_status = failed`, alert wysłany (Telegram + email mock)
- Token refresh fail dla 1 pracownika z 3 → POST idzie z 2 pracownikami w body, schedule kontynuuje
- Brak `server_config.runner_url` → schedule `last_status = failed: no runner configured` + alert

**Done = wszystkie 6 scenariuszy zielone na fixture deploymentu, mock fetch + mock Resend/Telegram clients, zero hit-network w testach.**

### Runner endpoint `/jobs/scheduled-cycle` (integration z fake rclone spawn)

Runner test scenarios:
- 3 pracowników gotowych → 3 ingest + 1 backup, jeden SSE stream, jeden job row, status `done`
- 3 pracowników, 1 bez OAuth → 2 ingest + 1 backup, log zawiera `skipped: jan@x.com (no oauth)`, status `done`
- Ingest pracownika 2 zwraca exit 6 (OAuth revoked) → kontynuacja dla pozostałych, log `failed: oauth_revoked`, oznacz `oauth_status=failed` na pracowniku, status `done-with-warnings` lub `done` (decyzja: `done` — sygnał w logu wystarczy w v1)
- Backup B2 failuje (exit ≠ 0) → status `failed`, exit code z runnera
- Wszyscy pracownicy bez OAuth → status `done`, log `no eligible employees`, brak wywołań rclone
- Token refresh przy starcie joba — runner woła `buildGDriveCredentialsForRunner` przed pierwszym rclone call

**Done = wszystkie 6 scenariuszy zielone z fake spawn factory, brak realnego rclone w testach, SSE stream emituje events w poprawnej kolejności.**

### User story acceptance (manual smoke w staging)

- US 1-3: włącz harmonogram 24h@02:00 → widać formularz, zapisuje się
- US 4: pierwsze uruchomienie odpala się natychmiast po włączeniu (sprawdź `migration_jobs` row w UI w ciągu 5 min)
- US 5: widget pokazuje next/last run + status badge
- US 6-7: manual Backup w trakcie → cron pomija, wpis `skipped` w historii
- US 8: zsymuluj fail (np. wpisz zły `runner_token`) → przychodzi Telegram + email
- US 9: zatrzymaj VPS na 3 min między fire'ami → retry po 5 min sukces
- US 10-11: dodaj pracownika bez ukończonego onboardingu → cron skipuje, log w jobie
- US 13: toggle off → kolejny tick nie odpala
- US 15: w UI history badge „Auto" przy cron jobach, „Admin" przy manualnych
- US 16: zmiana harmonogramu pojawia się w `audit_log`

## Out of Scope

- **Auto restore do Workspace** (`gdrive-restore` w cyklu) — pozostaje ręczny. Toggle „auto sync to Workspace" jako potencjalna feature post-MVP.
- **Konfiguracja per pracownik** (różne harmonogramy dla różnych pracowników w jednym deployment) — v1 = jeden harmonogram per deployment, wszyscy pracownicy lub nikt.
- **Multi-timezone** — `Europe/Warsaw` na sztywno. Pole `anchor_timezone` w schemie istnieje, ale UI go nie wystawia.
- **Email per deployment** — globalny adres operatora w env, nie pole per klient.
- **Cron expression** — tylko presety, brak free-form `0 2 * * *`.
- **Queue / chaining manualnych jobs** — skip jest finalny, brak kolejki.
- **Backup retention policies w B2** — zostaje to co jest w obecnym terraform/B2.
- **Self-service dla klienta** — feature widoczny tylko dla operatora Auditmos, klient nie ma dostępu do panelu migracji.
- **SLA / monitoring uptime cron Workera** — polegamy na Cloudflare Cron Triggers SLA bez dodatkowego monitoringu.

## Further Notes

- Migracja DB dla `deployment_schedules` musi być zaaplikowana na bazie dev (jedyna aktywna obecnie) przez `pnpm run drizzle:dev:migrate` z `packages/data-ops/`.
- Sentinel `'cron'` w `triggered_by_user_id` wymaga albo nullable kolumny + flagi `triggered_by_cron: bool`, albo special UUID sentinela. Decyzja w implementacji — preferowany nullable + bool flaga (czystsze pod kątem FK do `user` table).
- Worker cron co 5 min × N deploymentów = N queries do DB co 5 min. Przy planowanej skali (≤20 klientów) bez problemu, ale gdy skala wzrośnie warto dodać indeks `(enabled, next_run_at)` na `deployment_schedules`.
- Pierwsze uruchomienie po włączeniu = ten sam scheduler path co normalny tick — Worker scheduled handler musi wykonać się przed kolejnym fire'em, czyli max 5 min latency między „kliknij włącz" a „pierwszy job startuje". Akceptowalne UX-owo.
- Wpływ na istniejący flow: ZERO zmian w manualnych przyciskach Backup/Migrate/Restore. Dodawana jest tylko nowa ścieżka, istniejące pozostają nietknięte.
- Po wdrożeniu rozważyć migrację systemd timerów (`apps/cli/systemd/grota-backup.timer`) → status „legacy, replaced by UI scheduler". Nie usuwać natychmiast, zostawić jako fallback.

## Slices proposal (do dalszego rozwinięcia w `/carve`)

1. **Schedule store + evaluator** (data-ops) — tabela + queries + pure evaluator z table tests
2. **Cron handler + dispatcher** (data-service) — Worker `scheduled()` + dispatcher z mock runner tests
3. **Runner endpoint `scheduled-cycle`** (apps/runner) — orchestration + fake spawn tests
4. **UI Schedule widget** (user-application) — form + status w `migration.tsx`
5. **Notification adapter** (data-service) — email przez Resend + Telegram, hardening alertów
6. **Audit log hookup + smoke staging** — `audit_log` na zmiany harmonogramu, manual smoke wszystkich US

## Open implementation questions (do rozstrzygnięcia w trakcie carve)

- `triggered_by_user_id` nullable + bool flag vs sentinel UUID — preferowane: nullable + flag
- Czy retry-after-5min state żyje w `deployment_schedules` (`last_status = retry_pending`) czy osobna kolumna `retry_count`? — preferowane: jedna kolumna `retry_attempts_remaining: int default 0`
- Czy harmonogram pokazujemy w panelu nawet gdy `enabled = false`? — preferowane: tak, jako sekcja „wyłączony" z togglem włącz
- DST: jak runner traktuje godzinę „2:30" w nocy zmiany czasu? — preferowane: fallback do następnej istniejącej godziny (logika w evaluator)
