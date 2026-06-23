# Supply Chain as Configuration — decomposing the MVP into a generic stack

**Status:** DESIGN NOTE — 2026-06-23. Ryan's framing: "it's all becoming configuration."
**Epic:** [ima-jin/imajin-ai#1133](https://github.com/ima-jin/imajin-ai/issues/1133) (MVP slice of #1059; siblings #1061 build, #781 config view).
**Thesis:** The bread→feedstock loop is NOT a special app. It's one *configuration* of a generic
supply-chain primitive already expressible in the kernel bus (`BusEvent` + `ChainConfig` + `ReactorConfig[]`).
**Maps to existing primitives** (`packages/bus/src/`): events, reactor chains, broker. Nothing here is net-new
*architecture* — it's net-new *config* (+ a thin app surface to author it).

---

## 0. The insight

A supply chain is just: **nodes that emit supply, links that move/transform it, and a settlement event at the
arms-length sale.** Every one of those is already a bus concept:

| Supply-chain concept | Kernel primitive | Already exists? |
|----------------------|------------------|-----------------|
| "X is available" | `BusEvent` (e.g. `supply.declared`) | ✅ bus |
| who attests it | `attestation` reactor | ✅ |
| is it paid or free? | presence/absence of `settle` reactor in the chain | ✅ |
| moves to next node | next `BusEvent` in the correlationId trail | ✅ |
| transformed into output | another event + attestation (provenance link) | ✅ |
| sold arms-length | `order.completed` / `listing.purchased` → `settle` | ✅ pattern exists |
| who gets paid what | `.fair` manifest on the settle reactor | ✅ |
| notify a party | `notify` reactor | ✅ |
| external system | `webhook` / `dfos` reactor | ✅ |

So "decompose the MVP into a configurable supply-chain stack" = **express the loop as a set of event types,
each with a reactor chain, threaded by `correlationId`.** The app's only job is to author those configs and
fire the events.

---

## 1. The generic model

A **supply chain** = an ordered set of **stages**. Each stage is one **event type** with a **reactor chain**.
Three knobs per stage make it configurable:

1. **INPUT** — what event declares this stage's supply? (`supply.declared`, `collected`, `processed`, `listed`, `ordered`)
2. **PAID?** — does money move at this stage? → include a `settle` reactor (+ `.fair`) or don't.
3. **OUTPUT CHANNEL + COST** — where does the result go, and what does that cost?
   (`notify` to a DID/scope, `webhook` to an external system, `emit` to DFOS, listing surface). Cost = a `.fair`
   line item or a fee in the settle config.

Everything else (provenance, who-attested, ordering) falls out of the correlationId trail + attestations.

```
ChainConfig {
  eventType: "supply.declared",
  scope: "integrity:bread",          // per-deployment scope = the "configuration" boundary
  reactors: [
    { type: "attestation", config: { attestationType: "supply.declared" } },  // provenance
    { type: "emit" },                                                          // content-addressed record
    { type: "notify", config: { scope: "collector" } }                        // OUTPUT CHANNEL
    // NO settle reactor  ← this is what "free input" means, declaratively
  ]
}
```

---

## 2. Bread→feedstock expressed as config (the MVP)

Five stages, threaded by one `correlationId` per bread lot:

| # | Event type | INPUT (who fires) | PAID? | Reactor chain |
|---|-----------|-------------------|-------|---------------|
| 1 | `supply.declared` | baker (voice→Gemini) | **free** | `attestation` (provenance) → `emit` (CID record) → `notify` (→ Vyefield/collector) |
| 2 | `supply.collected` | Vyefield | free | `attestation` (chain-of-custody link to #1's CID) → `emit` |
| 3 | `supply.processed` | Vyefield | free | `attestation` (input-CID → output feedstock-CID, the provenance link) → `emit` |
| 4 | `supply.listed` | Vyefield | n/a | `emit` → surface on aggregated listing (broker/discovery) |
| 5 | `order.completed` | buyer | **PAID** | `attestation` → `mjn` → `settle` (await) + **`.fair` manifest** → `notify` (receipt) |

- **Stages 1–4 have no `settle`** → that's literally how "bread is free" is encoded. Not a code branch — a config fact.
- **Stage 5 is the only settlement** → the single arms-length revenue event XPRIZE audits. `order.completed`'s
  chain (`settle`, await:true) *already exists* in `config.ts` — we reuse it verbatim.
- **Provenance** = each stage's attestation references the prior stage's CID (correlationId trail). The "proves
  feedstock came from real diverted bread" story is the attestation chain, no extra build.

---

## 3. Why this is the right abstraction (and what it buys CAIS)

- **Same config, different chain = different vertical.** Swap the scope + event labels and you have *any* supply
  chain: dairy→cheese, lumber→pellets, produce→co-op box. The Symbiosis Centre's "100 Agriclusters" vision is
  *N deployments of the same config*, not N apps. This is the "rolls up to the ultimate vision" Chris asked for (his point 9).
- **The knobs are the product.** "Put in your inputs, whether you pay for them, your output channels + costs" =
  literally authoring `ChainConfig` rows. A scope owner configures their chain; the kernel runs it.
- **Selective disclosure is free.** Public = signature/CID chain consistency; protected commercial fields gated by
  the broker reactor chain. Same primitive the calendar/broker work (#1097/#1103) uses.
- **It's a live demo of the product.** Every settled txn carries a `.fair` manifest — the commercial mechanism IS
  the demonstration. (Already stated in the services agreement §4.)

---

## 4. What exists vs. what's net-new (honest gate)

🟢 **Exists (reuse):**
- `BusEvent`, `ChainConfig`, `ReactorConfig` (`packages/bus/src/types.ts`)
- Reactors: `attestation`, `emit`, `notify`, `settle`, `mjn`, `webhook`, `dfos`
- The `order.completed` / `listing.purchased` settle+`.fair` pattern (`config.ts`)
- DB-backed chain config (#762) + seed chains (#763) — runtime-tweakable chains
- Broker / discovery primitives for the aggregated listing

🟡 **Exists but unwired for this:**
- New event types (`supply.declared/collected/processed/listed`) need chain configs *seeded* (config, not code —
  same act as #1098 did for calendar/broker events)
- `requireAppAuth()` on the new app surface

🔴 **Net-new (the real 56-day work — unchanged from the scope doc):**
- The **config-authoring app surface** (`integrity.imajin.ai`) — where a scope owner defines stages/knobs and
  bakers/Vyefield fire events. This is the UX layer.
- **Gemini voice→`supply.declared` payload** adapter
- Infra/deploy/CI, demo video, real-revenue evidence

**Key point:** decomposing into config does NOT shrink the 56-day build — the engines were always going to be
reused. What it buys is **architecture that generalizes**: the MVP we ship for bread→feedstock is the same
machine that runs Agricluster #2..#100 by changing config rows. We're not building a bread app; we're building a
supply-chain *configuration surface* and proving it on bread.

---

## 5. Design decisions (LOCKED 2026-06-23)

1. **Event namespace → new `supply.*`** ✅ Pre-sale stages get `supply.declared/collected/processed/listed`;
   reuse `order.completed` for the settle (its chain already exists). New namespace because pre-sale stages are
   *free provenance events* with no settle — semantically distinct from a market `listing.purchased`, and the
   `supply.*` vocabulary is useful across other domains (any input→transform→sale chain).
2. **Stage storage → generic stage table keyed by `correlationId`** ✅ One lot, many stages, queryable as a chain.
   This is what makes it a *stack* rather than disconnected events (same move that made calendar entries a
   primitive, #1099). Working name `bus.supply_lots` (+ stage rows); confirm exact shape at issue time.
3. **Config-authoring UX → v1 is a READ-ONLY VIEW of the existing #781 reactor-config tables/endpoints** ✅
   We already have the tables + endpoints for configuring reactor chains (#762 DB config, #781 scope-owner UI).
   v1 does NOT build a config editor — it surfaces the existing chain config as a view ("here's how this supply
   chain is wired: inputs, which stages settle, output channels"). **Editing is later**, via the service/tool that
   already modifies reactors. So the "app" = runtime surface (fire events) + a read-only window into #781. Cleaner:
   no new config-authoring surface to build for the MVP.
4. **Pattern, not primitive (yet)** ✅ Prove the config pattern on bread; extract to a `supply chain` primitive
   when Agricluster #2 needs it. Same discipline as broker — don't generalize until the second consumer demands it.

### What the "app" actually is (two surfaces, collapsed for MVP)
- **Runtime surface** (per-deployment, the thing real users touch): bakers fire `supply.declared` (voice→Gemini),
  Vyefield fires collected/processed/listed, buyer triggers `order.completed`. This is the net-new UX.
- **Config view** (read-only window into #781): shows how the chain is wired. Not editable in v1.
- Later, these separate: the config-authoring becomes the generic primitive (the "stack builder"); the runtime
  stays per-deployment.

---

*Companion to `xprize-scope-of-work.md` (the build estimate) and `imajin-cais-services-agreement-DRAFT.md`
(the commercial terms). This doc is the architecture lens: the MVP as one configuration of a generic stack.*
