# Catalyst Virtual Co-Op — a third-party app on Imajin

**Entrant:** Catalyst Agri-Innovations Society (CAIS) · **Platform:** Imajin (sovereign-tech kernel)
**Contest:** XPRIZE "Build with Gemini" · **Deadline:** Aug 17, 2026, 1:00 PM PT · **App:** integrity.imajin.ai

This repository **is the app** — a real, arms-length third-party application that composes the Imajin platform
**only through its public app surface** (`requireAppAuth` + the documented kernel API). It runs on **external
infrastructure** (Catalyst's own Google Cloud), not inside the Imajin monorepo or server.

> **Why this matters:** every Imajin app to date is first-party (same repo, same server, privileged access). This
> is the **first true external integrator** — the honest test that an outside party can build on Imajin *without
> being inside it*. If this app can do everything it needs through app-auth and the public API alone, the
> federated-app boundary is real.

---

## How it composes Imajin (the integration contract)

The app holds **no kernel internals, no DB access, no in-process bus.** It talks to Imajin as an external client:

- **Authenticates** as a registered app acting on behalf of a user — `X-App-DID` + `X-App-Authorization` (the
  user's consent attestation) → Imajin returns `{ appDid, userDid, scopes }`. The app acts *for the human*, never
  as itself; provenance pins to the user's DID.
- **Drives the supply chain** through the `supply` domain API (kernel-side, app-auth-gated): `POST /api/supply/declared`,
  `/collected`, `/processed`, `/listed`. Each call publishes a `supply.*` bus event inside the kernel and runs its
  reactor chain (attestation → content-addressed record → notify). *The app never touches the bus directly.*
- **Settles** the one paid stage through the existing pay/settle endpoint with a `.fair` manifest.
- **Reads** lot provenance via the supply read API (chain by `correlationId`).

Platform-side work (the `supply.*` events, the domain API, the stage table) is tracked in the Imajin monorepo:
epic [`ima-jin/imajin-ai#1133`](https://github.com/ima-jin/imajin-ai/issues/1133) →
[#1134](https://github.com/ima-jin/imajin-ai/issues/1134) (events),
[#1135](https://github.com/ima-jin/imajin-ai/issues/1135) (the external-app API surface).

---

## The MVP — bread → feedstock

A real, already-operating loop, instrumented (not invented):

1. **Bakers declare** surplus bread available *(voice → Gemini)* — free diversion → signed supply attestation.
2. **Vyefield Farms collects** the bread (collector + processor).
3. **Vyefield processes** bread → animal feedstock.
4. **Vyefield sells** feedstock to consumers — the real arms-length transaction, settled via `.fair`.

**Two legs, one chain:** the bread side is verifiable provenance (proving feedstock came from real diverted
bread); the feedstock sale is the audited revenue. One signed event chain carries both.

> **Claim boundary:** signed attestations prove claims *consistent and attributed*, not *true about the physical
> world*. All app copy and reporting reflect this.

---

## What the judges score

- A **deployed app** real participants use (AI-native operations — equally weighted).
- A **3-minute demo video** showing a real loop end to end.
- **Real arms-length revenue**, May–Aug, with a monthly breakdown.
- An **AI-workflow-transformation** writeup.

---

## Repository layout (planned)

| Path | Contents |
|------|----------|
| `/` (app) | The Virtual Co-Op app — Next.js (or chosen stack), deployed to Catalyst's Google Cloud |
| `docs/` | Architecture notes (incl. supply-chain-as-config), integration contract, runbook |
| `deliverables/` | Demo video, submission writeups, revenue evidence |

This repo owns the **app + contest artifacts**. The **kernel/platform** (identity, attestation, `.fair`, bus,
the `supply` API) stays in `ima-jin/imajin-ai` — matching the IP split in the services agreement: platform IP is
Imajin's, the CAIS app and its data are CAIS's.

---

## Open inputs from CAIS (gate the demo/revenue, not the build)

Pre-commit early — participants move slowly.

- [ ] **Named bakers** — which baker(s) declare bread May–Aug
- [ ] **Named feedstock buyer(s)** — who pays Vyefield in-window (the revenue gate)
- [ ] **Today's recording method** — how bakers declare bread now (phone / text / paper)
- [ ] **One real `.fair`-routed transaction** confirmed possible in-window
- [ ] **Google Cloud project + billing** — Catalyst-owned (the app deploys here; affects Cloud Run vs Vertex)
- [ ] **App registration** — register this app with Imajin to obtain its `appDid` + scopes (`supply:write/read`)

---

*Entrant: Catalyst Agri-Innovations Society · Platform: Imajin · Build with Gemini XPRIZE 2026*
