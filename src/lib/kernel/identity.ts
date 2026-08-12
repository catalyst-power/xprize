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
  /** 'link' is always available; 'email' requires `toEmail` (xprize#86 — a brand-new email now mints a claimable stub DID, ima-jin/imajin-ai PR #1836). */
  delivery: 'link' | 'email';
  /** Required when delivery is 'email'. */
  toEmail?: string;
  /** Free-text context carried on the invite row — the only context-carrying field the kernel invite API exposes today (no query-param/deep-link slot; see xprize#59 PR notes). */
  note?: string;
  /**
   * The AgriFortress org DID to scope onboarding into (xprize#86,
   * ima-jin/imajin-ai PR #1837 — "Phase 2 of #1834"). Optional and
   * additive so this call stays backward compatible with a kernel that
   * hasn't deployed migration 0094 yet — see `createConnectionInvite`'s
   * fallback behavior below.
   */
  scopeDid?: string;
  /**
   * The delivery attestation this invite should resolve to once the
   * bilateral claim ratchet closes (same PR). The kernel validates it
   * references an existing, still-`pending` attestation that this
   * invite's sender is a party to (issuer or subject) — callers must only
   * ever pass the ID of an attestation already created by the acting
   * supplier, i.e. the attestation must exist before this call (xprize#86).
   */
  pendingAttestationId?: string;
}

export interface CreateInviteResponse {
  invite: {
    id: string;
    code: string;
    delivery: 'link' | 'email';
    status: string;
    /**
     * The resolved/minted recipient DID for an email invite (ima-jin/imajin-ai
     * PR #1836). A brand-new email mints a fresh claimable-stub DID; a
     * repeat email silently resolves to its existing stub — the response
     * shape is identical either way (match-without-disclosure per the
     * kernel's design), so callers must never branch on whether this DID
     * looks "new" vs "existing".
     */
    toDid?: string;
  };
  /** Shareable invite URL, e.g. `{connectionsBaseUrl}/invite/{did}/{code}`. */
  url: string;
}

/**
 * Create a connections-service invite (xprize#59, per Ryan's addendum on the
 * issue: reuse `/connections/api` invite create rather than inventing a new
 * mechanism).
 *
 * Previously known gap, now fixed: this kernel route used to authenticate
 * via `getSessionFromCookies` only, so this server-side app-auth call
 * (`fetchKernel`) 401'd (xprize#77). ima-jin/imajin-ai#1794 added a dual
 * guard — `requireAppAuth(request, { scope: 'connections:write' })` first,
 * falling back to the session cookie — so this call now authenticates the
 * same way every other kernel route this app calls does (Bearer app token +
 * `X-App-DID`, both already sent by `fetchKernel`; see `src/lib/kernel/client.ts`).
 * No header-shape change was needed on this side.
 *
 * `attestationId` must be the acting user's own session attestation.
 */
export async function createConnectionInvite(
  body: CreateInviteRequest,
  attestationId: string,
): Promise<CreateInviteResponse> {
  const hasContext = body.scopeDid !== undefined || body.pendingAttestationId !== undefined;
  const res = await postInvite(body, attestationId);

  // Graceful degradation (xprize#86): `scopeDid`/`pendingAttestationId` are
  // additive kernel fields (ima-jin/imajin-ai PR #1837, migrations 0093 +
  // 0094) that may not be deployed to this kernel yet, or may be
  // individually rejected (e.g. an unrecognized `scopeDid`) with a 400.
  // Either way the invite itself is still worth sending, so a 400 response
  // to a context-bearing request is retried once with the context fields
  // stripped rather than failing the invite outright.
  if (!res.ok && res.status === 400 && hasContext) {
    return parseInviteResponse(await postInvite(stripInviteContext(body), attestationId));
  }

  return parseInviteResponse(res);
}

function postInvite(body: CreateInviteRequest, attestationId: string): Promise<Response> {
  return fetchKernel(INVITES_PATH, { method: 'POST', body: JSON.stringify(body) }, attestationId);
}

/** Drops `scopeDid`/`pendingAttestationId` for the context-less fallback request. */
function stripInviteContext(body: CreateInviteRequest): CreateInviteRequest {
  return { delivery: body.delivery, toEmail: body.toEmail, note: body.note };
}

async function parseInviteResponse(res: Response): Promise<CreateInviteResponse> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`identity.invites.create failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<CreateInviteResponse>;
}
