# 008d — Folder Step UI + Mobile Sidebar

## Overview

Two UI gaps in user-application:

1. **FolderListStep (step 2)** — has loading/error states but returns `null` on success, causing instant auto-advance. User sees blank flash if fetch is fast, or no feedback on folder count.
2. **Mobile sidebar** — `_auth/route.tsx` manages `isMobileMenuOpen` state and Header has hamburger button, but Sidebar ignores the state entirely. Mobile users see nothing.

## Context

- Employee flow: `apps/user-application/src/routes/employee/$token.tsx`
- Layout: `apps/user-application/src/routes/_auth/route.tsx`
- Sidebar: `apps/user-application/src/components/layout/sidebar.tsx`
- Header: `apps/user-application/src/components/layout/header.tsx`
- Sheet component already exists: `apps/user-application/src/components/ui/sheet.tsx`

---

## 1. FolderListStep — Success State

### Current Behavior

```
Step 2 renders → useQuery fires → isPending shows spinner + "Pobieranie folderow..."
                                → isError shows error + retry button
                                → data arrives → useEffect calls onLoaded() → navigate to step 3
                                → return null (blank)
```

Loading and error states already exist and work correctly. The gap is the success→advance transition: `onLoaded` is called in a `useEffect` immediately on data arrival, then `return null` renders nothing.

### Proposed Change

Add a success state between fetch completion and step advance. Two options:

**Option A — Auto-advance with brief confirmation (recommended)**

After data loads, show "Znaleziono X folderow" for ~1.5s, then auto-advance.

```tsx
// Inside FolderListStep, after the existing isPending/isError blocks:

if (foldersQuery.data) {
  const count = foldersQuery.data.folders.length;
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400 mx-auto" />
        <p className="mt-4 text-foreground font-medium">
          Znaleziono {count} {count === 1 ? "folder" : "folderow"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Przechodzenie dalej...</p>
      </CardContent>
    </Card>
  );
}
```

Modify `useEffect` to delay the `onLoaded` call:

```tsx
useEffect(() => {
  if (foldersQuery.data) {
    const timer = setTimeout(() => {
      onLoaded(foldersQuery.data.folders);
    }, 1500);
    return () => clearTimeout(timer);
  }
}, [foldersQuery.data, onLoaded]);
```

**Option B — Manual "Dalej" button**

Show folder count + "Dalej" button. User clicks to proceed. More control but adds friction to a step that needs no user input.

### Recommendation

Option B. Manual "Dalej" gives user control and avoids timing assumptions.

### Edge Cases

- **0 folders returned**: show warning "Nie znaleziono folderow" + retry button instead of advancing
- **`onLoaded` reference stability**: wrap in `useCallback` in parent or use ref to prevent re-triggers (current code passes inline arrow — already recreated each render, so `useEffect` dep is unstable). Use a ref:

```tsx
const onLoadedRef = useRef(onLoaded);
onLoadedRef.current = onLoaded;

useEffect(() => {
  if (foldersQuery.data) {
    const timer = setTimeout(() => {
      onLoadedRef.current(foldersQuery.data.folders);
    }, 1500);
    return () => clearTimeout(timer);
  }
}, [foldersQuery.data]);
```

---

## 2. Mobile Sidebar

### Current State

| Component | Mobile behavior |
|-----------|----------------|
| `_auth/route.tsx` | Has `isMobileMenuOpen` state, passes toggle to Header |
| `header.tsx` | Hamburger button visible on `lg:hidden`, calls `onMobileMenuToggle` |
| `sidebar.tsx` | Desktop: `hidden lg:flex`. Mobile: empty `<div className="lg:hidden">` placeholder |

The wiring exists (state + trigger) but Sidebar never receives or uses `isMobileMenuOpen`.

### Implementation

**Props change** — add `open`/`onOpenChange` to Sidebar:

```tsx
interface SidebarProps {
  className?: string;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}
```

**Mobile section** — replace placeholder with Sheet (side="left"):

```tsx
{/* Mobile Sidebar */}
<Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
  <SheetContent side="left" className="w-64 p-0">
    <SheetHeader className="h-16 flex-row items-center justify-between px-6 border-b border-border">
      <SheetTitle className="text-xl font-semibold tracking-tight">Grota</SheetTitle>
    </SheetHeader>
    <ScrollArea className="flex-1 px-3 py-4">
      <nav className="space-y-2">
        {navigationItems.map((item) => {
          const isActive = /* same logic as desktop */;
          return (
            <Button
              key={item.name}
              variant={isActive ? "default" : "ghost"}
              className={cn(
                "w-full justify-start gap-3 h-10",
                isActive && "bg-primary text-primary-foreground shadow-sm",
                !isActive && "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
              onClick={() => {
                navigate({ to: item.href });
                onMobileOpenChange?.(false); // close on nav
              }}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{item.name}</span>
            </Button>
          );
        })}
      </nav>
    </ScrollArea>
  </SheetContent>
</Sheet>
```

**Extract shared nav** — desktop and mobile render same nav items. Extract a `NavItems` component or map function to avoid duplication.

**Route layout update** (`_auth/route.tsx`):

```tsx
<Sidebar
  className="flex-shrink-0"
  mobileOpen={isMobileMenuOpen}
  onMobileOpenChange={setIsMobileMenuOpen}
/>
```

### Close behavior

- Sheet's `onOpenChange` handles outside click + escape key automatically
- Explicit close on navigation via `onMobileOpenChange?.(false)` in click handler
- SheetContent's built-in X button also closes

### Accessibility

- Sheet is built on Radix Dialog — focus trap, aria attributes, escape key all handled
- Hamburger button in Header already renders; no additional trigger needed (Sheet is controlled via `open` prop, not `SheetTrigger`)

---

## Files to Modify

| File | Change |
|------|--------|
| `routes/employee/$token.tsx` | Add success state to FolderListStep, delay `onLoaded`, handle 0 folders |
| `components/layout/sidebar.tsx` | Add `mobileOpen`/`onMobileOpenChange` props, Sheet-based mobile nav |
| `routes/_auth/route.tsx` | Pass `mobileOpen`/`onMobileOpenChange` to Sidebar |

No new files needed. Sheet component already exists.

## Decisions

| Question | Decision |
|----------|----------|
| Step 2 advance | Manual "Dalej" button (Option B) — user explicitly proceeds |
| Mobile sidebar user info | Yes — show email + logout in SheetFooter |
| Extract navigationItems | No — premature, only 2 items now |
