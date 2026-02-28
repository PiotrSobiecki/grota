# 004: Google OAuth & Token Encryption

## Goal

Implement the Google OAuth consent flow for client admins (Workspace scopes) and employees (Drive scope), with AES-256-GCM encryption for storing OAuth tokens at rest in the database.

## Prerequisites

- Doc 001 (Bootstrap & Cleanup)
- Doc 002 (Operator Deployment CRUD)
- Doc 003 (Client Onboarding Wizard)

## Scope

### IN

- Encryption utilities using Web Crypto API `crypto.subtle` AES-256-GCM (resolves **B4**)
- Google OAuth callback endpoint in data-service (resolves **B3**)
- Token exchange: authorization code to access + refresh token via raw `fetch`
- Encrypt tokens before storage, decrypt on read
- Add `workspace_oauth_token` (encrypted) to deployments table
- Add `drive_oauth_token` (encrypted) to employees table -- column already exists from doc 003 but unused
- Client admin wizard step 2: trust panel + Google OAuth consent button
- Employee flow step 1: trust panel + Google Drive OAuth consent button
- OAuth state parameter encoding: `{type: "admin"|"employee", id: uuid}`
- Note in wizard: consent must be granted by Workspace admin (resolves **C1**)

### OUT

- Google Drive API folder listing (doc 005)
- Folder selection UI (doc 005)
- Config export with token decryption (doc 006)

## Decisions

| Blocker | Decision |
|---------|----------|
| **B3** (Google OAuth for CF Workers) | Raw `fetch` to `https://oauth2.googleapis.com/token` for token exchange. No `googleapis` npm package (incompatible with Workers runtime). Callback URL: `{APP_BASE_URL}/api/oauth/google/callback`. |
| **B4** (encryption library) | **Web Crypto API** (`crypto.subtle`) with AES-256-GCM. Zero dependencies, built into Cloudflare Workers. Key derived from `ENCRYPTION_KEY` env var (base64-encoded 32 bytes). |
| **C1** (OAuth scope note) | Wizard step 2 includes a trust panel with explicit note: "Uwaga: Osoba autoryzujaca musi byc administratorem Google Workspace." |

## Data Model Changes

No new tables. Existing columns are used:

- `deployments.workspace_oauth_token` -- already defined in doc 002 as `text` (nullable). Stores encrypted JSON: `{ access_token, refresh_token, scope, token_type, expiry_date }`.
- `employees.drive_oauth_token` -- already defined in doc 003 as `text` (nullable). Stores encrypted JSON: `{ access_token, refresh_token, scope, token_type, expiry_date }`.

The encrypted value format is: `{iv_hex}:{ciphertext_hex}:{tag_hex}` (all hex-encoded, colon-separated).

### New file: `packages/data-ops/src/encryption/index.ts`

```ts
/**
 * AES-256-GCM encryption using Web Crypto API.
 * Zero dependencies -- built into Cloudflare Workers runtime.
 *
 * Key format: base64-encoded 32 bytes (256 bits).
 * Ciphertext format: {iv_hex}:{ciphertext_hex} (IV is 12 bytes).
 */

/** Import a base64-encoded AES-256 key for use with crypto.subtle. */
async function importKey(base64Key: string): Promise<CryptoKey> {
  const keyBytes = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  if (keyBytes.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be exactly 32 bytes (256 bits)");
  }
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Convert Uint8Array to hex string. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convert hex string to Uint8Array. */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Encrypt plaintext string with AES-256-GCM.
 * Returns format: {iv_hex}:{ciphertext_with_tag_hex}
 */
export async function encrypt(
  plaintext: string,
  base64Key: string,
): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );

  const cipherBytes = new Uint8Array(cipherBuffer);
  return `${toHex(iv)}:${toHex(cipherBytes)}`;
}

/**
 * Decrypt ciphertext string with AES-256-GCM.
 * Input format: {iv_hex}:{ciphertext_with_tag_hex}
 */
export async function decrypt(
  ciphertext: string,
  base64Key: string,
): Promise<string> {
  const parts = ciphertext.split(":");
  if (parts.length !== 2) {
    throw new Error("Invalid ciphertext format");
  }

  const ivPart = parts[0];
  const dataPart = parts[1];

  if (!ivPart || !dataPart) {
    throw new Error("Invalid ciphertext format: missing parts");
  }

  const key = await importKey(base64Key);
  const iv = fromHex(ivPart);
  const data = fromHex(dataPart);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );

  return new TextDecoder().decode(plainBuffer);
}

/**
 * Generate a new AES-256 key as base64 string.
 * Use this to create the ENCRYPTION_KEY env var value.
 */
export function generateEncryptionKey(): string {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...keyBytes));
}
```

