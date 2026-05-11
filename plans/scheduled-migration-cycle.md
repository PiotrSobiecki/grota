# Plan: Scheduled migration cycle

> Source PRD: [`docs/part-c/improvements/008-scheduled-migration-cycle.md`](../docs/part-c/improvements/008-scheduled-migration-cycle.md)

## Architectural decisions

Durable decisions, stałe przez wszystkie fazy:

- **Architecture style**: Cloudflare Worker Cron Trigger w `apps/data-service` (`scheduled()` handler) → dispatcher → POST do runnera na VPSie przez Cloudflare Tunnel. Reuse istniejącej proxy ścieżki (Bearer `runner_token` z `server_config`, deszyfrowane per-request).
- **Data model**: Nowa tabela `deployment_schedules` (1:1 z `deployment`). Rozszerzenie `migrationJobTypeEnum` o wartość `'scheduled-cycle'`. Nowy boolean `triggered_by_cron` w `migration_jobs` (zamiast sentinel UUID — czystsze pod kątem FK do `user`).
- **Key entities**:
  - `deployment_schedules`: `deployment_id` (PK), `enabled`, `interval_hours`, `anchor_time`, `anchor_timezone` (`Europe/Warsaw` v1), `last_run_at`, `next_run_at`, `last_job_id`, `last_status`, `retry_attempts_remaining`
  - `migration_jobs` (extended): nowy typ `scheduled-cycle`, flaga `triggered_by_cron`
- **Auth/authz**: Reuse istniejącego admin gate Better Auth dla UI; `API_TOKEN` dla worker-to-worker; brak nowych warstw uprawnień.
- **Integrations**:
  - Cloudflare Cron Triggers (fire co 5 min)
  - Resend (email alerty) — reuse z onboarding
  - Telegram Bot API — reuse `TELEGRAM_BOT_TOKEN`
  - Backblaze B2, Neon, Cloudflare Tunnel — bez zmian
- **Constraints**:
  - Strefa czasowa `Europe/Warsaw` na sztywno (kolumna w schemie istnieje, UI nie wystawia)
  - Cron fire co 5 min — precyzja anchor_time ±5 min
  - Tylko presety interwału: 1h / 6h / 12h / 24h / 7d
  - Globalny `OPERATOR_ALERT_EMAIL` w env (default `piotr@sobiecki.org`)
  - Zakres ticka = `ingest + backup`. `gdrive-restore` zawsze ręczny.
  - Max 500 lines per source file (konwencja repo)
  - Migracje DB tylko na bazie dev (jedna aktywna)

---

## Phase 1: Tracer bullet — minimal cron end-to-end

**User stories**: US-1 (częściowo), US-5 (częściowo)

### What to build

Cienka pionowa kreska przez całą architekturę, żeby udowodnić że Worker cron → dispatcher → runner → `migration_jobs` row działa. Hardcoded interval 24h, brak anchor_time, brak statusu w UI poza checkboxem.

Admin wchodzi na `/dashboard/$id/migration`, w „Akcje globalne" widzi checkbox „Włącz auto-backup (24h)". Klika → po max 5 min w historii pojawia się nowy job typu `backup` (istniejący, NIE nowy `scheduled-cycle`). Wszystkie warstwy (DB, cron Worker, dispatcher, runner, UI) wystartowane na minimum.

### Acceptance criteria

- [ ] Migracja Drizzle dodaje tabelę `deployment_schedules` z kolumnami minimum (`deployment_id`, `enabled`, `interval_hours`, `last_run_at`, `next_run_at`)
- [ ] `wrangler.jsonc` w `apps/data-service` ma odkomentowany `triggers.crons` z wyrażeniem `*/5 * * * *`
- [ ] Worker `scheduled()` handler czyta due schedules (`enabled AND next_run_at <= now()`) i dla każdego POSTuje do istniejącego endpointu `/jobs/backup` na runnerze
- [ ] Po POST: `last_run_at = now()`, `next_run_at = now() + interval`, `migration_jobs` row stworzony przez normalny flow `triggerBackupJob`
- [ ] UI: w sekcji „Akcje globalne" w `migration.tsx` jest checkbox „Włącz auto-backup (24h)" z server fn `setScheduleEnabled`
- [ ] Manual smoke na dev: zaznacz checkbox dla testowego deploymentu → odczekaj ≤5 min → w historii UI widać nowy `backup` job, runner zsynchronizował coś do B2
- [ ] Pure unit test: `evaluateSchedule(now, schedule) → { shouldRun, nextRunAt }` z minimum 3 cases (enabled+due, enabled+not-due, disabled)

