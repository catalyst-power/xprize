# Catalyst × Imajin — XPRIZE "Build with Gemini" Entry

**Entrant:** Catalyst Agri-Innovations Society (CAIS) · **Technology vendor:** Imajin
**Deadline:** Aug 17, 2026, 1:00 PM PT · **App:** integrity.imajin.ai

This repository holds the **contest-facing deliverables** for the Virtual Co-Op XPRIZE entry: the demo, the
public writeup, the submission assets, and revenue evidence. Platform/kernel code lives separately in the Imajin
monorepo (`ima-jin/imajin-ai`); this repo is the entrant's deliverable surface.

---

## The MVP — bread → feedstock

A deployed app real users move real money through, demonstrated on an already-operating loop:

1. **Bakers declare** surplus/stale bread available for pickup *(voice intake → Gemini)* — free diversion, signed supply attestation.
2. **Vyefield Farms collects** the bread (collector + processor).
3. **Vyefield processes** bread → animal feedstock.
4. **Vyefield sells** feedstock to consumers — the real arms-length transaction, settled via `.fair`.

**Two legs, one chain:** the bread side gives a verifiable provenance trail (proving the feedstock came from real
diverted bread); the feedstock sale gives the audited revenue. Both run on one signed event chain.

> **Claim boundary:** signed attestations prove claims are *consistent and attributed*, not *true about the
> physical world*. All copy and reporting reflect this.

---

## What the judges score

- A **deployed app** real participants use (AI-native operations, equally weighted).
- A **3-minute demo video** showing a real loop end to end.
- **Real arms-length revenue**, May–Aug, with a monthly breakdown.
- An **AI-workflow-transformation** writeup.

---

## Repository scope

| Lives here (contest-facing) | Lives in `ima-jin/imajin-ai` (platform) |
|-----------------------------|------------------------------------------|
| Demo video + script | The `supply.*` event chain + reactors |
| Submission writeups | Settlement (`.fair`), attestation, identity |
| Public/clean demo references | App service code (integrity.imajin.ai) |
| Revenue evidence (anonymized) | Infra, deploy, Gemini adapter |

Architecture deep-dive: see `supply-chain-as-config` in the project gist and epic
[`ima-jin/imajin-ai#1133`](https://github.com/ima-jin/imajin-ai/issues/1133).

---

## Open inputs needed from CAIS (the gating items)

These block the demo/revenue, not the build. Pre-commit early — participants move slowly.

- [ ] **Named bakers** — which specific baker(s) will declare bread May–Aug
- [ ] **Named feedstock buyer(s)** — who pays Vyefield for feedstock in-window (the revenue gate)
- [ ] **Today's recording method** — how bakers declare bread now (phone / text / paper)
- [ ] **One real `.fair`-routed transaction** confirmed possible in-window
- [ ] **Google Cloud billing owner** — CAIS or Imajin (affects Cloud Run vs Vertex)

---

*Entrant: Catalyst Agri-Innovations Society · Vendor: Imajin · Build with Gemini XPRIZE 2026*