### Update `packages/data-ops/package.json` exports

```jsonc
{
  "exports": {
    "./encryption": { "types": "./dist/encryption/index.d.ts", "default": "./dist/encryption/index.js" },
    // ... existing exports
  }
}
```

### New file: `packages/data-ops/src/deployment/token-queries.ts`

Queries for encrypted token storage/retrieval on deployments:

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import { deployments } from "./table";

export async function setWorkspaceOAuthToken(
  deploymentId: string,
  encryptedToken: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(deployments)
    .set({ workspaceOauthToken: encryptedToken })
    .where(eq(deployments.id, deploymentId));
}

export async function getWorkspaceOAuthToken(
  deploymentId: string,
): Promise<string | null> {
  const db = getDb();
  const result = await db
    .select({ workspaceOauthToken: deployments.workspaceOauthToken })
    .from(deployments)
    .where(eq(deployments.id, deploymentId));
  return result[0]?.workspaceOauthToken ?? null;
}
```

### New file: `packages/data-ops/src/employee/token-queries.ts`

Queries for encrypted token storage/retrieval on employees:

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import { employees } from "./table";

export async function setDriveOAuthToken(
  employeeId: string,
  encryptedToken: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(employees)
    .set({
      driveOauthToken: encryptedToken,
      oauthStatus: "authorized",
    })
    .where(eq(employees.id, employeeId));
}

export async function getDriveOAuthToken(
  employeeId: string,
): Promise<string | null> {
  const db = getDb();
  const result = await db
    .select({ driveOauthToken: employees.driveOauthToken })
    .from(employees)
    .where(eq(employees.id, employeeId));
  return result[0]?.driveOauthToken ?? null;
}
```

Update barrel exports for both `deployment/index.ts` and `employee/index.ts` to include the new token query functions.

## API Endpoints

### Google OAuth Flow

```
Client/Employee Browser
  │
  ├── 1. Click "Autoryzuj Google" button
  │     → Redirects to Google OAuth consent URL
  │
  ├── 2. User grants consent on Google
  │     → Google redirects to callback URL with `code` + `state`
  │
  ├── 3. GET /api/oauth/google/callback?code=xxx&state=yyy
  │     → data-service exchanges code for tokens
  │     → Encrypts tokens
  │     → Stores in DB
  │     → Redirects back to wizard/employee page
  │
  └── 4. Wizard/employee page reads updated OAuth status
```

### OAuth state parameter

The `state` parameter encodes the entity type and ID:

```ts
// Encode
const state = btoa(JSON.stringify({ type: "admin", id: deploymentId }));
// or
const state = btoa(JSON.stringify({ type: "employee", id: employeeId }));

// Decode (in callback)
const { type, id } = JSON.parse(atob(state));
```

### Google OAuth URL construction

```ts
function buildGoogleOAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set("access_type", "offline"); // get refresh_token
  url.searchParams.set("prompt", "consent"); // force consent to get refresh_token
  return url.toString();
}
```

### Scopes

| Entity | Scopes | Reason |
|--------|--------|--------|
| Client admin (Workspace) | `https://www.googleapis.com/auth/admin.directory.group` `https://www.googleapis.com/auth/drive` | Manage Google Groups + access Shared Drives |
| Employee (Drive) | `https://www.googleapis.com/auth/drive.readonly` | List folders, read metadata only |

### New file: `apps/data-service/src/hono/handlers/oauth-handlers.ts`