---

## Phase 2: `scheduled-cycle` job type + skip-ungated employees

**User stories**: US-1 (pełne), US-10, US-11, US-14

### What to build

Zamiast wywoływać `/jobs/backup`, cron triggeruje nowy typ joba `scheduled-cycle`. Runner orkiestruje sekwencję: dla każdego pracownika z `driveOauthToken` + min. 1 folderem → `ingest`, potem zbiorczy `backup` (VPS → B2). Pracownicy bez OAuth lub bez folderów → skip cicho z wpisem w logu joba. Wszystko w jednym `migration_jobs` row, jeden SSE stream.

Restore do Workspace zostaje wyłącznie ręcznym przyciskiem — nie wchodzi w cykl pod żadnym togglem w v1.

### Acceptance criteria

- [ ] Migracja Drizzle dodaje wartość `'scheduled-cycle'` do `migrationJobTypeEnum`
- [ ] Runner endpoint `POST /jobs/scheduled-cycle` przyjmuje listę pracowników + B2 config + GDrive credentials, orkiestruje ingest-per-employee → backup-all
- [ ] Runner skipuje pracownika bez wymaganych pól, emit SSE event `skipped: <email> (reason)`, nie failuje całego joba
- [ ] Dispatcher w data-service wywołuje `/jobs/scheduled-cycle` zamiast `/jobs/backup` z odpowiednim body
- [ ] UI: w historii badge typu joba pokazuje „Auto cykl" dla `scheduled-cycle` (oddzielnie od `backup` / `ingest` / `gdrive-restore`)
- [ ] Integration test runnera (fake spawn): 3 pracownicy gotowi → 3 ingest + 1 backup, status `done`, jeden job row
- [ ] Integration test runnera: 3 pracownicy, 1 bez OAuth → 2 ingest + 1 backup, log zawiera `skipped`, status `done`
- [ ] Manual smoke: deployment z pracownikiem niegotowym + gotowym → cron tick widzi obu, ingestuje tylko gotowego, backup leci

---

## Phase 3: Full UI widget — presety, anchor_time, status display

**User stories**: US-2, US-3, US-4, US-5, US-13

### What to build

Pełny widget „Harmonogram" w sekcji „Akcje globalne" w `migration.tsx`:
- Toggle enabled/disabled
- Dropdown interwału (presety: 1h / 6h / 12h / 24h / 7d)
- Time picker dla `anchor_time` (default 02:00)
- Badge statusu: „Następne uruchomienie: 2026-05-12 02:00", „Ostatnie: 2026-05-11 02:00 — Sukces"
- Bootstrap behaviour: kliknięcie „Włącz" → `next_run_at = now()` (immediate first run) + kolejne uruchomienia kotwiczone do `anchor_time` w `Europe/Warsaw`

Evaluator rozbudowany o pełną logikę anchor_time + DST z table tests.

### Acceptance criteria

