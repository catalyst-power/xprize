# Imajin Kernel API Context for AgriFortress (catalyst-power/xprize)

> **Include this in Warp dispatch prompts for `catalyst-power/xprize` work.**
> The agent cannot access the `ima-jin/imajin-ai` repo directly. This doc provides
> the kernel API shapes it needs to build against.

## How app-auth works

AgriFortress authenticates as an external app. Every request to the kernel carries two headers:

```
X-App-DID: did:imajin:<app-did>       # this app's registered DID
X-App-Authorization: <attestation-id>  # user's consent attestation
```

The kernel's `requireAppAuth(request, { scope })` validates these and returns:
```ts
{ appDid: string, userDid: string, scopes: string[] }
```

That triple is your entire authority. The app never holds user credentials directly.

**Scopes used by AgriFortress:** `supply:read`, `supply:write`, `quickbooks:read`, `connections:read`, `connections:write`.

## Auth callback flow (how users log in to the app)

Reference: `ima-jin/imajin-scorecard` (the canonical 2nd-party app pattern).

1. App redirects user to kernel's consent page: `{IMAJIN_AUTH_URL}/auth/consent?app_did={APP_DID}&redirect_uri={CALLBACK_URL}&scopes=supply:read,supply:write`
2. User approves → kernel redirects to callback with `?attestation_id=...&user_did=...`
3. Callback handler (`/api/auth/callback/route.ts`):
   - Receives `attestation_id` + `user_did` from query params
   - Fetches user profile: `GET {IMAJIN_AUTH_URL}/profile/api/profile/{userDid}` (no app-auth headers needed)
   - Creates a local session token (jose HS256 JWT) with `{ did, displayName, handle, avatar, attestationId }`
   - Sets an httpOnly session cookie and redirects to `/dashboard`

```ts
// Session token shape (local to the app, NOT a kernel token)
interface SessionUser {
  did: string;
  displayName: string;
  handle: string;
  avatar?: string;
  attestationId: string;
}
```

**Key deps:** `jose` for JWT signing/verification. No `@imajin/*` packages.

## Supply domain API

Base URL: `{KERNEL_URL}/supply/api`

All routes are app-auth-gated. `issuer`/`subject` = the human's DID (from `appAuth.userDid`), never the app DID.

### POST `/supply/api/declared` — declare a new lot

Starts a new supply chain lot. Mints a `lotId` (= `correlationId`) if omitted.

```
Headers: X-App-DID, X-App-Authorization
Scope: supply:write
Body: {
  commodity: string,      // e.g. "eggs"
  quantity: number,        // e.g. 6
  unit: string,           // e.g. "dozen"
  lotId?: string,         // omit to mint a new lot
  priorCid?: string       // content-addressed link to prior event
}
Response 201: { ok: true, correlationId: string, stage: "declared" }
```

### POST `/supply/api/collected`, `/processed`, `/listed`

Same shape as `declared`, but `lotId` is **required** (threads onto existing lot).

```
Body: { commodity, quantity, unit, lotId: string, priorCid? }
Response 201: { ok: true, correlationId: string, stage: "collected"|"processed"|"listed" }
```

### POST `/supply/api/received` — delivery receipt

The downstream recipient confirms receipt. `lotId` required.

```
Body: { commodity, quantity, unit, lotId: string, priorCid? }
Response 201: { ok: true, correlationId: string, stage: "received" }
```

Note: `declared`–`listed` set `supplierDid = userDid`. `received` sets `recipientDid = userDid`.

### GET `/supply/api/lots?supplier={did}&limit={n}`

Returns the supplier's most recent lots, newest-first. Default limit 5, max 50.

```
Scope: supply:read
Response: { lots: [...] }
```

### GET `/supply/api/lot/{correlationId}`

Returns a single lot + its ordered stage history.

```
Scope: supply:read
Response: { lot: {...}, stages: [...] }
```

## Trust-graph connections (delivery card Recipient selector, xprize#55)

### GET `/connections/api/connections` — the acting supplier's connections

```
Headers: X-App-DID, X-App-Authorization
Scope: connections:read
Response 200: { connections: [{ did, handle, name, nickname, connectedAt }, ...] }
```

- Returns the *other* DID in each active connection (the kernel maps `didA`/`didB` onto
  whichever side is not the caller), enriched with the kernel identity's `handle`/`name`
  and any `nickname` the caller has assigned. `handle`/`name`/`nickname` may be `null`.
- Used to populate the delivery card's Recipient field as a native `<select>` (a name
  can't be typed in and resolved to a DID after the fact — the field can only hold a DID
  that is actually one of the options), so the signed attestation's recipient/subject is
  always a real DID. Only the attestation subject can later countersign it via
  `POST /auth/api/attestations/countersign`.
- See `src/lib/kernel/identity.ts` and `src/app/dashboard/DeliveryGesture.tsx`.

### POST `/connections/api/invites` — create a connections-service invite (xprize#59, #77)

```
Headers: X-App-DID, X-App-Authorization
Scope: connections:write
Body: { delivery: "link" | "email", toEmail?: string, note?: string }
Response 201: { invite: { id, code, delivery, status }, url: string }
```

- **ima-jin/imajin-ai#1794** added an app-auth dual guard to this route (previously
  cookie-session-only, which 401'd on this app's server-side app-auth call — xprize#77).
  It now accepts `requireAppAuth(request, { scope: 'connections:write' })` first, falling
  back to the session cookie. No header-shape change was needed on the app side —
  `fetchKernel` already sent the same Bearer + `X-App-DID` shape every other app-auth
  route here uses.