```ts
import { z } from "zod";
import { Hono } from "hono";
import * as oauthService from "../services/oauth-service";

const oauthHandlers = new Hono<{ Bindings: Env }>();

// Initiate OAuth flow (returns redirect URL)
oauthHandlers.get("/google/authorize", async (c) => {
  const type = c.req.query("type"); // "admin" | "employee"
  const id = c.req.query("id"); // deploymentId or employeeId

  if (!type || !id) {
    return c.json({ error: "Missing type or id parameter" }, 400);
  }

  const redirectUri = `${c.req.url.split("/api")[0]}/api/oauth/google/callback`;
  const url = oauthService.buildAuthorizationUrl(type, id, c.env, redirectUri);
  return c.redirect(url);
});

// OAuth callback (Google redirects here after consent)
oauthHandlers.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    // User denied consent
    return c.redirect(`/?oauth_error=${error}`);
  }

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  const redirectUri = `${c.req.url.split("?")[0]}`; // Same callback URL
  const result = await oauthService.handleCallback(code, state, c.env, redirectUri);

  if (!result.ok) {
    return c.redirect(`/?oauth_error=${result.error.code}`);
  }

  // Redirect back to the appropriate wizard/employee page
  return c.redirect(result.data.redirectTo);
});

export default oauthHandlers;
```

### New file: `apps/data-service/src/hono/services/oauth-service.ts`

```ts
import { encrypt } from "@repo/data-ops/encryption";
import { setWorkspaceOAuthToken } from "@repo/data-ops/deployment";
import { setDriveOAuthToken, updateEmployeeOAuthStatus } from "@repo/data-ops/employee";
import type { Result } from "../types/result";

// Re-export token query functions from data-ops
// Import them where needed in this service

const ADMIN_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/drive",
].join(" ");

const EMPLOYEE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

interface OAuthState {
  type: "admin" | "employee";
  id: string;
}

export function buildAuthorizationUrl(
  type: string,
  id: string,
  env: Env,
  redirectUri: string,
): string {
  const state = btoa(JSON.stringify({ type, id }));
  const scope = type === "admin" ? ADMIN_SCOPES : EMPLOYEE_SCOPES;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export async function handleCallback(
  code: string,
  stateParam: string,
  env: Env,
  redirectUri: string,
): Promise<Result<{ redirectTo: string }>> {
  // 1. Decode state
  let state: OAuthState;
  try {
    state = JSON.parse(atob(stateParam)) as OAuthState;
  } catch {
    return {
      ok: false,
      error: { code: "INVALID_STATE", message: "Invalid OAuth state", status: 400 },
    };
  }

  // 2. Exchange authorization code for tokens
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    console.error("Token exchange failed:", errorBody);
    return {
      ok: false,
      error: {
        code: "TOKEN_EXCHANGE_FAILED",
        message: "Nie udalo sie uzyskac tokenu Google",
        status: 502,
      },
    };
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    scope: string;
    token_type: string;
    expires_in: number;
  };

  // 3. Encrypt token payload
  const tokenPayload = JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    scope: tokens.scope,
    token_type: tokens.token_type,
    expiry_date: Date.now() + tokens.expires_in * 1000,
  });

  const encryptedToken = await encrypt(tokenPayload, env.ENCRYPTION_KEY);

  // 4. Store encrypted token
  if (state.type === "admin") {
    await setWorkspaceOAuthToken(state.id, encryptedToken);
    return {
      ok: true,
      data: { redirectTo: `/onboard/${state.id}?oauth=success` },
    };
  }

  // Employee
  await setDriveOAuthToken(state.id, encryptedToken);
  return {
    ok: true,
    data: { redirectTo: `/employee/${state.id}?oauth=success` },
  };
}
```

### Update `apps/data-service/src/hono/app.ts`

```ts
import oauthHandlers from "./handlers/oauth-handlers";

// Add to route registration:
App.route("/api/oauth", oauthHandlers);
```

### Endpoint summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/oauth/google/authorize?type=admin&id={id}` | Public | Redirect to Google consent |
| `GET` | `/api/oauth/google/callback?code=xxx&state=yyy` | Public | Handle Google callback, store token |

### Note on GOOGLE_CLIENT_ID in user-application

The `GOOGLE_CLIENT_ID` is needed in the user-application frontend to construct the OAuth URL on the client side. Two approaches:

**Approach A (chosen):** Redirect through data-service (`/api/oauth/google/authorize`). The client-side button links to the data-service endpoint which constructs the URL server-side. No `GOOGLE_CLIENT_ID` exposure on client.