- [ ] Migracja Drizzle rozszerza `deployment_schedules` o `anchor_time`, `anchor_timezone`, `last_job_id`, `last_status`
- [ ] Form w UI: enabled toggle, interval dropdown, anchor_time picker — zapisuje przez server fn `setSchedule`
- [ ] Po włączeniu: pierwszy job startuje w ≤5 min (immediate), kolejny kotwiczy się do `anchor_time`
- [ ] Status badge pokazuje `next_run_at` w lokalnej strefie + `last_status` z `last_run_at`
- [ ] Evaluator z table tests pokrywa: anchor before/after now, last_run_at zaczyna kotwiczyć, DST spring forward (02:00 nie istnieje → fallback 03:00), DST fall back (02:00 dwa razy → odpala raz), interval-anchored vs anchor-anchored dla intervals < 24h
- [ ] Manual smoke: ustaw 6h@02:00 wieczorem → pierwszy run natychmiast, kolejny 02:00 jutro (nie 02:00 dziś)
- [ ] Toggle off zapisuje `enabled=false`, kolejne ticki cron nie odpalają

---

## Phase 4: Lock detection + skip-and-push + VPS retry

**User stories**: US-6, US-7, US-9

### What to build

Dispatcher staje się odporny na sytuacje wyjścia z normalnej ścieżki:

- **Skip-and-push**: jeśli dla deploymentu istnieje aktywny job (`status IN ('queued', 'running')`), cron wpisuje `last_status='skipped'` + `next_run_at = now + interval` (NIE `last_anchor + interval`, by uniknąć kaskady catch-up). Wpis pojawia się w historii UI z badgem „Pominięto".
- **VPS-down retry**: gdy POST do runnera zwraca network error / timeout / non-2xx → schedule oznaczony `retry_attempts_remaining = 1`, `next_run_at = now + 5min`. Kolejny tick (≤5 min) ponawia raz; drugi fail = `last_status='failed'` + wpis w jobie + przygotowane dla Phase 5 alerts.

### Acceptance criteria

- [ ] Migracja Drizzle dodaje `retry_attempts_remaining: int default 0` do `deployment_schedules`
- [ ] Dispatcher sprawdza `getActiveMigrationJob(deploymentId)` przed POSTem; jeśli aktywny → skip-and-push
- [ ] Historia UI pokazuje wpisy `skipped: locked` jako badge „Pominięto" (różny od „Auto cykl" sukces/fail)
- [ ] Network error w POST → `retry_attempts_remaining=1`, `next_run_at = now+5min`
- [ ] Drugi network error (retry exhausted) → `last_status='failed'`, `retry_attempts_remaining=0`, gotowe do hooka alertów
- [ ] Integration test dispatchera: aktywny lock → schedule push, brak nowego job row
- [ ] Integration test dispatchera: mock fetch throw raz → retry pending; mock fetch throw drugi raz → failed
- [ ] Manual smoke: odpal manual backup, włącz cron z anchor_time za 2 min → pierwszy tick skipuje, `next_run_at` przesunięte o interval

---

## Phase 5: Alerts — Telegram + email przez Resend

**User stories**: US-8

### What to build

Notification adapter `notifyJobFailed(deploymentId, jobId, reason)`:
- Telegram: reuse `TELEGRAM_BOT_TOKEN`, wiadomość zawiera deployment name, link do panelu, exit code, ostatnie linie logu joba
- Email: Resend z `OPERATOR_ALERT_EMAIL` env (default `piotr@sobiecki.org`), prosty template HTML

Hook wywoływany z dispatchera gdy:
- `scheduled-cycle` job kończy się statusem `failed` (z runnera)
- Retry exhausted w Phase 4 (`last_status='failed'`)

Nie wysyła przy `skipped: locked` (zdarzenie normalne, nie błąd).

### Acceptance criteria

- [ ] Env `OPERATOR_ALERT_EMAIL` dodany do `apps/data-service/.example.vars` + Wrangler secret instructions w `SETUP.md`
- [ ] `notifyJobFailed` wysyła oba kanały równolegle (Promise.allSettled — fail jednego nie blokuje drugiego)
- [ ] Telegram message zawiera: deployment name, job ID, exit code, link do `/dashboard/$id/migration`
- [ ] Email zawiera te same informacje + ostatnie 20 linii logu joba
- [ ] Hook woła się tylko dla `scheduled-cycle` + status `failed` — manualne joby NIE alertują (Phase 5 nie zmienia zachowania manualnych)
- [ ] Integration test: mock Resend + mock Telegram client, sprawdź że oba dostały body z poprawną treścią
- [ ] Integration test: Telegram client throw → email i tak wysłany (allSettled)
- [ ] Manual smoke: wpisz zły `runner_token` w server-config → kolejny tick failuje → Telegram + email przychodzi w ≤1 min

