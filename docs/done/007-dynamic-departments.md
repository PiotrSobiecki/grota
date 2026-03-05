# 007: Dynamiczne dzialy (departamenty) per wdrozenie

## Cel

Zastapienie hardkodowanego enuma `employee_role` (zarzad, ksiegowosc, projekty, media) dynamicznymi dzialami definiowanymi per wdrozenie + umozliwienie przypisania pracownika do wielu dzialow.

## Kontekst

Obecny model: `employees.role` to pg enum `employee_role` z 4 wartosciami. Operator nie moze dodac nowych dzialow. Pracownik moze byc przypisany do dokladnie 1 dzialu.

Zmiana wymaga:
1. Operator definiuje dzialy per deployment (nie globalny enum)
2. Predefiniowane sugestie przyspieszaja konfiguracje
3. Pracownik moze nalezec do wielu dzialow (M:N)

## Wymagania wstepne

- Doc 003a/b zaimplementowane (tabela employees istnieje z kolumna `role`)

## Zakres

### IN

- Nowa tabela `deployment_departments` (dzialy per wdrozenie)
- Nowa tabela lacznikowa `employee_departments` (M:N)
- Predefiniowane sugestie dzialow (UI-only, nie DB)
- Usuwanie kolumny `role` z tabeli `employees` (z migracja danych)
- Usuwanie pg enum `employee_role`
- Aktualizacja API: CRUD dzialow, bulk create employees z tablicami dzialow
- Aktualizacja UI: wizard step 4 (multi-select dzialow), deployment detail (zarzadzanie dzialami)
- Aktualizacja config JSON export (tablica dzialow zamiast pojedynczego role)

### OUT

- Uprawnienia per dzial (Google Groups mapping -- to Phase 2 server scripts)
- Hierarchia dzialow
- Limity przypisania (kazda kombinacja dozwolona)

---

## Analiza stanu obecnego

### Hardkodowane wartosci -- lokalizacje w kodzie

| Plik | Typ | Wartosc |
|------|-----|---------|
| `packages/data-ops/src/employee/table.ts` | pg enum `employee_role` | `zarzad, ksiegowosc, projekty, media` |
| `packages/data-ops/src/employee/schema.ts` | Zod enum `EmployeeRoleSchema` | j.w. |
| `apps/user-application/src/routes/onboard/$token.tsx` | `ROLE_OPTIONS` const + `EmployeeRow` interface | j.w. |
| `apps/user-application/src/core/functions/employees/binding.ts` | z.enum inline w `bulkCreateEmployees` | j.w. |
| `packages/data-ops/src/drizzle/migrations/dev/0004_wonderful_iceman.sql` | CREATE TYPE | j.w. |

### Uzycie `role` w downstream docs (kolejka)

| Doc | Gdzie uzyte | Wplyw zmiany |
|-----|------------|--------------|
| **PLAN.md** | Data model `employees.role: enum(...)`, Config JSON `"role": "ksiegowosc"`, Google Groups mapping `zarzad@{domain}` etc. | Zaktualizowac model + JSON shape + Groups mapping |
| **003a** | `employeeRoleEnum` definicja, `EmployeeRoleSchema`, `EmployeeCreateRequestSchema.role` | ZAIMPLEMENTOWANE -- wymaga migracji |
| **003b** | Wizard step 4 dropdown z 4 wartosciami, `POST /employees/bulk` z role field | ZAIMPLEMENTOWANE -- wymaga migracji |
| **005a** | Brak bezposredniego uzycia role (folder categories sa oddzielne od rol) | Bez zmian |
| **005b** | Brak bezposredniego uzycia role | Bez zmian |
| **006a** | Config assembly: `account.role` w `ConfigAssemblyData` i `ConfigJsonSchema` | NIE ZAIMPLEMENTOWANE -- zaktualizowac spec |
| **006b** | Config export: `role` w JSON output | NIE ZAIMPLEMENTOWANE -- zaktualizowac spec |

---

## Proponowane zmiany schematu

### Nowa tabela: `deployment_departments`

```ts
// packages/data-ops/src/department/table.ts
import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { deployments } from "../deployment/table";

export const deploymentDepartments = pgTable("deployment_departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  deploymentId: uuid("deployment_id")
    .notNull()
    .references(() => deployments.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // np. "Ksiegowosc", "IT", "Marketing"
  slug: text("slug").notNull(), // np. "ksiegowosc", "it", "marketing" (dla Google Groups)
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Unique constraint**: `(deployment_id, slug)` -- nie mozna miec 2 dzialow o tym samym slug w jednym wdrozeniu.

### Nowa tabela: `employee_departments` (M:N)

```ts
// packages/data-ops/src/department/table.ts (ten sam plik)
import { employees } from "../employee/table";