**Approach B:** Expose `GOOGLE_CLIENT_ID` as `VITE_GOOGLE_CLIENT_ID` and build the URL client-side. Less secure but faster (one fewer redirect).

We use Approach A -- the OAuth initiation goes through data-service via the service binding or direct URL.

## UI Pages & Components

### Update wizard step 2: `apps/user-application/src/routes/onboard/$token.tsx`

Replace the `OAuthPlaceholderStep` from doc 003 with a real OAuth consent step:

```tsx
function OAuthConsentStep({
  deploymentId,
  onNext,
}: { deploymentId: string; onNext: () => void }) {
  const [oauthCompleted, setOauthCompleted] = useState(false);

  // Check URL params for oauth=success (redirect back from Google)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth") === "success") {
      setOauthCompleted(true);
    }
  }, []);

  const handleAuthorize = () => {
    // Redirect to data-service OAuth initiation
    const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
    window.location.href = `${dataServiceUrl}/api/oauth/google/authorize?type=admin&id=${deploymentId}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Krok 2: Autoryzacja Google Workspace</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Trust panel (resolves C1) */}
        <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
          <p className="font-medium text-foreground">Co zobaczymy:</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            <li>Liste folderow i nazwy plikow</li>
            <li>Grupy Google w Workspace</li>
          </ul>
          <p className="font-medium text-foreground">Czego NIE zobaczymy:</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            <li>Tresci dokumentow</li>
            <li>Prywatnych wiadomosci</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Tokeny szyfrowane AES-256-GCM, usuwane na zadanie.
          </p>
        </div>

        <div className="rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-3">
          <p className="text-sm text-foreground">
            <strong>Uwaga:</strong> Osoba autoryzujaca musi byc administratorem
            Google Workspace. Jezeli nie jestes administratorem, popros
            odpowiednia osobe o przeprowadzenie tego kroku.
          </p>
        </div>

        {oauthCompleted ? (
          <div className="space-y-2">
            <p className="text-sm text-green-600 dark:text-green-400">
              Autoryzacja zakonczona pomyslnie.
            </p>
            <Button onClick={onNext}>Dalej</Button>
          </div>
        ) : (
          <Button onClick={handleAuthorize}>Autoryzuj Google Workspace</Button>
        )}
      </CardContent>
    </Card>
  );
}
```

### Employee OAuth step: `apps/user-application/src/routes/employee/$token.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/employee/$token")({
  component: EmployeeFlow,
});

