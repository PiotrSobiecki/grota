# Plan testow manualnych

Zweryfikowany z kodem. Oznaczenia: `[x]` = checkbox do odhaczenia podczas testow.

---

## OPERATOR

### A. Deployment CRUD

- [ ] **A1. Stworzenie deployment** `/dashboard/new`
  - [ ] Wypelnij client name (req), domain (req)
  - [ ] Admin email + name opcjonalne
  - [ ] Wybor departamentow: sugestie (toggle) + custom input (Enter dodaje)
  - [ ] Submit → redirect na detail page
  - [ ] Walidacja: pusty client name / domain → blad inline

- [ ] **A2. Lista wdrozen** `/dashboard`
  - [ ] Karty z nazwa klienta, domena, badge statusu (PL labels)
  - [ ] Klikniecie karty → detail page
  - [ ] Empty state "Brak wdrozen" gdy lista pusta
  - [ ] Brak filtrowania/paginacji w UI (hardcode limit 20)

- [ ] **A3. Detail page** `/dashboard/$id`
  - [ ] Wyswietla: client name, domain, admin email/name
  - [ ] Badge statusu w naglowku
  - [ ] Przycisk powrotu do listy

- [ ] **A4. Departamenty na detail**
  - [ ] Wyswietla liste departamentow jako tagi
  - [ ] Dodaj nowy: input + przycisk Plus
  - [ ] Usun: ikona trash na tagu
  - [ ] Create/delete dziala tylko w draft/onboarding
  - [ ] W innym statusie → brak przyciskow edycji
  - [ ] Rename departamentu — NIE ISTNIEJE (doc 008b)

### B. Magic link & pracownicy

- [ ] **B1. Generuj magic link** (detail page, karta "Status wdrozenia")
  - [ ] Status draft → przycisk "Generuj i wyslij link"
  - [ ] Klik → email wyslany, status draft → onboarding
  - [ ] Link URL w code block + przycisk kopiuj
  - [ ] Status != draft → "Wyslij ponownie"
  - [ ] Status active → przycisk disabled

- [ ] **B2. Sekcja pracownikow** (detail page)
  - [ ] Widoczna dopiero gdy status != draft && != onboarding
  - [ ] Per pracownik: imie, email, departamenty
  - [ ] Badge OAuth: Oczekuje / Autoryzowany / Blad
  - [ ] Badge Selection: Oczekuje / W trakcie / Ukonczony
  - [ ] Licznik "X/Y pracownikow ukonczylo"

- [ ] **B3. Wyslij linki pracownikom** (detail page, bulk button)
  - [ ] Przycisk "Wyslij linki pracownikom"
  - [ ] Success: "Wyslano linki do X pracownikow"
  - [ ] Disabled gdy: brak pracownikow, status active, pending request
  - [ ] Loading spinner

### C. Config & export

- [ ] **C1. Config preview** `/dashboard/$id/config`
  - [ ] Link widoczny na detail gdy status ready/active
  - [ ] JSON w `<pre>` block
  - [ ] Summary card: client name, employee count, folder count (bez prywatnych)

- [ ] **C2. Security notice**
  - [ ] Alert o plaintext tokenach w R2
  - [ ] Info ze tokeny mozna cofnac w Google

- [ ] **C3. Server access card**
  - [ ] Env vars: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT
  - [ ] Przykład rclone + curl z AWS Sig V4
  - [ ] Deployment ID interpolowany w sciezkach

- [ ] **C4. Export do R2**
  - [ ] Przycisk "Eksportuj do R2"
  - [ ] Po sukcesie: badge "Wyeksportowano", klucz R2 `configs/{id}/config.json`
  - [ ] Status ready → active
  - [ ] "Eksportuj ponownie" — nadpisanie

- [ ] **C5. Notyfikacje przy eksporcie**
  - [ ] Telegram: sprawdz wiadomosc na czacie bota
  - [ ] Email do admin_email via Resend
  - [ ] Brak manualnego triggera w UI (doc 008c doda)

---

## CLIENT ADMIN

### A. Magic link & weryfikacja

- [ ] **A1. Poprawny token** → `/onboard/$token` laduje wizard
- [ ] **A2. Wygasly token** (7 dni) → komunikat bledu
- [ ] **A3. Nieprawidlowy token** → error

### B. Wizard step 1 — Dane firmy

- [ ] **B1.** Wyswietla clientName, domain, adminEmail, adminName read-only
- [ ] **B2.** Przycisk "Dalej" przechodzi do step 2

### C. Wizard step 2 — OAuth Google Workspace

- [ ] **C1. Trust panel** — scope: foldery + grupy Google / NIE: tresci dokumentow, wiadomosci
- [ ] **C2.** Info o szyfrowaniu AES-256-GCM
- [ ] **C3.** "Autoryzuj Google Workspace" → redirect do Google
- [ ] **C4.** Powrot z `?oauth=success` → success state
- [ ] **C5.** Odmowa consent → obsługa bledu

### D. Wizard step 3 — Delegat administracyjny

