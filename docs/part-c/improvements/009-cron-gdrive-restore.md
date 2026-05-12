# 009 — Cron z opcjonalnym restore na dysk firmowy

> Parent PRD: [008-scheduled-migration-cycle](./008-scheduled-migration-cycle.md)
>
> Status: Draft

## Problem Statement

Operator skonfigurował zaplanowany cykl (cron) wg PRD-008. Cykl wykonuje sekwencję ingest (dyski pracowników → VPS lokalny) → backup (VPS → B2). Restore z VPS lokalnego na firmowy Google Drive pozostaje wyłącznie ręcznym przyciskiem.

W praktyce dla części wdrożeń ten ostatni krok ma być również automatyczny: po każdej cyklicznej migracji dane mają jednocześnie wylądować na dysku firmowym, tak żeby operator nie musiał ręcznie klikać „Wyślij na dysk firmowy" po każdym ticku crona. Dla innych wdrożeń obecne zachowanie (restore tylko ręczny) jest poprawne i nie chcemy go zmieniać domyślnie.

## Solution

W widgecie harmonogramu na `/dashboard/$id/migration` dodajemy opcjonalny checkbox „Wyślij też na dysk firmowy (po backupie)". Domyślnie odznaczony — cron działa identycznie jak po PRD-008 (ingest + backup). Po zaznaczeniu — każdy tick crona po udanym backupie wykonuje dodatkowo restore (VPS lokalny → firmowy Google Drive) per pracownik, sekwencyjnie, w ramach tego samego `migration_jobs` row i tego samego SSE streamu.

Restore re-używa istniejącej ścieżki ręcznego przycisku: te same credentials firmowego dysku z deployment-level OAuth, ta sama logika rclone sync z VPS lokalnego do shared drive firmy, ten sam mapping per pracownik (`${backupPath}/${sanitized_email}` → `gdrive:${targetFolder}`).

Failure jednego pracownika w fazie restore nie blokuje pozostałych (partial success), ale finalny status joba `failed` triggeruje alerty Telegram+email zgodnie z PRD-008 Phase 5. Zmiana togglu jest audytowana w `audit_log` jak inne zmiany harmonogramu (PRD-008 Phase 6).

## User Stories

