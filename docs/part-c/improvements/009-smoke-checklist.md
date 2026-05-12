# 009 — Smoke Checklist (issue #18, HITL)

> Manualna weryfikacja PRD-009 na realnym deploymencie staging. Wykonaj po deploy production migration (drizzle:production:migrate) i deploy obu Workerów.

## Pre-flight (przed pierwszym tickiem)

- [ ] `drizzle:production:migrate` wykonane — kolumna `include_gdrive_restore` istnieje w `deployment_schedules` na production DB
- [ ] `pnpm run deploy:staging:data-service` wykonane
- [ ] `pnpm run deploy:staging:user-application` wykonane
- [ ] Workspace OAuth firmowego dysku skonfigurowany dla deploymentu testowego (sprawdź w UI: status OAuth)
- [ ] B2 config + runner_url/token zapisane
- [ ] Min. 1 pracownik z OAuth + selected folders + min. 1 plik na Drive
- [ ] `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` ustawione jako Workers secrets (`sync-secrets.sh`)
- [ ] `OPERATOR_NOTIFY_SUCCESS` NIEustawione (domyślnie włączone) lub `="true"`

## Happy path

- [ ] W UI `/dashboard/<id>/migration` zaznacz „Wyślij też na dysk firmowy (po backupie)", włącz harmonogram 24h@<godzina za ~5 min>
- [ ] Po ≤5 min sprawdź w historii nowy `scheduled-cycle` job z badge „Auto"
- [ ] SSE/logi jobu zawierają: `ingest` per pracownik → `rclone sync ... b2:...` → `restore_started: <email>` → `restore_done: <email>`
- [ ] Status job kończy się `done` (exit 0)
- [ ] Na firmowym Google Shared Drive pojawił się folder z emailem pracownika i zawartością odpowiadającą jego backupowi
- [ ] Plik z VPS lokalnym (przez SSH `ls /<backup_path>/<sanitized_email>`) ma te same nazwy plików/strukturę co target na Drive firmowym
- [ ] Telegram message dotarło w ≤30s zawiera: deployment name, Job ID, czas trwania, link do panelu
- [ ] Brak failure alert email od Resend

## Negative path #1 — brak workspace OAuth

- [ ] W UI/DB odłącz/usuń workspace OAuth dla deploymentu testowego
- [ ] Poczekaj na kolejny tick (lub wymuś przez zmianę `next_run_at`)
- [ ] W UI widget harmonogramu pokazuje badge „Brak konfiguracji dysku firmowego — uzupełnij OAuth"
- [ ] Telegram failure alert dotarło z reason `job_failed`
- [ ] Email failure alert z Resend dotarło na `OPERATOR_ALERT_EMAIL`
- [ ] Brak nowego `scheduled-cycle` job row (dispatcher zatrzymał POST do runnera)

## Negative path #2 — rewert OAuth

- [ ] Przywróć workspace OAuth (re-auth z Google)
- [ ] Kolejny tick wykonuje pełny cykl ingest + backup + restore
- [ ] Status `done`, brak failure alert

## Stabilność (24h)

- [ ] Po 24h drugi tick wykonał się — historia ma dwa udane `scheduled-cycle` jobs
- [ ] Dane na shared drive firmy: dwie kolejne wersje (rclone sync mirror, więc tylko zmiany od poprzedniego ticka)
- [ ] B2 bucket size monotonicznie rośnie (lub stabilne jeśli brak nowych danych)
- [ ] Brak false-positive alerts (żaden retry_pending → failed cycle bez powodu)

## Toggle off

- [ ] Odznacz checkbox „Wyślij też na dysk firmowy" przy aktywnym cronie
- [ ] Kolejny tick wykonuje tylko ingest + backup, BEZ restore
- [ ] Historia joba nie ma `restore_started`/`restore_done` linii SSE
- [ ] Na dysku firmowym brak nowych zmian od momentu odznaczenia
- [ ] Harmonogram pozostaje `enabled=true` (nie wyłączył się przy okazji)

## Audit log

- [ ] W `schedule_audit_log` istnieje wpis przy każdym toggle togglu z diff `includeGdriveRestore: {from: X, to: Y}`
- [ ] Wpis ma identyfikator operatora (X-Operator-Id z Better Auth session)
- [ ] Brak duplicate entries dla no-op zapisów

## Rollback path (jeśli coś pójdzie nie tak)

- W UI: odznacz checkbox → cron wraca do trybu ingest+backup z PRD-008 (bez DB rollback)
- W env: `OPERATOR_NOTIFY_SUCCESS=false` wyłącza success notifications
- Cofnięcie kolumny DB: `ALTER TABLE deployment_schedules DROP COLUMN include_gdrive_restore` (dane stracone — tylko jeśli flaga była nieistotna)

## Definition of done

- Wszystkie checkboxy powyżej zaznaczone
- Zero unexplained Telegram/email alerts w ciągu 48h obserwacji
- Operator akceptuje feature jako gotowy do produkcji
