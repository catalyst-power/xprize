# AgriFortress — a third-party app on Imajin

**Entrant:** Catalyst Agri-Innovations Society (CAIS) · **Platform:** Imajin (sovereign-tech kernel)
**Contest:** XPRIZE "Build with Gemini" · **Deadline:** Aug 17, 2026, 1:00 PM PT

AgriFortress — *farm to farm to table, supply-chain registry.* This repository **is the app** — a real, arms-length
third-party application that composes the Imajin platform **only through its public app surface**
(`requireAppAuth` + the documented kernel API). It runs on **external infrastructure** (Catalyst's own Google Cloud),
not inside the Imajin monorepo or server.

> **Why this matters:** every Imajin app to date is first-party (same repo, same server, privileged access). This
> is the **first true external integrator** — the honest test that an outside party can build on Imajin *without
> being inside it*. If this app can do everything it needs through app-auth and the public API alone, the
> federated-app boundary is real.

---

## The source of truth is the supplier's

AgriFortress holds nothing authoritative. The signed supply records — what was delivered, by whom, to whom, and the
settlement against it — are **the supplier's own signed records**, owned by the supplier, on their per-DID path.

| Tier | What | Owns the truth? |
|------|------|-----------------|
| **Supplier's records** | signed markdown records (the canonical document), on the supplier's per-DID path — hosted today, a user-held vault eventually | ✅ **source of truth** |
| **Imajin `supply` core** | a *projection* — index, query, reactor chains, settlement primitive | derived view |
| **Connectors** | services the supplier *selects* (QuickBooks, …) to feed/read signals into their own records | the supplier's chosen instruments |
| **This app** | thin render + gesture UX over the supplier's records | a lens |

The supplier can walk with their records and everything still verifies. The platform holds the data **for** them,
never **from** them.

---

## How it composes Imajin (the integration contract)

The app holds **no kernel internals, no DB access, no in-process bus.** It talks to Imajin as an external client:

- **Authenticates** as a registered app acting on behalf of a user — `X-App-DID` + `X-App-Authorization` (the
  user's consent attestation) → Imajin returns `{ appDid, userDid, scopes }`. The app acts *for the human*, never
  as itself; provenance pins to the user's DID.
- **Drives the supply chain** through the `supply` domain API (kernel-side, app-auth-gated). Each call publishes a
  `supply.*` event inside the kernel and runs its reactor chain (attestation → signed record on the supplier's path
  → notify). *The app never touches the bus directly.*
- **Settles** the one paid stage through the existing pay/settle endpoint with a `.fair` manifest.
- **Reads** lot provenance via the supply read API (chained by `correlationId`).

Platform-side work (the `supply.*` events, the domain API, the stage table, the connector framework) is tracked in
the Imajin monorepo: epic [`ima-jin/imajin-ai#1133`](https://github.com/ima-jin/imajin-ai/issues/1133) →
[#1134](https://github.com/ima-jin/imajin-ai/issues/1134) (events),
[#1136](https://github.com/ima-jin/imajin-ai/issues/1136) (lots),
[#1135](https://github.com/ima-jin/imajin-ai/issues/1135) (the external-app API surface),
[#1210](https://github.com/ima-jin/imajin-ai/issues/1210) (the accounting-connector framework + QuickBooks).

---

## The MVP — eggs, Misty Meadows → Grace Harbour

A real, already-operating loop, instrumented (not invented):

1. **Misty Meadows** delivers eggs to **Grace Harbour Farms**, periodically. This already happens.
2. The supplier fires a **QuickBooks invoice** to the buyer — their current step, unchanged.
3. The supplier opens **AgriFortress** → **one confirm** → a signed **delivery receipt** (a goods-receipt on the
   buyer's side). The provable record accrues on the side.
4. AgriFortress reads the QuickBooks invoice through the **connector** as the **settlement signal** — the real
   arms-length transaction — and settles it via `.fair`.

> **The governing constraint:** AgriFortress can never make the drop-off slower than it is today. The receipt
> generates from the gesture, not a form. The accounting system the supplier already uses stays exactly as it is —
> we make the record provable, we don't replace their books.

> **Claim boundary:** signed attestations prove claims *consistent and attributed*, not *true about the physical
> world*. All app copy and reporting reflect this.

---

## What the judges score

- A **deployed app** real participants use (AI-native operations — equally weighted).
- A **3-minute demo video** showing a real loop end to end.
- **Real arms-length revenue**, May–Aug, with a monthly breakdown.
- An **AI-workflow-transformation** writeup.

---

## Repository layout

| Path | Contents |
|------|----------|
| `/` (app) | The AgriFortress app — deployed to Catalyst's Google Cloud |
| `docs/` | Architecture notes (incl. supply-chain-as-config), integration contract, runbook |
| `deliverables/` | Demo video, submission writeups, revenue evidence |

This repo owns the **app + contest artifacts**. The **kernel/platform** (identity, attestation, `.fair`, the
`supply` domain, the connector framework) stays in `ima-jin/imajin-ai` — matching the IP split in the services
agreement: platform IP is Imajin's, the CAIS app and its data are CAIS's. The supplier's signed records are the
supplier's.

Issues for the app build are tracked here (see the **AgriFortress app build** epic, `#1`).

---

## Development

### Prerequisites

- Node.js 22+
- npm
- A registered AgriFortress `appDid` + user consent `attestationId` (needed for kernel calls — see [Configuration](#configuration))

### Getting started

```bash
git clone https://github.com/catalyst-power/xprize
cd xprize
npm install
cp .env.example .env.local   # then fill in your values
npm run dev                  # http://localhost:3000
```

### Configuration

Copy `.env.example` to `.env.local` and populate the following:

| Variable | Required | Description |
|---|---|---|
| `KERNEL_URL` | No | Imajin kernel base URL. Defaults to `https://imajin.ai`. |
| `APP_DID` | Yes (kernel calls) | The app's registered DID (`did:imajin:…`). Obtained after app registration. |
| `APP_PRIVATE_KEY` | Yes (kernel calls) | Ed25519 seed as hex (32 bytes = 64 hex chars). Generated at registration. **Never commit.** |
| `APP_ATTESTATION_ID` | Yes (kernel calls) | The user's consent attestation ID, linking this app to a specific user's `supply:read/write` grant. |
| `APP_ORG_ATTESTATION_ID` | No | AgriFortress's own org-level consent attestation ID. Used only to check org-subsidized connector status (e.g. Gemini) on the Connected Services panel. Without it, that panel shows "status unavailable" for org-level connectors. |

`APP_DID`, `APP_PRIVATE_KEY`, and `APP_ATTESTATION_ID` are obtained through the app registration and consent flow (issue [#3](https://github.com/catalyst-power/xprize/issues/3) in the epic). The app runs and serves the health route without them — only kernel-authenticated routes require them.

### API

#### `GET /api/health`

Liveness check. No credentials required.

```json
{"status":"ok","version":"0.1.0","timestamp":"2026-07-21T00:48:33.763Z"}
```

#### `GET /api/health/kernel`

Smoke call — completes the full app-auth handshake against the Imajin kernel and returns the resolved `userDid`. Requires `APP_DID`, `APP_PRIVATE_KEY`, and `APP_ATTESTATION_ID` to be set.

**When configured:**
```json
{"status":"ok","userDid":"did:imajin:…","scopes":["supply:read","supply:write"],"kernelUrl":"https://imajin.ai"}
```

**When credentials are missing (503):**
```json
{"status":"misconfigured","error":"APP_DID, APP_PRIVATE_KEY, and APP_ATTESTATION_ID env vars are required"}
```

**Auth flow (for reference):** the app signs a challenge with its Ed25519 private key → `POST /auth/api/apps/token` on the kernel → receives a short-lived bearer token (10 min, auto-refreshed at 80% TTL) → `userDid` is decoded from the JWT `sub` claim. See `src/lib/kernel/auth.ts`.

#### `GET /api/connectors/quickbooks/connect`

Target of the dashboard's "Connect QuickBooks" button (Connected Services panel, issue [#36](https://github.com/catalyst-power/xprize/issues/36)). Requires an active session; makes the app-auth'd `POST /quickbooks/api/connect` call to the kernel server-side and forwards the resulting OAuth redirect to Intuit. AgriFortress owns the Intuit app registration (sealed in its app DID's vault); it never receives a client secret or an OAuth token — the kernel seals the supplier's tokens at their own DID once they approve.

### Docker / Cloud Run

The image uses Next.js [standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) for a minimal runtime bundle.

```bash
docker build -t agrifortress .
docker run -p 8080:8080 \
  -e KERNEL_URL=https://imajin.ai \
  -e APP_DID=did:imajin:... \
  -e APP_PRIVATE_KEY=... \
  -e APP_ATTESTATION_ID=... \
  agrifortress
```

Cloud Run deployment target: Catalyst's GCP project (see `docs/` for runbook).

---

## Open inputs from CAIS (gate the demo/revenue, not the build)

Pre-commit early — participants move slowly.

- [ ] **Supplier's recording method** — how the delivery is recorded today (phone / text / paper / QuickBooks)
- [ ] **QuickBooks Online** confirmed for the supplier (the connector assumes Online; desktop is an edge case)
- [ ] **One real `.fair`-routed transaction** confirmed possible in-window
- [ ] **Google Cloud project + billing** — Catalyst-owned (the app deploys here)
- [ ] **App registration** — register this app with Imajin to obtain its `appDid` + scopes (`supply:write/read`)

---

*Entrant: Catalyst Agri-Innovations Society · Platform: Imajin · Build with Gemini XPRIZE 2026*
