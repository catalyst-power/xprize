/**
 * Connector status client — kernel's app-facing connector surface
 * (ima-jin/imajin-ai#1540).
 *
 * GET /connections/api/connectors/status is app-auth-gated and
 * registry-generic: it returns `{ id, connected, scopes }[]` for whichever
 * identity the request is delegated for. It never returns credentials,
 * config, or tokens — the app only ever witnesses a boolean + scope list
 * (AGENTS.md §2, §3).
 *
 * Callers must treat every result as a live snapshot — AGENTS.md §4 forbids
 * caching a "connected" verdict in the app, since a stale true would be the
 * app fabricating a profile fact it doesn't own.
 */

import { fetchKernel, fetchKernelAsSelf } from './client';

const CONNECTOR_STATUS_PATH = '/connections/api/connectors/status';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectorStatus {
  id: string;
  connected: boolean;
  scopes: string[];
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function readConnectorStatusResponse(
  res: Response,
  label: string,
): Promise<ConnectorStatus[]> {
  if (!res.ok) {
    throw new Error(`${label} failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<ConnectorStatus[]>;
}

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

/**
 * Live connector status for the currently acting supplier (e.g. their own
 * QuickBooks connection). `attestationId` must be the acting user's own
 * session attestation (`SessionUser.attestationId` from `getSession()`) —
 * never a value read from process.env, since this app serves many suppliers.
 */
export async function getUserConnectorStatus(attestationId: string): Promise<ConnectorStatus[]> {
  const res = await fetchKernel(CONNECTOR_STATUS_PATH, { method: 'GET' }, attestationId);
  return readConnectorStatusResponse(res, 'connectors.status');
}

/**
 * Live connector status for AgriFortress's own org-level connectors —
 * connectors an org admin configures once for every supplier who uses this
 * app (e.g. Gemini's org-subsidized key), rather than each supplier
 * connecting it. Queried with the app's own self-authenticated identity
 * (no consent attestation) since AgriFortress is checking a fact about
 * itself, not acting on behalf of a supplier.
 */
export async function getOrgConnectorStatus(): Promise<ConnectorStatus[]> {
  const res = await fetchKernelAsSelf(CONNECTOR_STATUS_PATH, { method: 'GET' });
  return readConnectorStatusResponse(res, 'connectors.status (org)');
}

/** Find one connector's status by id; undefined when the kernel omitted it. */
export function findConnectorStatus(
  statuses: readonly ConnectorStatus[],
  id: string,
): ConnectorStatus | undefined {
  return statuses.find((status) => status.id === id);
}

/**
 * True only when the connector is connected AND its granted scopes include
 * the specific scope this app needs — never inferred from `connected` alone.
 */
export function hasRequiredScope(
  status: ConnectorStatus | undefined,
  requiredScope: string,
): boolean {
  if (status === undefined) return false;
  return status.connected && status.scopes.includes(requiredScope);
}
