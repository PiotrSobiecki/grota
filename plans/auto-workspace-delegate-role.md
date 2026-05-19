# Plan: Automatyczne przypisanie roli delegata Workspace (krok 3 onboardingu)

> Status: **do zrobienia później** (nie w scope bieżącego onboardingu)  
> Kontekst: obecnie krok 3 to ręczna checklista w Google Admin + checkbox honor system.  
> Powiązane: `workspace_delegate_email` na `deployments`, OAuth admina w kroku 2 (`workspace_oauth_token`).

## 2026-05-19 — pole zakomentowane w UI

Cala opcja delegata Workspace **tymczasowo wylaczona** do czasu implementacji tego planu:

- `apps/user-application/src/routes/_auth/dashboard/new.tsx` — pole `workspaceDelegateEmail` (form.Field + defaultValue + mutationFn payload) zakomentowane
- `packages/data-ops/src/deployment/schema.ts` — `workspaceDelegateEmail` w `DeploymentCreateRequestSchema` zmienione na `.optional()`, cross-field `superRefine` zakomentowany
- `packages/data-ops/src/deployment/queries.ts` — `createDeployment` zapisuje `workspaceDelegateEmail ?? null`
- Kolumna `workspace_delegate_email` w DB pozostaje (nullable) — bez migracji
- Onboarding `/onboard/$token` nadal renderuje `DelegateChecklistStep` z fallbackiem dla `workspaceDelegateEmail = null` — bez zmian

Do odkomentowania razem z implementacja Admin SDK z tego planu.

## Problem