1. Jako operator z włączonym cronem chcę zaznaczyć opcję „wyślij też na dysk firmowy", żeby dane po cyklu trafiały automatycznie do shared drive firmy bez mojego klikania.
2. Jako operator chcę żeby ta opcja była domyślnie wyłączona, żeby aktualne wdrożenia z PRD-008 nie zmieniły zachowania bez mojej decyzji.
3. Jako operator chcę móc wyłączyć tę opcję bez wyłączania całego crona, żeby zatrzymać tylko restore (np. gdy firmowy Drive jest pełny) i zachować backup do B2.
4. Jako operator chcę widzieć w historii joba kroki restore per pracownik (które wykonane, które skipnięte, które failed), żeby zdiagnozować problem bez SSH na VPS.
5. Jako operator chcę żeby fail restore dla jednego pracownika nie blokował restore pozostałych, żeby cykl maksymalizował dostarczone dane.
6. Jako operator chcę dostać alert Telegram+email gdy cykl z restore zakończy się statusem `failed`, żeby zareagować szybko (np. na revoked OAuth firmowego dysku).
7. Jako operator chcę żeby pracownik bez OAuth lub bez folderów był skipnięty cicho także w fazie restore (spójnie z fazą ingest), żeby cykl nie failował przez konfiguracyjne luki.
8. Jako operator chcę widzieć w `audit_log` kto i kiedy włączył lub wyłączył opcję wysyłki na dysk firmowy, żeby móc odtworzyć decyzje konfiguracyjne.
9. Jako operator chcę żeby pierwsza próba restore dla deploymentu bez skonfigurowanego firmowego OAuth produkowała czytelny błąd w UI („Brak konfiguracji dysku firmowego — uzupełnij OAuth"), nie cichy fail.
10. Jako operator chcę żeby zaznaczenie checkboxa zapisywało się natychmiast (lub przez „Zapisz") bez przeładowywania widgetu, żeby UX był spójny z resztą formularza harmonogramu.
11. Jako developer chcę żeby logika decyzji „uruchom restore?" była pure-function testowalna table testami, żeby zachować jakość evaluatora harmonogramu z PRD-008.
12. Jako developer chcę żeby zmiany w runnerze nie naruszały kontraktu istniejącego ręcznego przycisku gdrive-restore, żeby nie regressować Part C improvement 006.
13. Jako operator chcę dostać powiadomienie Telegram po każdym udanym cyklu (backup + opcjonalny restore), żeby mieć potwierdzenie wykonania bez sprawdzania UI.
14. Jako operator chcę żeby powiadomienie o sukcesie zawierało zakres wykonanych kroków (np. „ingest 5 pracowników, backup OK, restore OK do dysku firmowego"), żeby wiedzieć co dokładnie się stało.
15. Jako operator chcę móc wyłączyć powiadomienia sukcesu osobno od failure (toggle „powiadom o sukcesie" w widgecie harmonogramu albo globalnie w env), żeby uniknąć szumu przy częstych cyklach.

## Implementation Decisions

**Architektura**

- Reuse istniejącego endpointu runnera `POST /jobs/scheduled-cycle`. Rozszerzenie body o opcjonalne pole z konfiguracją restore (credentials firmowego dysku + lista per-account target folders).
- Runner po zakończonym backupie iteruje po pracownikach. Dla każdego z gotowym source path na VPS wywołuje rclone sync z lokala do shared drive firmy. Sekwencyjnie, nie równolegle — żeby nie obciążać VPS I/O i zachować przewidywalny przepływ logów SSE.
- Credentials firmowego dysku pobierane na poziomie deploymentu (tym samym mechanizmem co ręczny przycisk restore — funkcja `buildGDriveCredentialsForRunner(deploymentId)`). Nie ma osobnego storage credentials per schedule.
- Per-account targets w body: dla każdego pracownika source = `${backupPath}/${sanitized_email}`, target folder zgodny z konfiguracją deploymentu (default = email pracownika jako nazwa folderu na shared drive firmy).

**Model danych**

- Nowa kolumna `include_gdrive_restore: boolean default false` w tabeli `deployment_schedules` (PRD-008 Phase 1).
- Brak nowych tabel.
- Audit_log: nowe action labels `schedule.gdrive_restore_enabled` / `schedule.gdrive_restore_disabled` (lub diff w istniejącym `schedule.updated` — decyzja w trakcie implementacji w zależności od konwencji już ustalonej w Phase 6).

**Granice systemu**

- Worker `apps/data-service` (Cloudflare): czyta flagę przy budowaniu request body do runnera, jeśli `true` → woła `buildGDriveCredentialsForRunner` i dorzuca payload restore.
- Runner na VPS (`apps/runner`): rozszerzony `run-scheduled-cycle` o fazę restore po backupie.
- Frontend `apps/user-application` (TanStack Start): checkbox w widgecie harmonogramu, server fn `setSchedule` przyjmuje nowe pole.

**Failure semantyka**

- Pracownik bez source path na VPS (np. ingest skipnięty wcześniej): skip restore z logiem `restore_skipped: <email> (no_source)`. Nie liczy się jako failure.
- Pracownik z source path ale rclone exit ≠ 0: log `restore_failed: <email> (exit X)`, kontynuuj kolejnego. Job kończy się statusem `failed` jeśli choć jeden restore failował (analogicznie do `sync_local_to_b2` w `apps/cli/lib/backup.sh`).
- Brak credentials firmowego dysku gdy flaga włączona: dispatcher zwraca błąd przed POST do runnera, schedule oznaczone `last_status='failed'`, alert wystrzelony, w UI badge „Brak konfiguracji dysku firmowego".

**Bezpieczeństwo i compatibility**

- Default `false` — istniejące wdrożenia z włączonym cronem zachowują obecne zachowanie.
- Ręczny przycisk gdrive-restore pozostaje bez zmian (kontrakt API runnera nadal wspiera POST `/jobs/gdrive-restore`).
- Token refresh firmowego dysku: runner robi to raz per cykl przed pętlą restore (spójnie z token refresh dla pracowników w PRD-008 Phase 6).

**Alerty (failure + success)**

- Reuse `notifyJobFailed` z PRD-008 Phase 5. Wiadomość Telegram + email zawiera te same dane co dla cyklu bez restore + dodatkową linię „Faza failed: restore" jeśli backup OK ale restore nie.
- Nowy hook `notifyJobSucceeded` (Telegram only — email pomijamy żeby uniknąć szumu w skrzynce; włączenie email pod osobny flag w przyszłości). Wiadomość zawiera: deployment name, czas trwania, podsumowanie kroków (`ingest: N pracowników, backup: OK, restore: OK/skipped/N failed`), link do panelu.
- Hook woła się tylko dla `scheduled-cycle` (nie dla ręcznych jobów) i tylko gdy status `done` (nie `partial_success` traktowane jak failure dla notyfikacji). Domyślnie włączone — toggle off-switch konfigurowalny per deployment lub globalnie (decyzja w implementacji w zależności od potrzeby kontroli).
- Failure i success notyfikacje używają tego samego `TELEGRAM_BOT_TOKEN` z PRD-008.

## Validation Strategy

**Komponent testowalny niezależnie: evaluator decyzji „run restore step?"**

Pure function `shouldRunRestore(schedule, jobOutcome) → boolean` z table testami:
- flaga off → false (nawet jeśli backup OK)
- flaga on + backup OK → true
- flaga on + backup failed → false (nie ma sensu robić restore bez danych)

**Komponent testowalny niezależnie: per-account restore iteration**

Integration test runnera (fake spawn): 3 pracowników z source paths → 3 rclone sync calls, status `done`. Jeden bez source path → 2 calls + 1 `restore_skipped` log, status `done`. Dwóch z source paths, jeden zwraca exit 5 → 2 calls, log `restore_failed`, status job `failed`, partial success (drugi się wykonał).

**Komponent testowalny niezależnie: dispatcher payload assembly**

Unit test serwisu w data-service: dla schedule z `include_gdrive_restore=true` body POST do runnera zawiera pole z credentials firmowego dysku + per-account targets. Dla `false` — pole nieobecne. Dla brak credentials w deployment + flaga true — błąd przed POST, schedule `last_status='failed'`.

**Validation per user story**

- US-1, US-2: manual smoke — checkbox zaznaczony, cykl wykonuje restore; checkbox odznaczony, cykl pomija restore.
- US-3: manual smoke — odznacz checkbox przy włączonym cronie, kolejny tick robi tylko backup, nie restore.
- US-4: SSE stream zawiera `restore_started`, `restore_done`, `restore_failed`, `restore_skipped` per pracownik; UI renderuje je w historii joba.
- US-5: integration test partial success (powyżej).
- US-6: manual smoke — symulacja revoked OAuth firmowego dysku → cykl `failed` → alert w ≤1 min.
- US-7: integration test — pracownik bez OAuth pominięty już w fazie ingest, faza restore też go pomija.
- US-8: po toggle audit_log dostaje wpis z diff `include_gdrive_restore: false → true`.
- US-9: dispatcher integration test — flaga on + missing creds → response 400 z kodem `CONFIG_INCOMPLETE_COMPANY_DRIVE`.
- US-10: zgodność z resztą formularza — bez nowych regresji UI.
- US-11: testy table evaluatora powyżej.
- US-12: istniejące testy `run-gdrive-restore` muszą pozostać zielone bez zmian.
- US-13, US-14: manual smoke — pomyślny cykl (z restore i bez) → wiadomość Telegram w ≤30s z prawidłowym podsumowaniem kroków. Integration test: mock Telegram client dla obu ścieżek (success/failure), assert że obie wysłały body z poprawną treścią.
- US-15: integration test — toggle „notify on success" off → `notifyJobSucceeded` nie wywołane, failure notification nadal działa.

**Quality criteria**

- Wszystkie istniejące testy z PRD-008 zielone bez zmian.
- Brak deploymentu w produkcji bez zatwierdzenia smoke staging (cron 24h z flagą on, dwa udane cykle, dane w shared drive firmy zwiększyły się).

## Out of Scope

- Osobny harmonogram dla restore (np. backup co 24h, restore co 7 dni). V1 = jedna częstotliwość z PRD-008.
- Konfiguracja per-folder targets na shared drive firmy (każdy pracownik leci do swojego folderu wg konwencji). Custom mapping = przyszły PRD.
- Restore równoległy (parallel rclone calls per pracownik). Sekwencyjnie w v1 dla przewidywalności.
- Automatyczny retry restore (osobno od retry całego ticka z PRD-008 Phase 4). Failed restore = failed cykl, kolejny tick spróbuje ponownie cały pipeline.
- Selektywny restore (tylko wybrani pracownicy). V1 = wszyscy z gotowym source path.
- Zmiana zachowania ręcznego przycisku gdrive-restore. Pozostaje bez zmian.

## Further Notes

- Migracje DB zgodnie z konwencją repo: najpierw dev base (`drizzle:dev:*`), potem production base. Brak staging base — patrz CLAUDE.md.
- Plik PRD jest singlem-source-of-truth. Implementation plan (`plans/cron-gdrive-restore.md`) zostanie wygenerowany osobno przez carve/dispatch po akceptacji PRD.
- Decyzja „audit jako osobne actions vs diff w `schedule.updated`" zostaje na implementator w zależności od kształtu już istniejącego audit_log po Phase 6 PRD-008. Obie opcje są dopuszczalne — wymóg to żeby zmiana togglu była audytowalna.
- Open question na review: czy target folder na shared drive firmy powinien być parametryzowany per deployment (kolumna w `deployment`), czy zawsze = email pracownika? V1 zakłada to drugie (najprostsze, zgodne z aktualnym ręcznym przyciskiem). Zmiana wymagałaby nowego pola w deployment + UI.
