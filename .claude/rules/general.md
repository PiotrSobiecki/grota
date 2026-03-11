# Universal Rules

## TypeScript

- Never use `any` — create explicit interfaces
- Prefer discriminated unions over boolean flags
- Guard `array[i]` access — returns `T | undefined`
- Named exports, no defaults
- Files: `kebab-case.ts`
- Custom error classes extending `Error` (never raw `throw new Error(string)`)

```ts
// discriminated union
type Result<T> = { ok: true; data: T } | { ok: false; error: Error }
```

```ts
// array access guard
for (let i = 0; i < items.length; i++) {
  const item = items[i]
  if (!item) continue
  doSomething(item.name)
}
```

## Cloudflare

- Use `wrangler.jsonc` not `.toml`

## Bugs

- Don't fix first. Write a test that reproduces the bug.
