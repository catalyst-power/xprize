# AGENTS.md — AgriFortress, a third-party app on Imajin

This repo is a **standalone, arms-length application** that composes the Imajin platform through its
**public app surface only**. You (the coding agent) are working *on* the app, not *inside* Imajin. Read this whole
file before touching code — it defines the boundary you must not cross and the scope you must stay inside.

> Forked from [`ima-jin/imajin-app-template`](https://github.com/ima-jin/imajin-app-template). §1–§5 are the shared
> contract (keep intact); §6 is AgriFortress-specific.

---

## 1. What Imajin is (the supporting framework)

**Imajin (今人, "now-person") is the sovereign substrate this app runs on — not a library you import, a platform you
compose.** It provides five primitives, and this app rents them; it never owns them:

| Primitive | What it gives you |
|-----------|-------------------|
| **Identity** | sovereign DIDs — every actor (this app, every supplier) is a `did:imajin:…` |
| **Attestation** | signed, content-addressed records — the unit of proof (a delivery receipt is one) |
| **Communication** | messaging / events between identities |
| **Attribution (.fair)** | who-made-what, who-gets-paid — attribution + settlement manifests |
| **Settlement** | the paid leg — value moves against a signed record (the ONE arms-length sale) |

**Why it's built this way:** Imajin runs the *honesty inversion*. For the whole surveillance-tech era the money was in
the lie — information asymmetry, monetized opacity. Imajin inverts the incentive: **the signed record IS the value**, so
hiding stops paying and disclosure starts. When a rule here feels strict, it's protecting the provable record — that
record is the entire product.

**This app is a tenant, a lens, a render — never the authority.** The kernel + the supplier's own signed records hold
authority; AgriFortress proposes and displays. If you ever make this app the source of truth, you've misunderstood the
architecture — stop and re-read §3.

---

## 2. The boundary contract (do NOT cross this)

AgriFortress talks to Imajin as an **external client**. Hard rules, enforced in review:

- ✅ **Compose Imajin only via the public app surface:** app-auth headers + the documented kernel HTTP API.
  - `X-App-DID` — this app's DID (from registration)
  - `X-App-Authorization` — the attestation ID from the supplier's consent flow
  - The kernel verifies these and returns `{ appDid, userDid, scopes }`. That triple is your entire authority.
- ❌ **No `@imajin/*` package dependencies.** Not `@imajin/db`, not `@imajin/bus`, not `@imajin/auth`.
- ❌ **No direct database access.** No Postgres, no Drizzle, no migrations. The kernel owns data.
- ❌ **No in-process bus.** Emit `supply.*` events by calling the kernel's app-auth-gated `supply` domain API, never by
  importing a publisher.
- ❌ **No kernel internals, secrets, or private keys beyond AgriFortress's own registration credentials.**

**Reference implementation: `ima-jin/imajin-scorecard`** — the clean 2nd-party pattern (Next.js, `jose` HS256 session
cookie, `/api/auth/callback` handling the kernel redirect, zero `@imajin/*` deps). Match its shape. Do **not** copy
in-monorepo apps (coffee/dykil/learn) — those are first-party and privileged; imitating them breaks the boundary.

**The honest test AgriFortress exists to pass:** an outside party (Catalyst) can build everything it needs through
app-auth + the public API *without being inside Imajin*. This is the **first true external integrator**. Every shortcut
through the boundary invalidates that test.

---

## 3. Source of truth is the SUPPLIER's, not the kernel's ⚠️

**This is the most common mistake — bake it in.** The kernel is authoritative *as an index/projection*, **not as the
owner of truth.**

| Tier | What | Owns the truth? |
|------|------|-----------------|
| **Supplier's signed records** | signed markdown records on the supplier's per-DID path (hosted today on our infra, user-held vault eventually) | ✅ **source of truth** |
| **Imajin `supply` core** | a *projection* — index, query, reactor chains, settlement primitive | derived view |
| **Connectors** | services the supplier *selects* (QuickBooks, …) feeding their own records | supplier's instruments |
| **AgriFortress** | thin render + gesture UX over the supplier's records | a lens |

The supplier can walk away with their signed records and everything still verifies. The platform holds data **for** the
supplier, never **from** them. **Moat = legitimacy, not lock-in.**

> When you write UI copy, comments, or issues: never say "the kernel is the source of truth." Say "the kernel is the
> authoritative *index/projection* of the supplier's own signed records." Reading the kernel replaces a stale local
> cache because it's the authoritative projection — **not** because the kernel owns the truth.
>
> **We have NOT flipped this particular architecture yet** — Phase 1 hosts supplier records on our ProLiant infra, so
> in practice the kernel read *is* the pre-fill source today. Word things so they're true now **and** point at the
> user-held-vault end-state. Do not assert kernel-as-owner as a principle.

---

## 4. Epistemics & the claim boundary (binding on all copy + logic)

- **Evidence ≠ measurement.** Scott's voice/text where he *asserts and signs* ("six dozen to Dave") = the record. A
  **photo of eggs is evidence, not measurement — never count eggs from the image.** A confidently-wrong count poisons
  the provable record. An attestation proves "Scott said it and signed it," not "a camera verified it."
- **Inference is a prior, the human is the authority.** Gemini-inferred fields (from the photo, from last delivery)
  pre-fill an **editable** confirm card. Scott's one-tap confirmation is the signing event.
- **Claim boundary (binding on ALL copy):** signed attestations prove a claim is *consistent + attributed*, **not *true
  about the physical world*.** Carbon-credit / provenance fraud is physical-world fraud — never overclaim "verified
  truth." Two tiers if you surface trust: *cryptographically verified* (signature/chain) vs *AI-reviewed / advisory*.
- **Friction gate (#1 governing constraint):** AgriFortress must **never make Scott's drop-off slower than today**.
  Today = hand over eggs, fire a QuickBooks invoice, done. Hard acceptance criterion: **time-to-receipt ≤
  time-to-current-process.** The receipt generates from the *gesture* (photo → infer → one confirm), not a form.

---

## 5. Engineering discipline (carried from imajin-ai)

**SonarCloud-clean — zero new issues per PR.** Enforced:
- No negated conditions with `else`; no nested ternaries; no array index keys in React; no `forEach` (use `for...of`);
  no dead stores; positive conditions first; `replaceAll()` not `.replace(/g)`; `node:` protocol for built-ins;
  `globalThis` not bare `window`/`self`; React props typed `Readonly<>`; no redundant type constituents.

**Other:**
- **Stop means stop.** When Ryan says stop, STOP immediately — no "just one more fix."
- **Search before writing.** Match existing patterns in this repo (and `imajin-scorecard`) before inventing.
- **Commit hygiene:** feature branch → PR. `Closes #N` to auto-close. `[skip ci]` only for iteration commits.
- **Sub-agent memory rule:** if you spawn a sub-agent, tell it to append a summary to `docs/worklog/YYYY-MM-DD.md`.
- **Env:** all URLs come from env vars (`.env.example` is the contract) — no hard-coded URLs. No secrets in the repo.

---

## 6. This App — AgriFortress

- **What it is:** *farm-to-farm-to-table supply-chain registry* — a thin render + gesture UX over the supplier's signed
  supply records. Composes the Imajin `supply` primitive; owns nothing authoritative.
- **App DID:** _<did:imajin:… — from app registration (xprize #3); fill when minted>_
- **Scopes:** `supply:read`, `supply:write`
- **Domain:** deployed at **`integrity.imajin.ai`** (our infra). AgriFortress branding + pointing Catalyst's domain at
  it = a later brand/DNS layer, not a rebuild.
- **The real-world loop it instruments (instrument, don't invent):**
  - **Scott (Misty Meadows)** drops eggs to **David / Grace Harbour Farms** — already happens.
  - Scott fires a **QuickBooks invoice** to David — his current, only step, UNCHANGED.
  - Scott opens AgriFortress → photo of eggs → Gemini infers {egg drop, business, date, qty, recipient} → one editable
    confirm card → **[confirm]** signs a `supply.received` delivery receipt (references lot CID, subject = David).
  - **QuickBooks connector** reads Scott's invoice = the settlement signal → threads to the lot `correlationId` → `.fair`
    on the ONE paid leg.
- **Domain events it emits (via kernel `supply` API):** `supply.declared` → `supply.received`.
- **Connectors it consumes:** QuickBooks (Scott self-authorizes QB Online against his OWN records; the app owns only the
  select+connect UI, never brokers/holds his QB tokens). Gemini (voice/photo → intent) runs on **Catalyst's GCP** for
  the contest's ≥1-Google-Cloud requirement.
- **Scope guardrails — do NOT build (provable, not comprehensive, is the moat):**
  - No warehouse/EDI 856/810/GS1 modeling, no lot split/merge, no per-unit traceability (demo granularity = the
    **delivery is the lot**).
  - Phase 1 is **read-mostly** for QuickBooks — read the invoice event, thread it, fire `.fair`. Do **not** write back
    to QB. QB-replacement / tax-time reporting = deferred Phase 2, gated on proving the chain first.
  - Do not mint a parallel account/identity — suppliers get a **real sovereign DID** via the kernel onboarding + trust
    invite (AgriFortress DID invites them in, Mooi community pattern). The app consumes primitives into its own context.
- **Contest:** XPRIZE "Build with Gemini" — deadline **Aug 17, 2026, 1:00 PM PT**. Entrant: Catalyst Agri-Innovations
  Society (CAIS). Imajin = tech vendor, retains platform IP.

---

## 5a. Staying in sync with the template

This app tracks `ima-jin/imajin-app-template` as an **upstream remote** (not a GitHub fork). The shared contract
(§1–§7 + config files) flows in from the template; **§6 is yours** and is never overwritten.

```bash
scripts/sync-from-template.sh --check   # see what upstream changes are pending
scripts/sync-from-template.sh           # merge template/main onto a sync branch → open a PR
```

The first run joins the two histories once (`--allow-unrelated-histories`); every run after is a normal merge. On the
rare conflict (almost always §6), **keep your §6** and take the template's §1–§7. See the script header for details.

---

## 7. Issue & contribution conventions

This app follows the portable Imajin conventions from **[`ima-jin/conventions`](https://github.com/ima-jin/conventions)**
— consumed, not forked.

**Labels** are executable state, seeded once (idempotent):
```bash
scripts/init-taxonomy.sh <owner/repo>    # universal label set
```

**Lifecycle rules (the portable subset — standalone-repo, NOT the monorepo fork model):**
- `Closes #N` / `Fixes #N` in a PR is the **only** thing that auto-closes an issue. A body mention or `Phase N — #N:`
  closes nothing.
- **Don't close-and-icebox real ideas** — a genuine idea not being worked now stays *open* (shelved), not closed.
- **Native sub-issues / blocked-by** over `- [ ]` body checklists (GraphQL: `addSubIssue` / `addBlockedBy`; the latter's
  arg is `blockingIssueId`).
- Use labels for **type/topic**, not status. (Status/priority live on a board where one exists.)

Full text: `ima-jin/conventions/ISSUE-CONVENTIONS.md`. This §7 is kept in sync via `scripts/sync-from-template.sh`.

---