export const employeeDepartments = pgTable("employee_departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  departmentId: uuid("department_id")
    .notNull()
    .references(() => deploymentDepartments.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Unique constraint**: `(employee_id, department_id)` -- pracownik nie moze byc przypisany 2x do tego samego dzialu.

### Usuniecie z tabeli `employees`

- Usunac kolumne `role`
- Usunac pg enum `employee_role`

### Predefiniowane sugestie (stala, nie DB)

```ts
// packages/data-ops/src/department/schema.ts
export const MAX_DEPARTMENTS_PER_DEPLOYMENT = 10;

export const DEPARTMENT_SUGGESTIONS = [
  { name: "Zarzad", slug: "zarzad" },
  { name: "Ksiegowosc", slug: "ksiegowosc" },
  { name: "Projekty", slug: "projekty" },
  { name: "Media", slug: "media" },
  { name: "Marketing", slug: "marketing" },
  { name: "Sprzedaz", slug: "sprzedaz" },
  { name: "IT", slug: "it" },
  { name: "Finanse", slug: "finanse" },
  { name: "Prawo", slug: "prawo" },
  { name: "Operacje", slug: "operacje" },
] as const;
```

---

## Strategia migracji

Projekt w fazie dev, brak danych produkcyjnych -- migracja uproszczona (1 krok):

1. Utworzyc tabele `deployment_departments` i `employee_departments`
2. Usunac kolumne `employees.role`
3. Usunac pg enum `employee_role`
4. Zaktualizowac schematy Zod, queries, services, UI
5. `pnpm run seed:dev` -- reseed z nowymi dzialami

---

## Zmiany API

### Nowe endpointy

| Method | Path | Auth | Cel |
|--------|------|------|-----|
| `GET` | `/departments/:deploymentId` | Bearer | Lista dzialow wdrozenia |
| `POST` | `/departments/:deploymentId` | Bearer / Public (wizard) | Utworz dzial |
| `DELETE` | `/departments/:id` | Bearer | Usun dzial |

### Zmodyfikowane endpointy

| Method | Path | Zmiana |
|--------|------|--------|
| `POST` | `/employees/bulk` | `role: string` -> `departmentIds: string[]` |
| `GET` | `/employees/deployment/:id` | Response wzbogacony o `departments: Department[]` per employee |
| `GET` | `/config/preview/:id` | `role: string` -> `departments: string[]` per account |
| `POST` | `/config/export/:id` | j.w. |

### Nowe Zod schemas

```ts
// packages/data-ops/src/department/schema.ts
export const DepartmentSchema = z.object({
  id: z.string().uuid(),
  deploymentId: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50),
  sortOrder: z.number().int().min(0),
  createdAt: z.coerce.date(),
});

export const DepartmentCreateRequestSchema = z.object({
  name: z.string().min(1, "Nazwa dzialu jest wymagana").max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, "Slug: male litery, cyfry, myslnik"),
});

export type Department = z.infer<typeof DepartmentSchema>;
```

### Zmiana `EmployeeCreateRequestSchema`

```ts
// Przed:
export const EmployeeCreateRequestSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: EmployeeRoleSchema, // z.enum(["zarzad", ...])
});

// Po:
export const EmployeeCreateRequestSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  departmentIds: z.array(z.string().uuid()).min(1, "Przynajmniej jeden dzial wymagany"),
});
```

### Zmiana Config JSON shape

```ts
// Przed (006a):
accounts: z.array(z.object({
  email: z.string(),
  name: z.string(),
  role: z.string(),              // <-- pojedyncza rola
  oauth_refresh_token: z.string().nullable(),
  folders: z.array(...),
}))

// Po:
accounts: z.array(z.object({
  email: z.string(),
  name: z.string(),
  departments: z.array(z.object({ name: z.string(), slug: z.string() })),  // <-- tablica obiektow
  oauth_refresh_token: z.string().nullable(),
  folders: z.array(...),
}))
```

---

## Zmiany UI

### Tworzenie wdrozenia (`/_auth/dashboard/new`)

Dodac sekcje "Dzialy" z:
- Checkboxy predefiniowanych sugestii (szybki wybor)
- Input "Dodaj wlasny dzial" + przycisk
- Lista wybranych dzialow z mozliwoscia usuwania
- Domyslnie zaznaczone: zarzad, ksiegowosc, projekty, media (backward compat)

### Deployment detail (`/_auth/dashboard/$id`)

Dodac karte "Dzialy wdrozenia":
- Lista obecnych dzialow
- Mozliwosc dodania/usuniecia dzialu (jesli status < employees_pending)

### Wizard step 4 (`/onboard/$token`)

Zmiana z `<select>` (single role) na multi-select dzialow:
- Pobiera liste dzialow z `GET /departments/:deploymentId`
- Checkbox-based multi-select per pracownik
- Min 1 dzial wymagany per pracownik

### Status page (`/status/$token`)

Zmiana wyswietlania roli: zamiast "Ksiegowosc" -> "Ksiegowosc, Zarzad" (lista dzialow).

---

## Wplyw na istniejace design docs

### Zaimplementowane (wymagaja migracji kodu)

| Doc | Co zmieniac | Priorytet |
|-----|------------|-----------|
| **003a** | `employee/table.ts`: usunac `role` + enum. `employee/schema.ts`: usunac `EmployeeRoleSchema`, zmienic `EmployeeCreateRequestSchema`. `employee/index.ts`: usunac export enum. | Wysoki |
| **003b** | `employee-handlers.ts` / `employee-service.ts`: `bulkCreateEmployees` musi tworzyc rekordy w `employee_departments`. `onboard/$token.tsx`: zmiana UI z select na multi-select. `binding.ts`: zmiana z.enum na z.array(uuid). | Wysoki |

### W kolejce (wymagaja aktualizacji specyfikacji)

| Doc | Co zmieniac |
|-----|------------|
| **006a** | `ConfigAssemblyData.accounts[].role` -> `.departments: string[]`. `ConfigJsonSchema.accounts[].role` -> `.departments`. Assembly query: JOIN z `employee_departments` + `deployment_departments`. |
| **006b** | Config JSON output: `departments` zamiast `role`. |
| **PLAN.md** | Data model (employees bez role), Config JSON shape, Google Groups mapping (dynamiczne na podstawie deployment_departments slugs zamiast hardkodowanych 4 grup). |

### Bez zmian

| Doc | Powod |
|-----|-------|
| **001** | Bootstrap -- brak odwolan do role |
| **002a/b** | Deployment CRUD -- brak odwolan do role |
| **004a/b** | OAuth -- brak odwolan do role |
| **005a/b** | Folder selection -- kategorie folderow sa niezalezne od ról pracownikow |

---

## Plan implementacji

### 1. Nowy domain `department` w data-ops
- `department/table.ts` (obie tabele + constraints)
- `department/schema.ts` (Zod schemas + DEPARTMENT_SUGGESTIONS + types)
- `department/queries.ts` (CRUD dzialy, M:N operacje)
- `department/index.ts` (barrel)
- Dodac export `"./department"` do `package.json`
- Relacje w `drizzle/relations.ts`

### 2. Migracja DB
- Generacja migracji (nowe tabele)
- Custom SQL: migracja danych z `employees.role` do nowych tabel
- Usuwanie `employees.role` + enum `employee_role`

### 3. Aktualizacja employee domain w data-ops
- Usunac `employeeRoleEnum` z `table.ts`
- Usunac `EmployeeRoleSchema` z `schema.ts`
- Zmienic `EmployeeCreateRequestSchema`: `role` -> `departmentIds`
- Zmienic `EmployeeSchema`: usunac `role`, dodac `departments` (opcjonalnie -- lub JOIN w query)
- Zaktualizowac `queries.ts`: `createEmployees` tworzy tez employee_departments

### 4. Aktualizacja data-service
- Nowe `handlers/department-handlers.ts` + `services/department-service.ts`
- Aktualizacja `employee-service.ts` (bulkCreate z departmentIds)
- Rejestracja route `/departments` w `app.ts`

### 5. Aktualizacja user-application
- Nowe server functions: `getDepartments`, `createDepartment`, `deleteDepartment`
- `routes/_auth/dashboard/new.tsx`: sekcja dzialow z sugestiami
- `routes/_auth/dashboard/$id.tsx`: karta zarzadzania dzialami
- `routes/onboard/$token.tsx`: multi-select dzialow w step 4
- `routes/status/$token.tsx`: lista dzialow zamiast single role
- `core/functions/employees/binding.ts`: zmiana walidacji

### 6. Aktualizacja specyfikacji doc 006a/b
- Config assembly query: JOIN employee_departments + deployment_departments
- Config JSON shape: `departments: string[]` zamiast `role: string`

### 7. Lint + test
- `pnpm run lint:fix && pnpm run lint`
- Manualne testy flow: create deployment z dzialami -> wizard -> employee multi-assign

---

## Decyzje (rozwiazane pytania)

1. **Edycja dzialow po dodaniu pracownikow**: TAK -- operator/admin moze edytowac dzialy w dowolnym momencie. Usuniecie dzialu NIE usuwa przypisania pracownikow (soft: dzial znika z listy ale historyczne przypisania zostaja, lub: blokada usuniecia dzialu z przypisanymi pracownikami -- do ustalenia w implementacji).
2. **Slug**: generowany automatycznie z `name` (slugify). Prostsze UX.
3. **Cleanup enum**: usunac `employee_role` enum w tej samej migracji (jedna migracja 3-fazowa). Projekt nie jest na produkcji -- nie trzeba backward compat.
4. **Config JSON `departments`**: tablica obiektow `[{name, slug}]` -- pelniejsza informacja.
5. **Max dzialow per deployment**: 10 (konfigurowalne -- stala w `department/schema.ts`, latwo edytowalna).
6. **PLAN.md Google Groups mapping**: aktualizowac teraz -- dynamiczne grupy na podstawie `deployment_departments.slug` zamiast hardkodowanych 4.
7. **Migracja istniejacych wdrozen**: POMIJALNE -- projekt w fazie development, brak danych produkcyjnych. Migracja danych niepotrzebna, mozna usunac `role` + enum od razu.
