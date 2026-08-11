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