- [ ] **D1.** Email do skopiowania (przycisk copy)
- [ ] **D2.** Link do Google Admin console
- [ ] **D3.** Numerowany checklist (nowa rola + przypisanie)
- [ ] **D4.** Checkbox "Dodalem/am delegata" — wymagany przed "Dalej"

### E. Wizard step 4 — Lista pracownikow

- [ ] **E1.** Dynamiczny formularz: add/remove wierszy
- [ ] **E2.** Pola: email (walidacja), name (req), departmentIds (multi-select dropdown)
- [ ] **E3.** Multi-select: checkboxy, min 1 departament wymagany
- [ ] **E4.** Submit → bulk create → status onboarding → employees_pending
- [ ] **E5.** Success screen "Pracownicy zostali dodani"
- [ ] **E6.** Walidacja: brak email, brak departamentu, duplikaty

### F. Status page `/status/$token`

- [ ] **F1.** Licznik "X/Y pracownikow ukonczylo autoryzacje"
- [ ] **F2.** Per pracownik: imie, email, departamenty, OAuth badge
- [ ] **F3.** "Wyslij ponownie" — disabled jesli authorized
- [ ] **F4.** Rate limit: 5 min, tooltip "Mozna wyslac ponownie za 5 minut"
- [ ] **F5.** Auto-refresh co 30s

---

## EMPLOYEE

### A. Magic link

- [ ] **A1.** `/employee/$token` — poprawny token laduje strone
- [ ] **A2.** Wygasly / nieprawidlowy token → error

### B. Step 1 — OAuth Google Drive

- [ ] **B1. Trust panel** — co zobaczy: nazwy folderow top-level / NIE: tresci plikow, pliki wewnatrz
- [ ] **B2.** Link do cofniecia dostepu (myaccount.google.com/permissions)
- [ ] **B3.** "Autoryzuj Google Drive" → redirect → callback → `?oauth=success`
- [ ] **B4.** `oauth_status` → authorized
- [ ] **B5.** Odmowa consent → obsluga bledu

### C. Step 2 — Folder listing

- [ ] **C1.** Fetch `/folders/drive/{employeeId}` → loading spinner
- [ ] **C2.** Komponent zwraca null po uzyskaniu danych — auto-advance do step 3
- [ ] **C3.** Brak wizualnego feedbacku po uzyskaniu folderow (doc 008d naprawi)
- [ ] **C4.** Status pending → in_progress
- [ ] **C5.** Error → retry button
- [ ] **C6.** Token refresh automatyczny (wygasly access_token)

### D. Step 3 — Tagowanie kategorii

- [ ] **D1.** Lista folderow z dropdown: dokumenty, projekty, media, prywatne
- [ ] **D2.** Auto-sugestie: faktur* → dokumenty, projekt* → projekty, zdj*/foto* → media
- [ ] **D3.** Zmiana kategorii z sugestii na inna
- [ ] **D4.** Licznik "N z M folderow do backupu" (bez prywatnych)
- [ ] **D5.** Przycisk disabled jesli wszystkie prywatne

### E. Step 4 — Potwierdzenie

- [ ] **E1.** Grid: kategoria + liczba folderow (tylko non-zero)
- [ ] **E2.** "Zatwierdz wybor" → POST `/folders/selections`
- [ ] **E3.** `selection_status` → completed
- [ ] **E4.** Idempotentnosc: podwojny zapis nie duplikuje
- [ ] **E5.** Success: "Wybor zapisany pomyslnie"
- [ ] **E6.** Auto-transition: wszyscy completed → deployment employees_pending → ready

---

## CROSS-CUTTING

- [ ] **X1. Health** — `GET /health/live` → 200, `GET /health/ready` → 200 (DB check)
- [ ] **X2. Szyfrowanie** — tokeny w DB = `{iv_hex}:{ciphertext_hex}`, nie plaintext
- [ ] **X3. Status machine** — draft → onboarding → employees_pending → ready → active (brak skip, brak cofania)
- [ ] **X4. R2** — `configs/{id}/config.json` istnieje po eksporcie
- [ ] **X5. Config JSON shape** — `deployment_id`, `workspace.refresh_token`, `accounts[].folders[]`, `departments: [{name, slug}]`
- [ ] **X6. Branding** — tytul "Grota", content PL, brak i18n
- [ ] **X7. Auth gate** — `/_auth/*` wymaga sesji; niezatwierdzeni widza "Konto oczekuje" + sign out
- [ ] **X8. Idempotentnosc** — folder selections nadpisuja istniejace

---

## ZNANE BRAKI (design docs 008a-d)

| # | Brak | Doc |
|---|------|-----|
| 1 | Filtrowanie/paginacja listy wdrozen (backend gotowy, UI brak) | 008a |
| 2 | Rename departamentu + counter X/10 + limit feedback | 008b |
| 3 | Manual trigger notyfikacji Telegram/email | 008c |
| 4 | Formularz edycji detail page (PUT istnieje, UI read-only) | 008c |
| 5 | Folder step 2 nie pokazuje wyniku (auto-advance bez feedbacku) | 008d |
| 6 | Mobile sidebar (placeholder, nie dziala) | 008d |
