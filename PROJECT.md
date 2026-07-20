# AgriFortress — Project Document

## What this is

AgriFortress is a third-party external client app on the Imajin sovereign-tech
kernel. It instruments a real farm-to-farm supply chain: **Misty Meadows**
delivers eggs to **Grace Harbour Farms**, and AgriFortress makes the drop-off
provable with a signed delivery receipt.

This app is the **first true external integrator** on Imajin — it holds no
kernel internals, no in-process bus access, and no direct DB to kernel tables.
It composes Imajin solely through the public app-auth surface and documented
kernel APIs.

## Architecture principles

1. **External client only** — The app talks to Imajin via HTTP against the
   public kernel API. No workspace:* deps, no monorepo imports.
2. **App acts on-behalf-of** — Every call is authenticated as a registered app
   acting for a user. Provenance pins to the user's DID, never the app's.
3. **Source of truth is the supplier's** — Signed markdown records on the
   supplier's per-DID path are canonical. The Imajin `supply` core is a
   *projection* (index, query, reactor chain). This app is a thin lens.
4. **No regression** — The drop-off must never be slower than today. One
   confirm → signed receipt. The supplier's existing QuickBooks workflow stays
   untouched.

## App-auth handshake

Incoming requests carry:

- `X-App-DID` — the app's DID (received at registration)
- `X-App-Authorization` — the user's consent attestation ID
- OR `Authorization: Bearer <app-token>` — short-lived scoped token (preferred)

The app verifies these by calling the kernel's stateless verify endpoint:

```
POST ${AUTH_SERVICE_URL}/api/apps/token/verify
Body: { token, scope? }
```

Returns `{ appDid, userDid, scopes, attestationId }`. The app then uses
`userDid` as the acting identity for all downstream calls.

## Build order

| Issue | What | Status |
|-------|------|--------|
| #2 | App scaffold + app-auth client | **this commit** |
| #3 | App registration + consent flow | next — obtain appDid + scopes |
| #4 | Supply write API integration | create delivery receipts via kernel |
| #5 | Supply read API + lot provenance | query chained records |
| #6 | QuickBooks connector integration | read invoice as settlement signal |
| #7 | .fair settlement routing | one paid stage end-to-end |

## Environment

- **Runtime:** Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Port:** 3402 (dev) / 7402 (prod) — follows Imajin client-app convention
- **Deploy target:** Catalyst's Google Cloud (external to Imajin infra)
- **Auth target:** Imajin kernel public API (dev-jin.imajin.ai / jin.imajin.ai)

## Key files

| Path | Purpose |
|------|---------|
| `src/lib/app-auth.ts` | Self-contained app-auth client (no monorepo deps) |
| `app/api/health/route.ts` | Liveness probe |
| `app/api/whoami/route.ts` | Demo: resolves userDid via app-auth |
| `app/page.tsx` | Landing page |
| `.env.example` | Required env vars |