- Called from `createConnectionInvite` (`src/lib/kernel/identity.ts`), best-effort, when
  the delivery confirm's chosen recipient has never been active on AgriFortress before.
  A failed invite must never look like a failed delivery (claim boundary, AGENTS.md §4) —
  it's logged server-side and surfaced as a small non-blocking UI note, never as the
  confirm outcome.

## Connector status (app-facing connector surface, #1540)

Apps witness connector status; they never handle credentials or tokens directly. This is the
app-facing seam that lets AgriFortress check whether a connector is connected without ever
touching a connection or token.

### GET `/connections/api/connectors/status` — live connector status

```
Headers: X-App-DID, X-App-Authorization
Scope: connectors:read-status
Response 200: [{ id: string, connected: boolean, scopes: string[] }, ...]
```

- Registry-generic — returns an entry for every connector in the kernel's registry (QuickBooks,
  Gemini, future Xero/Stripe/bank), not just the ones the app asks about.
- Resolved for whichever identity minted the app-auth token: a specific supplier's consent
  attestation for per-user connectors (QuickBooks), or the app's own self-authenticated identity
  (`APP_DID` + `APP_PRIVATE_KEY`, no attestation) for org-level connections AgriFortress checks
  about itself (e.g. Gemini's org-subsidized key) — there's no human to obtain consent from for
  that check, so no attestation concept applies.
- **Never** returns credentials, config, or tokens — only the boolean + granted scopes.
- **Live per render, never cached app-side.** A stale "connected" would be the app fabricating a
  fact it doesn't own (AGENTS.md §4).

See `src/lib/kernel/connectors.ts` and `src/app/dashboard/ConnectedServicesPanel.tsx`.

## QuickBooks connector

**Post ima-jin/imajin-ai#1705:** app-owned OAuth client credentials are split from per-user token
storage. AgriFortress seals its own Intuit app registration (clientId, clientSecret, redirectUri)
in its **own app DID's vault** — suppliers never enter their own connector credentials. Each
supplier's resulting OAuth tokens are sealed in **their own** DID's vault. The connect flow stays
in-app: AgriFortress initiates OAuth via the kernel using app-auth, `onBehalfOf` the acting user.

```
POST   /quickbooks/api/connect       — initiate OAuth flow (app-auth + onBehalfOf + returnTo)
GET    /quickbooks/api/callback       — OAuth callback (kernel-handled end to end)
POST   /quickbooks/api/reconcile      — settle paid invoices (on-demand, not automatic)
POST   /quickbooks/api/invoice        — create invoice on behalf of supplier
GET    /quickbooks/api/scope-manifest — scope toggle state
POST   /quickbooks/api/disconnect     — revoke connection
```

**Connect flow (`createConnectHandler` + `resolveConfigDidFromAppAuth`, both shipped in #1705):**
1. AgriFortress's own in-app route (`GET /api/connectors/quickbooks/connect`) calls the kernel's
   `POST /quickbooks/api/connect` server-side with app-auth headers (`X-App-DID`,
   `X-App-Authorization`) plus `onBehalfOf={userDid}` and `returnTo={dashboardUrl}`.
2. The kernel resolves AgriFortress's Intuit client credentials from the app DID's vault via
   `resolveConfigDidFromAppAuth` — the app never sends or sees a client secret.
3. The kernel signs OAuth state with both the app DID and the user DID, then redirects to Intuit.
4. Intuit redirects back to the kernel's callback; the kernel exchanges the code and seals the
   resulting tokens at the **user's** DID (never the app's).
5. The kernel redirects the browser to `returnTo` (the dashboard).

AgriFortress's only responsibilities: show live status (via the connector status endpoint above),
provide the "Connect QuickBooks" link to its own in-app route, and let the kernel do the rest.

**Invoice creation flow:** gesture → human confirm → `supply.received` → QB invoice written + `.fair` priced → when invoice is paid (Balance==0), `.fair` split executes automatically. The human confirm IS the signing gate.

**Settlement is on-demand:** `POST /quickbooks/api/reconcile` settles paid invoices. Nothing calls it on a timer — no cron, no webhook. It runs when the app triggers it.

## Intention inference engine

The app uses the kernel's intention inference engine for the gesture → intent → confirm flow:

```
POST /inference/api/capture     — submit a gesture (audio/photo) for intent inference
POST /inference/api/confirm     — human confirms/edits the inferred intent (= consent event)
```

The capture returns candidate intents; the confirm is the signing event that creates the `supply.*` attestation.

## Live kernel specs (OpenAPI 3.1)

For deeper reference, the kernel serves live OpenAPI specs:
- `https://jin.imajin.ai/auth/api/spec` — identity, auth, sessions, attestations
- `https://jin.imajin.ai/media/api/spec` — asset upload/delivery, .fair, classification
- `https://jin.imajin.ai/pay/api/spec` — balances, transactions, settlement, Stripe

No live spec exists for the supply domain yet (routes exist, spec not wired).

## Key env vars the app needs

```
IMAJIN_AUTH_URL=https://jin.imajin.ai/auth   # kernel auth service base
IMAJIN_APP_DID=did:imajin:<app-did>          # this app's registered DID
SESSION_SECRET=<random-secret>                # for local jose JWT signing
NEXT_PUBLIC_APP_URL=https://integrity.imajin.ai  # public URL of this app
```

## What NOT to do

- No `@imajin/*` package imports — this is an external app
- No direct DB access — the kernel owns data
- No in-process bus — emit events via HTTP, not import
- No kernel internals or private keys beyond the app's own registration credentials
- Never make the app the source of truth — the kernel projection and the supplier's signed records are authoritative
