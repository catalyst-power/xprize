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

**Scopes used by AgriFortress:** `supply:read`, `supply:write`, `quickbooks:read`.

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

## Connector status (app-facing connector surface, #1540)

Apps never manage connector lifecycle (select / connect / OAuth / token custody) — that is
profile-tier. This is the app-facing seam that lets AgriFortress witness status without ever
touching a connection or token.

### GET `/connections/api/connectors/status` — live connector status

```
Headers: X-App-DID, X-App-Authorization
Scope: connectors:read-status
Response 200: [{ id: string, connected: boolean, scopes: string[] }, ...]
```

- Registry-generic — returns an entry for every connector in the kernel's registry (QuickBooks,
  Gemini, future Xero/Stripe/bank), not just the ones the app asks about.
- Resolved for whichever identity's consent attestation minted the app-auth token (the acting
  `userDid`). To check status for AgriFortress's own org-level connections (e.g. Gemini's
  org-subsidized key) rather than a specific supplier's, mint the token with the org's own
  attestation.
- **Never** returns credentials, config, or tokens — only the boolean + granted scopes.
- **Live per render, never cached app-side.** A stale "connected" would be the app fabricating a
  profile fact it doesn't own (AGENTS.md §4).
- Missing connector → deep-link the user to `{kernelUrl}/auth/connectors?connect=<id>&returnTo=<url>`
  (profile owns connect; the app only links out).

See `src/lib/kernel/connectors.ts` and `src/app/dashboard/ConnectedServicesPanel.tsx`.

## QuickBooks connector

The supplier connects their own QuickBooks account (self-service, not brokered by the app).

```
POST   /quickbooks/api/connect       — initiate OAuth flow
GET    /quickbooks/api/callback       — OAuth callback
POST   /quickbooks/api/configure      — configure connected account
POST   /quickbooks/api/reconcile      — settle paid invoices (on-demand, not automatic)
POST   /quickbooks/api/invoice        — create invoice on behalf of supplier
GET    /quickbooks/api/scope-manifest — scope toggle state
POST   /quickbooks/api/disconnect     — revoke connection
```

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
APP_ORG_ATTESTATION_ID=<org-consent-attestation-id>  # org-level connectors (Gemini), #1540
```

## What NOT to do

- No `@imajin/*` package imports — this is an external app
- No direct DB access — the kernel owns data
- No in-process bus — emit events via HTTP, not import
- No kernel internals or private keys beyond the app's own registration credentials
- Never make the app the source of truth — the kernel projection and the supplier's signed records are authoritative
