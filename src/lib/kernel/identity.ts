/**
 * Identity / trust-graph client — kernel's connections surface.
 *
 * GET /connections/api/connections is app-auth-gated (`connections:read`) and
 * returns the acting identity's trust-graph connections — the same source
 * the kernel's `connections_list` MCP tool uses to resolve a person's name to
 * their DID. AgriFortress uses it to populate the delivery card's Recipient
 * selector (xprize#55): the app resolves a recipient DID from the supplier's
 * own connections rather than accepting free text, so the signed
 * attestation's recipient/subject is always a real DID the receiver can
 * later countersign against (`POST /auth/api/attestations/countersign` only
 * allows the attestation subject to countersign).
 *
 * Reference: ima-jin/imajin-ai apps/kernel/app/connections/api/connections/route.ts
 *   GET /api/connections → { connections: ConnectionEntry[] }
 */

import { fetchKernel } from './client';

const CONNECTIONS_PATH = '/connections/api/connections';
const INVITES_PATH = '/connections/api/invites';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One trust-graph connection, enriched with the kernel's own identity lookup
 * (handle/name) and any nickname the acting supplier has assigned. Mirrors
 * `ConnectionEntry` from ima-jin/imajin-ai apps/kernel/src/lib/connections/list.ts.
 */
export interface ConnectionEntry {
  did: string;
  handle: string | null;
  name: string | null;
  nickname: string | null;
  connectedAt: string;
}

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

/**
 * Live trust-graph connections for the acting supplier. `attestationId` must
 * be the acting user's own session attestation (`SessionUser.attestationId`
 * from `getSession()`) — never a value read from process.env, since this app
 * serves many suppliers concurrently.
 */
export async function getConnections(attestationId: string): Promise<ConnectionEntry[]> {
  const res = await fetchKernel(CONNECTIONS_PATH, { method: 'GET' }, attestationId);

  if (!res.ok) {
    throw new Error(`identity.connections failed: ${res.status} ${res.statusText}`);
  }

  const body = await res.json() as { connections: ConnectionEntry[] };
  return body.connections;
}

/**
 * The best human-readable label for a connection — nickname (the acting
 * supplier's own label for this person) wins, then the kernel identity's
 * name, then handle, then the raw DID as a last resort so the option is
 * never blank.
 */
export function connectionLabel(connection: ConnectionEntry): string {
  return connection.nickname ?? connection.name ?? connection.handle ?? connection.did;
}

// ---------------------------------------------------------------------------
// Invites (xprize#59) — "invite will be sent" for a trust-graph connection
// who's never been active on AgriFortress before.
// ---------------------------------------------------------------------------

export interface CreateInviteRequest {
  /** 'link' is always available; 'email' additionally requires a hard DID + trust-graph membership on the kernel side. */
  delivery: 'link' | 'email';
  /** Required when delivery is 'email'. The app has no email address for a trust-graph connection today (ConnectionEntry carries none), so this is currently unused — see xprize#59 PR notes. */
  toEmail?: string;
  /** Free-text context carried on the invite row — the only context-carrying field the kernel invite API exposes today (no query-param/deep-link slot; see xprize#59 PR notes). */
  note?: string;
}

export interface CreateInviteResponse {
  invite: { id: string; code: string; delivery: 'link' | 'email'; status: string };
  /** Shareable invite URL, e.g. `{connectionsBaseUrl}/invite/{did}/{code}`. */
  url: string;
}

/**
 * Create a connections-service invite (xprize#59, per Ryan's addendum on the
 * issue: reuse `/connections/api` invite create rather than inventing a new
 * mechanism).
 *
 * KNOWN GAP (documented in a comment on xprize#59, not fixed here): as read
 * in the public ima-jin/imajin-ai repo
 * (apps/kernel/app/connections/api/invites/route.ts), this kernel route
 * authenticates via `getSessionFromCookies` — the human's own kernel web
 * session cookie — not the app-auth Bearer token this client (`fetchKernel`)
 * sends, unlike every other kernel route this app calls (e.g.
 * `/connections/api/connections`, which is `resolveEffectiveDid` /
 * app-auth-gated). Calling it from a server-side app request may 401 until
 * the kernel exposes an app-auth-compatible variant, similar to the already
 * known ima-jin/imajin-ai#1431 gap referenced in `src/lib/inference.ts`.
 * Implemented anyway (forward-compatible; a harmless attempt today) so the
 * app-side seam is ready the moment the kernel supports it.
 *
 * `attestationId` must be the acting user's own session attestation.
 */
export async function createConnectionInvite(
  body: CreateInviteRequest,
  attestationId: string,
): Promise<CreateInviteResponse> {
  const res = await fetchKernel(
    INVITES_PATH,
    { method: 'POST', body: JSON.stringify(body) },
    attestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`identity.invites.create failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<CreateInviteResponse>;
}