---

## Phase 6: Audit log + cron flag + token refresh + production smoke

**User stories**: US-12, US-15, US-16

### What to build

Domknięcie kawałków zostawionych do hardeningu:

- **Cron flag w `migration_jobs`**: kolumna `triggered_by_cron: bool default false`. Dispatcher ustawia `true` dla swoich jobów. UI badge w historii „Auto" (cron) vs „Admin" (`triggered_by_user_id` z imieniem operatora).
- **Audit log**: każda zmiana `deployment_schedules` (włącz/wyłącz/zmiana interwału/zmiana anchor_time) dodaje wpis do istniejącego `audit_log` z polem `action='schedule.updated'` i diffem.
- **Token refresh**: runner przed pierwszym rclone call dla każdego pracownika wywołuje `buildGDriveCredentialsForRunner` raz; jeśli się nie uda → skip pracownika cicho z `oauth_refresh_failed` w logu.
- **Production smoke**: pełen happy path na realnym kliencie staging — włącz harmonogram, poczekaj 24h, zweryfikuj że job wykonał się, dane są w B2, brak alertów false-positive.

### Acceptance criteria

- [ ] Migracja Drizzle dodaje `triggered_by_cron: bool default false` do `migration_jobs`
- [ ] Dispatcher ustawia `triggered_by_cron=true` przy tworzeniu `migration_jobs` row dla cron tick
- [ ] UI historia wyświetla badge „Auto" dla `triggered_by_cron=true`, „Admin: <name>" dla pozostałych
- [ ] Service `setSchedule` zapisuje wpis do `audit_log` z action `schedule.enabled` / `schedule.disabled` / `schedule.updated` + diff old → new
- [ ] Runner woła token refresh raz per pracownik per cykl (logika w `run-ingest` przed pierwszym spawnem)
- [ ] Integration test runnera: token refresh fail → pracownik skipnięty z `oauth_refresh_failed`, cykl kontynuuje
- [ ] Manual smoke staging: cron 24h@02:00 na realnym deploymencie → po 48h dwa successful `scheduled-cycle` joby w historii, dane w B2 zwiększyły się
- [ ] Manual smoke: zmień harmonogram w UI → w `audit_log` pojawił się wpis z poprawnym diffem
- [ ] Wszystkie US z PRD zweryfikowane (acceptance section w PRD)
- [ ] README + SETUP.md zaktualizowane o nową feature (sekcja Panel migracji + nowy env `OPERATOR_ALERT_EMAIL`)

---

## Notes

- **Kolejność jest istotna**: Phase 1 musi być pierwsza (tracer), Phase 6 ostatnia (smoke). Phase 4 i 5 mogłyby zostać zamienione, ale Phase 4 wprowadza `last_status='failed'` co jest hookiem dla alertów — naturalna kolejność.
- **Co po Phase 6**: rozważyć migrację systemd timerów (`apps/cli/systemd/grota-backup.timer`) → oznaczyć jako legacy, ale nie usuwać natychmiast (fallback). Toggle „auto restore do Workspace" jako post-MVP feature gdy klient poprosi.
- **Open implementation questions** (PRD §Further Notes) rozstrzygnięte w slice acceptance:
  - `triggered_by_user_id` sentinel → osobna bool flaga `triggered_by_cron` (Phase 6 AC)
  - `retry_pending` jako kolumna `retry_attempts_remaining: int` (Phase 4 AC)
  - Wyświetlanie harmonogramu gdy disabled — tak, jako sekcja z togglem (Phase 3 AC)
  - DST fallback — w table tests evaluatora (Phase 3 AC)
