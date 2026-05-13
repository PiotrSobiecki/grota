# Plan: Cron z opcjonalnym restore na dysk firmowy

> Source PRD: [`docs/part-c/improvements/009-cron-gdrive-restore.md`](../docs/part-c/improvements/009-cron-gdrive-restore.md) — GitHub issue [#10](https://github.com/PiotrSobiecki/grota/issues/10)
>
> Parent PRD: [008-scheduled-migration-cycle](../docs/part-c/improvements/008-scheduled-migration-cycle.md)
>
> GitHub issues: [#11](https://github.com/PiotrSobiecki/grota/issues/11) · [#12](https://github.com/PiotrSobiecki/grota/issues/12) · [#13](https://github.com/PiotrSobiecki/grota/issues/13) · [#14](https://github.com/PiotrSobiecki/grota/issues/14) · [#15](https://github.com/PiotrSobiecki/grota/issues/15) · [#16](https://github.com/PiotrSobiecki/grota/issues/16) · [#17](https://github.com/PiotrSobiecki/grota/issues/17) · [#18](https://github.com/PiotrSobiecki/grota/issues/18)

## Architectural decisions

Durable decisions, stałe przez wszystkie fazy:

- **Architecture style**: Extension istniejącego flow z PRD-008. Worker `apps/data-service` (cron + dispatcher) buduje rozszerzony request body, runner na VPS (`apps/runner`) wykonuje nową fazę restore w ramach tego samego `migration_jobs` row i tego samego SSE streamu. Brak nowych endpointów — `POST /jobs/scheduled-cycle` przyjmuje opcjonalny payload restore.
- **Data model**: Jedna nowa kolumna `include_gdrive_restore: boolean default false` w istniejącej tabeli `deployment_schedules`. Brak nowych tabel. Audit zmian togglu w istniejącym `audit_log`.
- **Credentials reuse**: Firmowy dysk Google ma OAuth na poziomie deploymentu — ten sam mechanizm co ręczny przycisk gdrive-restore. Brak nowego storage credentials. Brak per-schedule overrides.
- **Failure semantyka**: Partial success per pracownik (skip bez source path = no failure, rclone exit ≠ 0 = restore_failed, kontynuuj). Job kończy się `failed` (exit 7) jeśli choć jeden restore failował.
- **Notifications**: Failure path reuse `notifyJobFailed` z PRD-008 Phase 5 (Telegram + email). Success notifications to nowa ścieżka `notifyJobSucceeded` (Telegram only w v1, ten sam `TELEGRAM_BOT_TOKEN`).
- **Constraints**:
  - Default `include_gdrive_restore=false` — istniejące wdrożenia z włączonym cronem nie zmieniają zachowania
  - Ręczny przycisk gdrive-restore (Part C improvement 006) bez zmian — kontrakt API runnera dla `POST /jobs/gdrive-restore` pozostaje stabilny
  - Sekwencyjne wykonanie restore per pracownik (nie równolegle) — przewidywalność I/O VPS i logów SSE
  - Migracje DB tylko na bazie dev (jedna aktywna) plus production base, zgodnie z konwencją repo
  - Max 500 lines per source file

---

## Phase 1: Tracer-bullet — toggle + minimalny restore happy path

> GitHub issue [#11](https://github.com/PiotrSobiecki/grota/issues/11)

**User stories**: US-1, US-2, US-4

### What to build

Cienka pionowa kreska przez całą architekturę. DB dostaje kolumnę flagi, UI renderuje checkbox w widgecie harmonogramu, server fn zapisuje wartość, dispatcher czyta i jak `true` → dorzuca payload restore z credentials firmowego dysku. Runner po zakończonym backupie iteruje pracowników z gotowym source path i wykonuje rclone sync per account sekwencyjnie.

Cel: zaznacz checkbox → kolejny tick crona (≤5 min) wykonuje restore i widać `restore_started`/`restore_done` per pracownik w SSE. Bez partial success, bez walidacji credentials, bez audit, bez alertów, bez success notifications.

### Acceptance criteria

- [ ] Migracja Drizzle dodaje kolumnę `include_gdrive_restore: bool default false` w `deployment_schedules` (dev + production)
- [ ] Schema requestu do runnera rozszerzona o opcjonalne pole z credentials firmowego dysku + per-account targets
- [ ] UI: checkbox „Wyślij też na dysk firmowy (po backupie)" zapisuje wartość przez istniejącą server fn `setSchedule`
- [ ] Dispatcher wywołuje helper budujący credentials firmowego dysku gdy flaga `true` i dołącza payload do body
- [ ] Runner po backupie iteruje pracowników z gotowym source path i wykonuje rclone sync do shared drive firmy
- [ ] SSE emituje `restore_started: <email>` i `restore_done: <email>` per pracownik
- [ ] Pure unit test helpera per-account targets (minimum 2 cases)
- [ ] Manual smoke dev: zaznacz checkbox → ≤5 min later dane na shared drive firmy + w B2

---

## Phase 2: Partial success + skip semantyka dla restore

> GitHub issue [#12](https://github.com/PiotrSobiecki/grota/issues/12)

**User stories**: US-5, US-7

### What to build

Realistyczna obsługa edge case'ów w fazie restore. Pracownik bez source path (np. ingest go skipnął) jest pomijany cicho. Rclone fail per pracownik nie blokuje pozostałych — kontynuuj iterację, na końcu zwróć exit 7 jeśli choć jeden failował i choć jeden się udał.

### Acceptance criteria

- [ ] Skip pracownika bez source path z logiem `restore_skipped: <email> (no_source)` — nie liczy się jako failure
- [ ] Rclone exit ≠ 0 dla pracownika → log `restore_failed: <email> (exit X)`, kontynuuj kolejnego
- [ ] Job exit 7 jeśli choć jeden restore failed + choć jeden success (partial success)
- [ ] Job exit 0 jeśli wszyscy success/skipped
- [ ] Integration test: 3 pracowników gotowych → 3 restore + done
- [ ] Integration test: 3 pracowników, 1 bez source → 2 restore + 1 skipped + done
- [ ] Integration test: 3 pracowników, 1 exit 5 → 2 success + 1 failed + partial_success

---

## Phase 3: Walidacja braku credentials firmowego dysku

> GitHub issue [#13](https://github.com/PiotrSobiecki/grota/issues/13)

**User stories**: US-9

### What to build

Dispatcher sprawdza obecność credentials firmowego dysku przed POSTem do runnera. Brak credentials gdy flaga `true` → schedule `last_status='failed'` z czytelnym kodem błędu, brak ruchu sieciowego do VPS. UI pokazuje badge z komunikatem.

### Acceptance criteria

- [ ] Dispatcher waliduje obecność deployment-level OAuth firmowego dysku przed POSTem gdy flaga `true`
- [ ] Brak credentials → `last_status='failed'` + kod `CONFIG_INCOMPLETE_COMPANY_DRIVE`
- [ ] UI renderuje badge „Brak konfiguracji dysku firmowego — uzupełnij OAuth"
- [ ] Integration test: flaga true + brak creds → błąd, brak fetch do runnera
- [ ] Integration test: flaga true + obecne creds → fetch z payloadem restore
- [ ] Integration test: flaga false → fetch bez payloadu, bez sprawdzania creds

---

## Phase 4: Audit log dla zmian togglu

> GitHub issue [#14](https://github.com/PiotrSobiecki/grota/issues/14)

**User stories**: US-8

### What to build

Każda zmiana wartości `include_gdrive_restore` ląduje w `audit_log` z diffem old → new i identyfikatorem operatora. Spójne z konwencją audit zmian harmonogramu z PRD-008 Phase 6.

### Acceptance criteria

- [ ] Server fn aktualizująca harmonogram wpisuje rekord do `audit_log` przy każdej zmianie flagi
- [ ] Wpis zawiera action label spójny z konwencją Phase 6 PRD-008 (decyzja: diff w `schedule.updated` albo dedykowane `schedule.gdrive_restore_enabled/disabled`)
- [ ] Wpis zawiera diff `old → new` + identyfikator operatora
- [ ] Integration test: zmiana false→true → wpis z diffem
- [ ] Integration test: zapis tej samej wartości → brak nowego wpisu (no-op)

---

## Phase 5: Disable-restore-only flow

> GitHub issue [#15](https://github.com/PiotrSobiecki/grota/issues/15)

**User stories**: US-3, US-10

### What to build

Odznaczenie checkboxa przy aktywnym cronie wyłącza tylko fazę restore — harmonogram pozostaje włączony, kolejne ticki wykonują ingest + backup bez restore. Brak przeładowania widgetu.

### Acceptance criteria

- [ ] Odznaczenie zapisuje `include_gdrive_restore=false` bez zmiany pola `enabled`
- [ ] Następny tick wykonuje cykl bez fazy restore (identycznie jak przed Phase 1)
- [ ] UI bez przeładowania widgetu — spójność z resztą formularza
- [ ] Integration test dispatchera: enabled=true + restore=false → body bez payloadu restore
- [ ] Manual smoke: aktywny cron z restore → odznacz → kolejny tick robi tylko backup

---

## Phase 6: Failure alerts dla failed restore phase

> GitHub issue [#17](https://github.com/PiotrSobiecki/grota/issues/17) (blocked by Phase 2 + Phase 3)

**User stories**: US-6

### What to build

Podłączenie istniejącego `notifyJobFailed` (PRD-008 Phase 5) do nowych ścieżek failure: partial success z Phase 2 oraz config error z Phase 3. Wiadomość Telegram + email zawiera dodatkową linię „Faza failed: restore" gdy backup OK ale restore nie + listę emaili pracowników których restore failował.

### Acceptance criteria

- [ ] Cycle z `include_gdrive_restore=true` exit 7 (restore failed) triggeruje `notifyJobFailed`
- [ ] Cycle failujący na walidacji credentials (Phase 3) triggeruje `notifyJobFailed`
- [ ] Wiadomość zawiera „Faza failed: restore" gdy backup OK + restore failed
- [ ] Wiadomość zawiera listę emaili pracowników których restore failował
- [ ] `notifyJobFailed` NIE wywoływane gdy backup OK + wszyscy restore success/skipped
- [ ] Integration test: mock Telegram + Resend, partial success → oba kanały wywołane
- [ ] Integration test: cycle done bez restore failed → brak wywołania

---

## Phase 7: Success notifications na Telegram + toggle

> GitHub issue [#16](https://github.com/PiotrSobiecki/grota/issues/16)

**User stories**: US-13, US-14, US-15

### What to build

Nowy hook `notifyJobSucceeded` wysyła wiadomość Telegram po każdym pomyślnym cyklu (status `done`). Wiadomość zawiera podsumowanie kroków (ingest, backup, opcjonalny restore), deployment name, czas trwania, link do panelu. Toggle pozwala wyłączyć notyfikacje sukcesu osobno od failure. Email pomijamy w v1.

### Acceptance criteria

- [ ] `notifyJobSucceeded` używa tego samego `TELEGRAM_BOT_TOKEN` co PRD-008 Phase 5
- [ ] Wiadomość: deployment name, czas trwania, podsumowanie (`ingest: N pracowników, backup: OK, restore: OK/skipped/N failed`), link do panelu
- [ ] Hook woła się tylko dla `scheduled-cycle` status `done` (nie `partial_success`, nie ręczne joby)
- [ ] Toggle „powiadom o sukcesie" — kolumna w `deployment_schedules` lub globalny env (decyzja w implementacji), default włączony
- [ ] Integration test: mock Telegram, pomyślny cykl → hook wywołany z poprawnym body
- [ ] Integration test: toggle off → hook nie wywołany
- [ ] Integration test: status failed → `notifyJobSucceeded` nie wywołany
- [ ] Manual smoke: udany cykl → wiadomość w ≤30s

---

## Phase 8: Production smoke staging 24h (HITL)

> GitHub issue [#18](https://github.com/PiotrSobiecki/grota/issues/18) (blocked by all previous phases)

**User stories**: US-11, plus pełna walidacja end-to-end PRD-009

### What to build

Manualny smoke test pełnego cyklu z restore na realnym deploymencie staging. Obserwacja przez 24h: weryfikacja danych na firmowym Google Drive, brak false-positive alertów, success notification doszło. Domknięcie zakresu przed produkcją.

### Acceptance criteria

- [ ] Deployment staging z OAuth firmowego dysku + harmonogram 24h + `include_gdrive_restore=true`
- [ ] Pierwszy tick: ingest + backup + restore per pracownik, status done
- [ ] Pliki na shared drive firmy zgodne ze stanem VPS lokalnym
- [ ] Telegram success message w ≤30s
- [ ] Brak false-positive failure alertów
- [ ] Drugi tick (po 24h) — to samo zachowanie
- [ ] Negative test: odłączenie OAuth firmowego dysku → `CONFIG_INCOMPLETE_COMPANY_DRIVE` w UI + failure alert
- [ ] Negative test: rewert OAuth → kolejny tick wraca do success path

---

## Notes

- **Kolejność**: Phase 1 musi być pierwsza (tracer), Phase 8 ostatnia (smoke). Phases 2–5 i 7 mogą iść równolegle po Phase 1. Phase 6 czeka na Phase 2 i Phase 3 (potrzebuje obu failure paths). 
- **Konflikt z PRD-008 plan §Constraints**: PRD-008 mówi „gdrive-restore zawsze ręczny" — PRD-009 świadomie zmienia ten constraint. Po wdrożeniu PRD-009 obie ścieżki współistnieją: ręczny przycisk dalej działa, opcjonalny krok w cyklu dochodzi jako alternatywa.
- **Open implementation question** (do rozstrzygnięcia w Phase 4/7):
  - Audit log action label: jeden `schedule.updated` z diffem vs dedykowane `schedule.gdrive_restore_enabled/disabled` — zgodnie z konwencją już ustaloną w Phase 6 PRD-008
  - Success notification toggle: per-deployment kolumna vs globalny env — per-deployment daje granularną kontrolę, globalny jest prostszy
- **Co po Phase 8**: rozważyć rozszerzenia post-MVP zaznaczone w PRD-009 „Out of Scope" — osobny harmonogram restore, custom per-folder targets, parallel restore, selektywny restore per pracownik.
