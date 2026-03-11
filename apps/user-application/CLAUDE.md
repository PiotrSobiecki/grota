# user-application

TanStack Start frontend with SSR on Cloudflare Workers.

## Structure

```
src/
├── server.ts                 # Worker entry, DB + auth init
├── router.tsx                # TanStack Router config
├── routes/                   # File-based routing
│   ├── __root.tsx            # Root layout
│   ├── index.tsx             # Landing page
│   ├── faq/$categoryId.tsx   # Dynamic FAQ pages
│   ├── _auth/                # Protected routes (require auth)
│   └── api/                  # API handlers (Better Auth)
├── lib/
│   ├── utils.ts              # Shared utilities
│   ├── auth-client.ts        # Better Auth client
│   └── data-service.ts       # Service binding client (DATA_SERVICE)
└── components/               # React components
    ├── landing/              # Landing page sections
    ├── faq/                  # FAQ page component
    ├── navigation/           # Nav bar
    ├── theme/                # Theme toggle + provider
    ├── auth/                 # Auth components
    └── ui/                   # Radix/shadcn primitives
```

## Error Handling

See `error-handling.md` rule. Key files: `core/errors.ts` (AppError), `api-client.ts`.

## Don't

- Import `env` from 'cloudflare:workers' in client code (server only)
- Call data-service via public URL from server code — use `fetchDataService()` instead
- Put DB queries here - add to `@repo/data-ops/{domain}`
- Skip `enabled: !!id` on detail queries (prevents empty ID fetches)
- Use useState for URL-driven state - use `validateSearch` + `useNavigate`
