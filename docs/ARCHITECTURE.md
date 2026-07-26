# Architecture — &lt;App Name&gt;

> This app is a **lens** over the user's signed records. It owns no authoritative state. See `AGENTS.md` §1–§3.

## The three-tier projection model

| Tier | What | Owns truth? |
|------|------|-------------|
| **User's signed records** | signed markdown/attestations on the user's per-DID path (hosted now, user-held vault later) | ✅ source of truth |
| **Kernel domain core** | domain events / stage tables / settlement primitive | ❌ derived projection |
| **Connectors** | user-selected services (QuickBooks, …) feeding the user's records | ❌ user's instruments |
| **This app** | render + gesture UX + connector-select | ❌ a lens |

## Integration contract

External client only — app-auth headers (`X-App-DID` + `X-App-Authorization`) → kernel returns
`{ appDid, userDid, scopes }`. No `@imajin/*` deps, no DB, no in-process bus. Domain events are emitted by calling the
kernel's app-auth-gated domain API.

## The loop this app instruments

_<Describe the real-world loop: who hands what to whom, which single leg is paid (`.fair`), and how the gesture becomes
a signed record without adding friction.>_

## Open decisions

_<Running list of design decisions still to lock.>_
