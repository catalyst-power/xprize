# AgriFortress

**Entrant:** Catalyst Agri-Innovations Society (CAIS)  
**Platform:** Imajin (sovereign-tech kernel)  
**Contest:** XPRIZE "Build with Gemini" · Deadline: Aug 17, 2026

A third-party external client app that instruments a real farm-to-farm supply
chain — eggs from Misty Meadows to Grace Harbour Farms — using Imajin's
public app-auth surface and signed records.

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env and fill in your values
cp .env.example .env.local

# 3. Run dev server
pnpm dev
```

The app boots on `http://localhost:3402` by default.

## Health check

```bash
curl http://localhost:3402/api/health
# → { "status": "ok", "app": "agrifortress", "ts": "..." }
```

## App-auth demo

```bash
curl -H "X-App-DID: did:imajin:..." \
     -H "X-App-Authorization: att_..." \
     http://localhost:3402/api/whoami
# → { "appDid": "...", "userDid": "...", "scopes": [...] }
```

## Project structure

```
app/
  api/
    health/route.ts      # Liveness probe
    whoami/route.ts      # App-auth identity resolution demo
  layout.tsx             # Root layout
  page.tsx               # Landing page
  globals.css            # Tailwind entry
src/
  lib/
    app-auth.ts          # Self-contained app-auth client
```

## Build

```bash
pnpm build
```

No workspace dependencies — this repo is standalone.

## Integration contract

- **Authenticates** via `X-App-DID` + `X-App-Authorization` against the Imajin
  kernel public API (`/auth/api/apps/token/verify`).
- **Acts on-behalf-of** the user — `userDid` is the provenance anchor.
- **Holds no kernel internals** — no DB access, no in-process bus, no monorepo
  imports.

See `PROJECT.md` for architecture, build order, and design principles.

---

*Entrant: Catalyst Agri-Innovations Society · Platform: Imajin · Build with
Gemini XPRIZE 2026*