Admin klienta musi ręcznie w [admin.google.com](https://admin.google.com):

1. utworzyć rolę z uprawnieniami (Dysk i Dokumenty — ustawienia, Grupy CRUD),
2. przypisać ją do adresu z pola **Delegat Workspace** (np. `piotr@sobiecki.org`).

Grota **nie weryfikuje** wykonania tego kroku — checkbox „Dodałem/am delegata” jest tylko w UI przeglądarki.

## Cel produktowy

Po OAuth admina w kroku 2 (lub jako osobny krok 3) Grota **programowo**:

- utworzy (lub znajdzie) custom rolę z wymaganymi przywilejami,
- przypisze ją użytkownikowi `workspace_delegate_email`,
- pokaże w UI wynik sukcesu / błędu z czytelnym komunikatem.

Opcjonalnie: krok 3 ręczny zostaje jako **fallback** („zrób sam w Admin Console”).

## Co już działa bez tego planu

| Mechanizm | Po co |
|-----------|--------|
| `workspace_oauth_token` (krok 2) | API Drive + `admin.directory.group` — migracja, backup, restore, grupy |
| `workspace_delegate_email` | Adres pokazywany klientowi / zapisany przez operatora |
| Krok 3 (ręczny) | Dostęp człowieka do konsoli Google (Shared Drives, ustawienia poza API) |

**Wniosek:** automatyzacja kroku 3 **nie jest wymagana**, żeby Grota robiła backup/migrację przez API. Ma sens, jeśli chcemy **eliminować ręczną pracę IT** przy nadawaniu wąskiej roli admina.

## Rozwiązanie techniczne (Google)

[Admin SDK Directory API — Manage roles](https://developers.google.com/workspace/admin/directory/v1/guides/manage-roles):

| Krok API | Metoda | Opis |
|----------|--------|------|
| 1 | `GET .../customer/{customerId}/roles/ALL/privileges` | Lista przywilejów w domenie — mapowanie z checklisty UI |
| 2 | `POST .../customer/{customerId}/roles` | Utworzenie roli custom (np. `Grota Delegate`) z `rolePrivileges[]` |
| 3 | `GET users` po email | `assignedTo` = `user.id` delegata |
| 4 | `POST .../customer/{customerId}/roleassignments` | Przypisanie `roleId` → użytkownik, `scopeType: CUSTOMER` |

Idempotentność:

- przed `roles.insert` — `roles.list`, szukaj po stałej `roleName` (np. `GROTA_DELEGATE`),
- przed `roleAssignments.insert` — `roleAssignments.list` dla `userKey` delegata; 409 / duplikat = sukces.

### Wymagany OAuth (rozszerzenie względem dziś)

Obecne scope admina (`apps/data-service/src/hono/services/oauth-service.ts`):

- `admin.directory.group`
- `drive`

**Dodać:**

- `https://www.googleapis.com/auth/admin.directory.rolemanagement`
- ewentualnie `https://www.googleapis.com/auth/admin.directory.user.readonly` (jeśli nie wynika z innych scope) — do `users.get` po email

Aktualizacje:

- Google Cloud Console — OAuth consent screen (nowe scope, weryfikacja jeśli external),
- trust panel kroku 2 onboardingu,
- `SETUP.md` / `WDROZENIE-KLIENT.md`.

### Kto może wywołać API

Token z kroku 2 musi należeć do konta z prawem **zarządzania rolami administratora** (zwykle Super Admin lub rola z `rolemanagement`).  
Jeśli admin klienta ma tylko wąską rolę — flow musi **wyświetlić błąd** i zostawić ręczną checklistę.

## Mapowanie przywilejów (do ustalenia w spike)

Checklista w UI (`onboard/$token.tsx`):

- Dysk i Dokumenty (Ustawienia)
- Grupy (Tworzenie, Usuwanie, Odczyt, Aktualizowanie)

W API nazwy to `privilegeName` + `serviceId` (nie 1:1 z polskimi etykietami w konsoli).  
**Spike (0.5–1 dzień):** na jednej domenie testowej wywołać `privileges.list`, zapisać JSON, dobrać minimalny zestaw (np. `GROUPS_*`, uprawnienia Drive admin settings).  
Stała w kodzie: `GROTA_DELEGATE_PRIVILEGES` + wersjonowanie jeśli Google zmieni API.

## Decyzje architektoniczne (propozycja)

| Temat | Decyzja |
|-------|---------|
| Kiedy uruchamiać | Po udanym OAuth kroku 2 **lub** przycisk „Przypisz rolę automatycznie” w kroku 3 |
| Serwis | `apps/data-service` — nowy `workspace-role-service.ts` (jak `google-drive-api-service.ts`) |
| Token | Reuse `getValidWorkspaceAccessToken` / decrypt `workspace_oauth_token` |
| Stan w DB | Nowe pola na `deployments`: `delegate_role_assigned_at`, `delegate_role_id`, `delegate_role_assignment_error` (nullable text) — **opcjonalne**; minimum: log + UI w wizardzie |
| Krok 3 UI | Sukces → ukryj checklistę / auto-zaznacz; błąd → pokaż API message + link do ręcznej instrukcji |
| Bezpieczeństwo | Tylko `workspace_delegate_email` z tego deploymentu; walidacja `@domain`; brak nadawania roli na arbitralny email z requestu |
| Feature flag | `ENABLE_AUTO_DELEGATE_ROLE` w `wrangler` vars — wyłączenie na prod bez deployu kodu |

## Zakres

### IN (MVP automatyzacji)

- Spike mapowania przywilejów
- Rozszerzenie OAuth scope + consent
- `ensureGrotaDelegateRole(customerId, token)` → `roleId`
- `assignDelegateRole(customerId, token, roleId, delegateUserId)` → idempotent
- Endpoint `POST /onboarding/:deploymentId/assign-delegate` (magic link / deployment id + walidacja tokenu admina)
- Integracja w wizardzie krok 3 (przycisk + status)
- Testy jednostkowe mapowania + integracyjny test z mock Google (Vitest)

### OUT (później)

- Tworzenie użytkownika delegata, jeśli nie istnieje (`users.insert`) — na razie wymagamy istniejącego konta w domenie
- Przypisanie do OU innej niż root (`scopeType: ORG_UNIT`)
- Przypisanie roli do grupy security
- Usuwanie / rollback roli przy offboardingu klienta
- Weryfikacja okresowa „czy rola nadal jest” (cron)

## Fazy implementacji

### Faza 0: Spike (bloker)

- [ ] `privileges.list` na domenie dev/staging klienta
- [ ] Udokumentować `privilegeName` + `serviceId` dla Dysk (ustawienia) + Grupy
- [ ] Potwierdzić, że token Super Admina przechodzi `roleAssignments.insert`
- [ ] Output: sekcja w tym pliku lub `docs/part-c/improvements/010-auto-workspace-delegate-role.md` z tabelą mapowania

### Faza 1: Tracer bullet (API bez pełnego UI)

- [ ] Scope OAuth rozszerzone, migracja niepotrzebna (tylko env/consent)
- [ ] `workspace-role-service.ts`: create/find role + assign
- [ ] Handler chroniony tokenem admin onboardingu (ten sam co magic link verify)
- [ ] Ręczne wywołanie z curl / tymczasowy przycisk w dev
- [ ] Smoke: po OAuth przypisanie roli do `workspace_delegate_email` widoczne w Google Admin

### Faza 2: Wizard + stan

- [ ] Krok 3: „Przypisz automatycznie” + spinner + komunikat błędu PL
- [ ] Opcjonalne kolumny DB + `delegate_role_assigned_at`
- [ ] Checkbox „Dodałem/am delegata” opcjonalny przy sukcesie API lub wymuszony przy błędzie API
- [ ] Aktualizacja trust panelu kroku 2 (nowe scope)

### Faza 3: Operacje i dokumentacja

- [ ] Runbook w `SETUP.md`: kiedy automatyzacja zawiedzie, co robi operator
- [ ] Feature flag prod
- [ ] E2E checklist w `docs/done/E2E.md`

## Alternatywa produktowa (bez API roli)

- Oznaczyć krok 3 jako **„Opcjonalne — tylko jeśli operator potrzebuje ręcznego dostępu do Admin Console”**
- Domyślnie **pomiń** przy samym OAuth (krok 2 wystarczy do automatyzacji Grota)
- Mniejszy koszt, zero nowych scope OAuth

## Ryzyka

| Ryzyko | Mitygacja |
|--------|-----------|
| Google odrzuca scope `rolemanagement` bez weryfikacji app | Wcześniejszy submit consent screen; fallback ręczny krok 3 |
| Admin klienta nie jest Super Adminem | Wykryć błąd 403, komunikat PL + checklista |
| Zmiana nazw przywilejów w API | Stała wersjonowana + monitoring przy deploy |
| Nadanie zbyt szerokich uprawnień | Minimalny zestaw z spike; code review mapowania |

## Kryteria akceptacji (całość)

- [ ] Po OAuth Super Admina i ustawionym `workspace_delegate_email` jednym kliknięciem rola jest w Admin Console bez ręcznego tworzenia
- [ ] Powtórne kliknięcie nie tworzy duplikatów ról/przypisań
- [ ] Błąd API nie blokuje przejścia onboardingu (fallback ręczny)
- [ ] Istniejący flow migracji/backup bez zmian gdy krok 3 pominięty
- [ ] `pnpm run lint` + `pnpm run types` + testy serwisu przechodzą

## Pliki do dotknięcia (szacunek)

- `apps/data-service/src/hono/services/oauth-service.ts` — scope
- `apps/data-service/src/hono/services/workspace-role-service.ts` — **nowy**
- `apps/data-service/src/hono/handlers/` — route assign-delegate
- `apps/user-application/src/routes/onboard/$token.tsx` — UI krok 3
- `packages/data-ops/src/deployment/table.ts` — opcjonalne kolumny statusu
- `SETUP.md`, ewentualnie `docs/part-c/improvements/010-auto-workspace-delegate-role.md` — link do spike output

## Odniesienia

- [Manage roles (Directory API)](https://developers.google.com/workspace/admin/directory/v1/guides/manage-roles)
- [roleAssignments.insert](https://developers.google.com/workspace/admin/directory/reference/rest/v1/roleAssignments/insert)
- Obecny krok 3: `apps/user-application/src/routes/onboard/$token.tsx` (`DelegateChecklistStep`)
- OAuth admin: `apps/data-service/src/hono/services/oauth-service.ts`
