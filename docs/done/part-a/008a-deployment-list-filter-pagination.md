# 008a: Filtrowanie i paginacja listy wdrozen

## Cel

Dodanie kontrolek filtrowania po statusie i paginacji prev/next do strony listy wdrozen. Backend juz obsluguje `limit`, `offset`, `status` — brakuje tylko UI.

## Kontekst

`/_auth/dashboard/index.tsx` hardkoduje `{limit: 20, offset: 0}` w loaderze. Operator nie moze filtrowac ani przechodzic miedzy stronami.

## Zakres

### IN

- Dropdown filtra statusu (wszystkie + 5 statusow)
- Paginacja prev/next z wskaznikiem "Strona X z Y"
- Stan w TanStack Router search params (linkable URLs)
- Istniejace komponenty shadcn/ui: `Select`, `Button`

### OUT

- Sortowanie, szukanie tekstowe
- Tabela (zostaje obecny card layout)
- Zmiany backendowe (API juz gotowe)

---

## Stan URL (search params)

```ts
// validateSearch na route /_auth/dashboard/
import { z } from "zod"
import { DeploymentStatusSchema } from "@repo/data-ops/deployment"

const searchSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  status: DeploymentStatusSchema.optional().catch(undefined),
})
```

Przyklady URL:
- `/dashboard` — strona 1, wszystkie statusy
- `/dashboard?page=2&status=active` — strona 2, tylko aktywne

## Przeliczanie limit/offset

```ts
const PAGE_SIZE = 20

// w loaderze
const { page, status } = search
const offset = (page - 1) * PAGE_SIZE
listDeployments({ data: { limit: PAGE_SIZE, offset, status } })
```

## Obliczanie totalPages

```ts
const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit))
```

## Implementacja

### 1. Route definition — loader + validateSearch

```tsx
export const Route = createFileRoute("/_auth/dashboard/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps: { page, status } }) => {
    const offset = (page - 1) * PAGE_SIZE
    return listDeployments({ data: { limit: PAGE_SIZE, offset, status } })
  },
  component: DeploymentListPage,
})
```

`loaderDeps` zapewnia re-fetch przy zmianie search params.

### 2. Filtr statusu

Komponent `Select` z shadcn/ui. Wartosc "all" = brak filtra (undefined w URL).

```tsx
const STATUS_OPTIONS = [
  { value: "all", label: "Wszystkie" },
  { value: "draft", label: "Szkic" },
  { value: "onboarding", label: "Onboarding" },
  { value: "employees_pending", label: "Oczekuje na pracownikow" },
  { value: "ready", label: "Gotowe" },
  { value: "active", label: "Aktywne" },
] as const

function StatusFilter() {
  const { status } = Route.useSearch()
  const navigate = useNavigate()

  return (
    <Select
      value={status ?? "all"}
      onValueChange={(val) =>
        navigate({
          search: (prev) => ({
            page: 1, // reset na strone 1
            status: val === "all" ? undefined : val,
          }),
        })
      }
    >
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

Zmiana filtra resetuje `page` do 1 — zapobiega pustym stronom.

### 3. Paginacja

```tsx
function Pagination({ total, limit, offset }: PaginationData) {
  const { page } = Route.useSearch()
  const navigate = useNavigate()
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const goTo = (p: number) =>
    navigate({
      search: (prev) => ({
        status: prev.status,
        page: p,
      }),
    })

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">
        Strona {page} z {totalPages}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => goTo(page - 1)}
        >
          Poprzednia
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => goTo(page + 1)}
        >
          Nastepna
        </Button>
      </div>
    </div>
  )
}
```

### 4. Layout strony (zmodyfikowany)

```tsx
function DeploymentListPage() {
  const { data, pagination } = Route.useLoaderData()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Wdrozenia</h1>
        <Button asChild>
          <Link to="/dashboard/new">Nowe wdrozenie</Link>
        </Button>
      </div>

      <StatusFilter />

      {data.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Brak wdrozen pasujacych do filtra.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4">
            {data.map((deployment) => (
              /* istniejace karty bez zmian */
            ))}
          </div>
          <Pagination
            total={pagination.total}
            limit={pagination.limit}
            offset={pagination.offset}
          />
        </>
      )}
    </div>
  )
}
```

## Zmiany plikow

| Plik | Zmiana |
|------|--------|
| `apps/user-application/src/routes/_auth/dashboard/index.tsx` | dodanie validateSearch, loaderDeps, StatusFilter, Pagination |

Jeden plik. Zadnych nowych plikow/komponentow — StatusFilter i Pagination to lokalne funkcje w tym samym module.

## Zachowanie krawedzi

- `page` > totalPages (np. po zmianie filtra) — loader zwroci pusta liste, uzytkownik klika "Poprzednia"
- Zmiana filtra zawsze resetuje page=1
- Nieprawidlowy `status` w URL — `.catch(undefined)` w Zod ignoruje go
- Nieprawidlowy `page` w URL — `.min(1).default(1)` normalizuje

## Otwarte pytania

Brak — zmiana jest self-contained i backend gotowy.
