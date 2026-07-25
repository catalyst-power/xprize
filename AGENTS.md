<!--
  ┌─────────────────────────────────────────────────────────────────────┐
  │  FORK CHECKLIST — fill this in first, then delete this comment block  │
  │                                                                       │
  │  APP NAME:        <e.g. AgriFortress>                                 │
  │  APP DID:         <did:imajin:… — from app registration>             │
  │  SCOPES:          <e.g. supply:read, supply:write>                    │
  │  DOMAIN:          <e.g. integrity.imajin.ai>                          │
  │  KERNEL:          <prod: https://jin.imajin.ai | dev: https://dev-jin.imajin.ai> │
  │  REFERENCE APP:   ima-jin/imajin-scorecard                            │
  │                                                                       │
  │  Then: fill the "This App" section, keep everything else, delete me.  │
  └─────────────────────────────────────────────────────────────────────┘
-->

# AGENTS.md — Third-Party App on Imajin

This repo is a **standalone, arms-length application** that composes the Imajin platform through its
**public app surface only**. You (the coding agent) are working *on* the app, not *inside* Imajin. Read this whole
file before touching code — it defines the boundary you must not cross and the scope you must stay inside.

---

## 1. What Imajin is (the supporting framework)

**Imajin (今人, "now-person") is the sovereign substrate this app runs on — not a library you import, a platform you
compose.** It provides five primitives, and this app rents them; it never owns them:

| Primitive | What it gives you |
|-----------|-------------------|
| **Identity** | sovereign DIDs — every actor (this app, every user) is a `did:imajin:…` |
| **Attestation** | signed, content-addressed records — the unit of proof |
| **Communication** | messaging / events between identities |
| **Attribution (.fair)** | who-made-what, who-gets-paid — attribution + settlement manifests |
| **Settlement** | the paid leg — value moves against a signed record |

**Why it's built this way (so you get the *why*, not just the rules):** Imajin runs the *honesty inversion*. For the
whole surveillance-tech era the money was in the lie — information asymmetry, monetized opacity. Imajin inverts the
incentive: **the signed record IS the value**, so hiding stops paying and disclosure starts. Everything below follows
from that. When a rule here feels strict, it's protecting the provable record — that record is the entire product.

**This app is a tenant, a lens, a render — never the authority.** The kernel + the user's own signed records hold
authority; this app proposes and displays. If you ever find yourself making this app the source of truth, you've
misunderstood the architecture — stop and re-read §3.

---

## 2. The boundary contract (do NOT cross this)

This app talks to Imajin as an **external client**. Hard rules, enforced in review:

- ✅ **Compose Imajin only via the public app surface:** app-auth headers + the documented kernel HTTP API.
  - `X-App-DID` — this app's DID (from registration)
  - `X-App-Authorization` — the attestation ID from the user's consent flow
  - The kernel verifies these and returns `{ appDid, userDid, scopes }`. That triple is your entire authority.
- ❌ **No `@imajin/*` package dependencies.** Not `@imajin/db`, not `@imajin/bus`, not `@imajin/auth`. If you're
  reaching for one, you're building a first-party app — wrong repo.
- ❌ **No direct database access.** No Postgres connection, no Drizzle, no migrations. The kernel owns data.
- ❌ **No in-process bus.** The bus is kernel-internal. Emit `supply.*`/domain events by calling the kernel's
  app-auth-gated domain API, never by importing a publisher.
- ❌ **No kernel internals, secrets, or private keys beyond this app's own registration credentials.**

**Reference implementation: `ima-jin/imajin-scorecard`** — the clean 2nd-party pattern (Next.js, `jose` HS256 session
cookie, `/api/auth/callback` handling the kernel redirect, zero `@imajin/*` deps). Match its shape. Do **not** copy
in-monorepo apps (coffee/dykil/learn) — those are first-party and privileged; imitating them breaks the boundary.

**The honest test this app exists to pass:** an outside party can build everything it needs through app-auth + the
public API *without being inside Imajin*. Every shortcut through the boundary invalidates that test.

---

## 3. Source of truth is the USER's, not the kernel's ⚠️

**This is the most common mistake — bake it in.** The kernel is authoritative *as an index/projection*, **not as the
owner of truth.**