function EmployeeFlow() {
  const { token } = Route.useParams();
  // Steps: 1 = OAuth authorization, 2 = Folder list (doc 005), 3 = Category tagging (doc 005), 4 = Confirm (doc 005)
  const [currentStep, setCurrentStep] = useState(1);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-foreground">
          Grota — Autoryzacja Drive
        </h1>

        <div className="flex gap-2">
          {[1, 2, 3, 4].map((step) => (
            <div
              key={step}
              className={`h-2 flex-1 rounded ${
                step <= currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {currentStep === 1 && (
          <DriveOAuthStep
            token={token}
            onNext={() => setCurrentStep(2)}
          />
        )}
        {currentStep >= 2 && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">
                Autoryzacja zakonczona. Wybor folderow zostanie udostepniony wkrotce.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function DriveOAuthStep({
  token,
  onNext,
}: { token: string; onNext: () => void }) {
  const [oauthCompleted, setOauthCompleted] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth") === "success") {
      setOauthCompleted(true);
    }
  }, []);

  const handleAuthorize = () => {
    // Need to resolve employeeId from token first via API
    // Then redirect to OAuth initiation
    const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
    // The token verification returns employeeId -- fetch it first
    window.location.href = `${dataServiceUrl}/api/oauth/google/authorize?type=employee&id=${token}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Krok 1: Autoryzacja Google Drive</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Trust panel */}
        <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
          <p className="font-medium text-foreground">Co zobaczy aplikacja:</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            <li>Nazwy folderow najwyzszego poziomu</li>
          </ul>
          <p className="font-medium text-foreground">Czego NIE zobaczy:</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            <li>Tresci plikow</li>
            <li>Plikow wewnatrz folderow</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Mozesz cofnac dostep w dowolnym momencie w ustawieniach Google
            (myaccount.google.com/permissions).
          </p>
        </div>

        {oauthCompleted ? (
          <div className="space-y-2">
            <p className="text-sm text-green-600 dark:text-green-400">
              Autoryzacja zakonczona pomyslnie.
            </p>
            <Button onClick={onNext}>Dalej</Button>
          </div>
        ) : (
          <Button onClick={handleAuthorize}>Autoryzuj Google Drive</Button>
        )}
      </CardContent>
    </Card>
  );
}
```

## Implementation Steps

1. **Create encryption module in data-ops**
   - Create `packages/data-ops/src/encryption/index.ts`
   - Add `"./encryption"` export to `package.json`

2. **Create token query files**
   - Create `packages/data-ops/src/deployment/token-queries.ts`
   - Create `packages/data-ops/src/employee/token-queries.ts`
   - Update barrel exports in both domains

3. **Build data-ops**
   - `pnpm --filter @repo/data-ops build`

4. **Create OAuth handlers in data-service**
   - Create `hono/handlers/oauth-handlers.ts`
   - Create `hono/services/oauth-service.ts`
   - Update `hono/app.ts` with `/api/oauth` route

5. **Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to env**
   - Set `GOOGLE_CLIENT_ID` in data-service `.dev.vars`
   - Set `GOOGLE_CLIENT_SECRET` in data-service `.dev.vars`
   - Set `ENCRYPTION_KEY` in data-service `.dev.vars`
   - Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - Regenerate worker-configuration.d.ts: `cd apps/data-service && pnpm cf-typegen`

6. **Update wizard step 2 in user-application**
   - Replace `OAuthPlaceholderStep` with `OAuthConsentStep` in `routes/onboard/$token.tsx`

7. **Create employee OAuth page**
   - Create `routes/employee/$token.tsx`

8. **Regenerate and verify**
   - `cd apps/user-application && npx @tanstack/router-cli generate`
   - `pnpm run lint:fix && pnpm run lint`

## Environment Variables

| Variable | Package | Purpose |
|----------|---------|---------|
| `GOOGLE_CLIENT_ID` | data-service | OAuth consent screen client ID |
| `GOOGLE_CLIENT_SECRET` | data-service | OAuth token exchange |
| `ENCRYPTION_KEY` | data-service | AES-256-GCM key (base64, 32 bytes) |

### GCP OAuth App Setup (prerequisite)

Before testing, create a GCP OAuth 2.0 Client ID:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) -> APIs & Services -> Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URI: `http://localhost:8788/api/oauth/google/callback` (dev)
4. Enable APIs: Google Drive API, Admin SDK API
5. Configure OAuth consent screen (External or Internal depending on Workspace setup)
6. Copy Client ID and Client Secret to `.dev.vars`

## Manual Test Script

1. Ensure GCP OAuth app is configured (see above)
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ENCRYPTION_KEY` in data-service `.dev.vars`
3. Run both dev servers
4. **Test admin OAuth:**
   - Create a deployment with admin email
   - Generate magic link, open `/onboard/{token}`
   - Proceed to step 2
   - Click "Autoryzuj Google Workspace"
   - Should redirect to Google consent screen
   - Grant access (must be Workspace admin)
   - Should redirect back with `?oauth=success`
   - Verify token is stored in DB: `SELECT workspace_oauth_token FROM deployments WHERE id = '{id}'`
   - Token should be encrypted (hex format with colon separators)
5. **Test employee OAuth:**
   - From the onboarding wizard, create an employee
   - Open employee magic link: `/employee/{token}`
   - Click "Autoryzuj Google Drive"
   - Should redirect to Google consent screen (Drive readonly scope)
   - Grant access
   - Should redirect back with `?oauth=success`
   - Verify token in DB: `SELECT drive_oauth_token FROM employees WHERE id = '{id}'`
   - Token should be encrypted
6. **Test encryption roundtrip:**
   - In a test script or console, verify:
     ```ts
     const encrypted = await encrypt("hello", ENCRYPTION_KEY);
     const decrypted = await decrypt(encrypted, ENCRYPTION_KEY);
     // decrypted === "hello"
     ```
7. **Test error cases:**
   - Click "Autoryzuj" then deny consent on Google -> should redirect with error
   - Use expired/invalid state parameter -> should show error