| Tier | What | Owns the truth? |
|------|------|-----------------|
| **User's signed records** | signed markdown/attestations on the user's per-DID path (hosted today, user-held vault eventually) | ✅ **source of truth** |
| **Kernel domain core** | a *projection* — index, query, reactor chains, settlement | derived view |
| **Connectors** | services the user *selects* (QuickBooks, …) feeding their own records | user's chosen instruments |
| **This app** | thin render + gesture UX over the user's records | a lens |

The user can walk away with their signed records and everything still verifies. The platform holds data **for** the
user, never **from** them. **Moat = legitimacy, not lock-in.**

> When you write UI copy, comments, or issues: never say "the kernel is the source of truth." Say "the kernel is the
> authoritative *index/projection* of the user's own signed records." Reading the kernel replaces a stale local cache
> because it's the authoritative projection — **not** because the kernel owns the truth.
>
> Note: an app may not have *flipped* to user-held vaults yet (Phase 1 often hosts records on our infra). Word things
> so they're true today **and** point at the user-held end-state — don't assert kernel-as-owner as a principle.

---

## 4. Epistemics & the claim boundary (binding on all copy + logic)

- **Evidence ≠ measurement.** Voice/text where a human *asserts and signs* a value = the record. A **photo is evidence,
  not measurement — never count/measure from an image.** A confidently-wrong count poisons the provable record. An
  attestation proves "X said it and signed it," not "a camera verified it."
- **Inference is a prior, the human is the authority.** Inferred fields (from a photo, from last time) pre-fill an
  **editable** confirm step. The human's confirmation is the signing event.
- **Claim boundary:** signed attestations prove a claim is *consistent + attributed*, **not *true about the physical
  world*.** Never overclaim "verified truth." Two tiers if you surface trust: *cryptographically verified* (signature/
  chain) vs *AI-reviewed / advisory*.
- **Friction gate (if this app instruments a real-world workflow):** the app must **never make the real task slower than
  it is today.** Time-to-signed-record ≤ time-to-current-process. Generate the record from the *gesture*, not a form.

---

## 5. Engineering discipline (carried from imajin-ai)

**SonarCloud-clean — zero new issues per PR.** These are enforced:
- No negated conditions with `else` (`if (x) {B} else {A}`, not `if (!x) {A} else {B}`)
- No nested ternaries — extract to variables or if/else
- No array index keys in React — stable IDs
- No `forEach` — use `for...of`
- No dead stores; positive conditions first in ternaries
- `replaceAll()` not `.replace(/g)`; `node:` protocol for built-ins
- `globalThis` not bare `window`/`self` (`globalThis.window`, `globalThis.document`, …)
- React component props typed `Readonly<>` in the signature
- No redundant type constituents (don't write `string | undefined` for a `?:` param)

**Other:**
- **Stop means stop.** When the human says stop, STOP immediately — no "just one more fix."
- **Search before writing.** Match existing patterns in this repo (and the reference app) before inventing.
- **Commit hygiene:** feature branch → PR. `Closes #N` to auto-close. `[skip ci]` only for iteration commits.
- **Sub-agent memory rule:** if you spawn a sub-agent, tell it to append a summary of what it built/changed to
  `docs/worklog/YYYY-MM-DD.md` (create if missing) — what was built, files changed, decisions, status.
- **Env:** all service URLs come from env vars (`.env.example` is the contract) — **no hard-coded URLs**.
- **No secrets in the repo.** App private key + session secret live in `.env`, never committed.

---

## 6. This App (fork fills this in)

> Replace this whole section in the fork. Keep §1–§5 intact.

- **What it is:** _<one-line purpose>_
- **App DID:** _<did:imajin:…>_
- **Scopes:** _<e.g. supply:read, supply:write>_
- **Domain:** _<e.g. app.imajin.ai>_
- **The real-world loop it instruments:** _<who → who, what changes hands, the one paid leg>_
- **Domain events it emits (via kernel API):** _<e.g. supply.declared → supply.received>_
- **Connectors it consumes:** _<e.g. QuickBooks (user self-authorizes)>_
- **Scope guardrails specific to this app:** _<the "do not build X" list — keep it provable, not comprehensive>_
