import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/supply', () => ({
  recentLots: vi.fn(),
  getLotChain: vi.fn(),
  collectRecipientDids: vi.fn(),
}));

vi.mock('@/lib/kernel/identity', () => ({
  getConnections: vi.fn(),
}));

vi.mock('@/lib/kernel/attestations', () => ({
  getAttestationsBySubject: vi.fn(),
}));

import { getSession } from '@/lib/session';
import { recentLots, getLotChain, collectRecipientDids, type LotChain, type RecentLot } from '@/lib/supply';
import { getConnections, type ConnectionEntry } from '@/lib/kernel/identity';
import { getAttestationsBySubject, type AttestationRecord } from '@/lib/kernel/attestations';
import DashboardPage, {
  ConnectErrorBanner,
  connectErrorLabel,
  InviteErrorNotice,
  RecentDeliveries,
  resolveConnectError,
  resolveInviteError,
} from './page';
import { DeliveryGesture } from './DeliveryGesture';
import { PendingSignatures } from './PendingSignatures';

const mockGetSession = vi.mocked(getSession);
const mockRecentLots = vi.mocked(recentLots);
const mockGetConnections = vi.mocked(getConnections);
const mockGetLotChain = vi.mocked(getLotChain);
const mockCollectRecipientDids = vi.mocked(collectRecipientDids);
const mockGetAttestationsBySubject = vi.mocked(getAttestationsBySubject);

// Default: no pending signatures — most existing tests below don't exercise
// the inbox itself, so give every test a working default (xprize#74).
mockGetAttestationsBySubject.mockResolvedValue([]);

// xprize#59 wiring defaults — most existing tests below don't exercise the
// activity heuristic itself (that's covered in supply.test.ts), so give
// every test a working default and only override it where relevant.
mockGetLotChain.mockResolvedValue({
  lot: { correlationId: 'lot_x', originatingDid: 'did:imajin:scott', commodity: null, status: 'received', createdAt: '2026-01-01T00:00:00Z' },
  stages: [],
});
mockCollectRecipientDids.mockReturnValue(new Set());

const SESSION_USER = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-123',
};

// ---------------------------------------------------------------------------
// resolveConnectError
// ---------------------------------------------------------------------------

describe('resolveConnectError', () => {
  it('reads the connect_error flag when present', () => {
    expect(resolveConnectError({ connect_error: 'quickbooks' })).toBe('quickbooks');
  });

  it('returns undefined when connect_error is absent', () => {
    expect(resolveConnectError({})).toBeUndefined();
  });

  it('returns undefined when connect_error is an array (multi-value query param)', () => {
    expect(resolveConnectError({ connect_error: ['quickbooks', 'gemini'] })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// connectErrorLabel
// ---------------------------------------------------------------------------

describe('connectErrorLabel', () => {
  it('maps the quickbooks connector id to its display name', () => {
    expect(connectErrorLabel('quickbooks')).toBe('QuickBooks');
  });

  it('falls back to the raw connector id for unknown connectors', () => {
    expect(connectErrorLabel('gemini')).toBe('gemini');
  });
});

// ---------------------------------------------------------------------------
// resolveInviteError (xprize#77)
// ---------------------------------------------------------------------------

describe('resolveInviteError', () => {
  it('is true when invite_error=1 is present', () => {
    expect(resolveInviteError({ invite_error: '1' })).toBe(true);
  });

  it('is false when invite_error is absent', () => {
    expect(resolveInviteError({})).toBe(false);
  });

  it('is false when invite_error is an array (multi-value query param)', () => {
    expect(resolveInviteError({ invite_error: ['1', '1'] })).toBe(false);
  });

  it('is false for any value other than the literal "1"', () => {
    expect(resolveInviteError({ invite_error: 'true' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DashboardPage — connect-error banner (xprize#46: previously read but never
// surfaced, so a failed QuickBooks Connect click failed silently)
// ---------------------------------------------------------------------------

/**
 * Walk a React element tree (the plain objects JSX produces — DashboardPage
 * is called directly here, so nested function components like
 * ConnectErrorBanner are never invoked/rendered) looking for an element of
 * the given component type.
 */
function findElementOfType(node: unknown, type: unknown): { props?: Record<string, unknown> } | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementOfType(child, type);
      if (found) return found;
    }
    return undefined;
  }

  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type) return element;
  return findElementOfType(element.props?.['children'], type);
}

const CONNECTIONS: ConnectionEntry[] = [
  { did: 'did:imajin:david', handle: 'david', name: 'David Ko', nickname: null, connectedAt: '2026-01-01T00:00:00Z' },
];

describe('DashboardPage', () => {
  it('renders the connect-error banner when connect_error is present in searchParams', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);
    mockGetConnections.mockResolvedValue([]);

    const element = await DashboardPage({
      searchParams: Promise.resolve({ connect_error: 'quickbooks' }),
    });

    const banner = findElementOfType(element, ConnectErrorBanner);
    expect(banner).toBeDefined();
    expect(banner?.props?.['connectError']).toBe('quickbooks');
  });

  it('does not render the connect-error banner when connect_error is absent', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);
    mockGetConnections.mockResolvedValue([]);

    const element = await DashboardPage({ searchParams: Promise.resolve({}) });

    expect(findElementOfType(element, ConnectErrorBanner)).toBeUndefined();
  });

  it('renders the invite-error notice when invite_error=1 is present (xprize#77)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);
    mockGetConnections.mockResolvedValue([]);

    const element = await DashboardPage({
      searchParams: Promise.resolve({ lot: 'lot_abc123', invite_error: '1' }),
    });

    const notice = findElementOfType(element, InviteErrorNotice);
    expect(notice).toBeDefined();
    expect(notice?.props?.['dismissHref']).toBe('/dashboard?lot=lot_abc123');
  });

  it('does not render the invite-error notice when invite_error is absent', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);
    mockGetConnections.mockResolvedValue([]);

    const element = await DashboardPage({ searchParams: Promise.resolve({}) });

    expect(findElementOfType(element, InviteErrorNotice)).toBeUndefined();
  });

  it('fetches up to 5 recent lots and passes them to RecentDeliveries (#49)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);
    mockGetConnections.mockResolvedValue([]);

    await DashboardPage({ searchParams: Promise.resolve({}) });

    expect(mockRecentLots).toHaveBeenCalledWith(SESSION_USER.did, SESSION_USER.attestationId, 5);
  });

  it('passes the fetched recent lots through to RecentDeliveries', async () => {
    const lots: RecentLot[] = [
      {
        correlationId: 'lot_1',
        originatingDid: SESSION_USER.did,
        commodity: 'eggs',
        status: 'received',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue(lots);
    mockGetConnections.mockResolvedValue([]);

    const element = await DashboardPage({ searchParams: Promise.resolve({}) });

    const recentDeliveries = findElementOfType(element, RecentDeliveries);
    expect(recentDeliveries).toBeDefined();
    expect(recentDeliveries?.props?.['lots']).toEqual(lots);
  });

  it("fetches the acting supplier's trust-graph connections (xprize#55)", async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);
    mockGetConnections.mockResolvedValue(CONNECTIONS);

    await DashboardPage({ searchParams: Promise.resolve({}) });

    expect(mockGetConnections).toHaveBeenCalledWith(SESSION_USER.attestationId);
  });

  it('passes the fetched connections through to DeliveryGesture', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);
    mockGetConnections.mockResolvedValue(CONNECTIONS);

    const element = await DashboardPage({ searchParams: Promise.resolve({}) });

    const gesture = findElementOfType(element, DeliveryGesture);
    expect(gesture).toBeDefined();
    expect(gesture?.props?.['connections']).toEqual(CONNECTIONS);
  });

  it('renders DeliveryGesture with an empty connections list when the kernel call fails (fail-closed, non-fatal)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);
    mockGetConnections.mockRejectedValue(new Error('identity.connections failed: 500 Internal Server Error'));

    const element = await DashboardPage({ searchParams: Promise.resolve({}) });

    const gesture = findElementOfType(element, DeliveryGesture);
    expect(gesture?.props?.['connections']).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // activeRecipientDids wiring (xprize#59) — the heuristic itself
  // (collectRecipientDids) is unit-tested in supply.test.ts; here we only
  // check the page fetches each recent lot's chain and threads the result
  // through to DeliveryGesture.
  // -------------------------------------------------------------------------

  it("fetches each recent lot's chain and passes collectRecipientDids' result to DeliveryGesture", async () => {
    const lots: RecentLot[] = [
      { correlationId: 'lot_1', originatingDid: SESSION_USER.did, commodity: 'eggs', status: 'received', createdAt: '2026-01-01T00:00:00Z' },
    ];
    const chain: LotChain = {
      lot: { correlationId: 'lot_1', originatingDid: SESSION_USER.did, commodity: 'eggs', status: 'received', createdAt: '2026-01-01T00:00:00Z' },
      stages: [],
    };
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue(lots);
    mockGetConnections.mockResolvedValue(CONNECTIONS);
    mockGetLotChain.mockResolvedValue(chain);
    mockCollectRecipientDids.mockReturnValue(new Set(['did:imajin:david']));

    const element = await DashboardPage({ searchParams: Promise.resolve({}) });

    expect(mockGetLotChain).toHaveBeenCalledWith('lot_1', SESSION_USER.attestationId);
    expect(mockCollectRecipientDids).toHaveBeenCalledWith([chain]);
    const gesture = findElementOfType(element, DeliveryGesture);
    expect(gesture?.props?.['activeRecipientDids']).toEqual(['did:imajin:david']);
  });

  it('omits a lot chain from the scan (non-fatal) when getLotChain fails for that lot', async () => {
    const lots: RecentLot[] = [
      { correlationId: 'lot_1', originatingDid: SESSION_USER.did, commodity: 'eggs', status: 'received', createdAt: '2026-01-01T00:00:00Z' },
    ];
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue(lots);
    mockGetConnections.mockResolvedValue([]);
    mockGetLotChain.mockRejectedValue(new Error('supply.lot.read failed: 500 Internal Server Error'));
    mockCollectRecipientDids.mockReturnValue(new Set());

    const element = await DashboardPage({ searchParams: Promise.resolve({}) });

    expect(mockCollectRecipientDids).toHaveBeenCalledWith([]);
    const gesture = findElementOfType(element, DeliveryGesture);
    expect(gesture?.props?.['activeRecipientDids']).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Pending-signatures inbox (xprize#74) — attestations naming the current
  // session user as *subject* that are still pending. The formatting/sign
  // action itself is unit-tested in PendingSignatures.test.ts; here we only
  // check the page fetches and threads them through.
  // -------------------------------------------------------------------------

  const PENDING_ATTESTATION: AttestationRecord = {
    id: 'att_1',
    issuerDid: 'did:imajin:scott',
    subjectDid: 'did:imajin:debbie',
    type: 'supply.received',
    contextId: 'lot_1',
    contextType: 'supply',
    cid: 'bafy1',
    attestationStatus: 'pending',
    issuedAt: '2026-08-11T00:00:00Z',
  };

  it("fetches attestations naming the session user as subject with status=pending (#74)", async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);
    mockGetConnections.mockResolvedValue([]);

    await DashboardPage({ searchParams: Promise.resolve({}) });

    expect(mockGetAttestationsBySubject).toHaveBeenCalledWith({
      subjectDid: SESSION_USER.did,
      status: 'pending',
    });
  });

  it('passes the fetched pending attestations through to PendingSignatures', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);
    mockGetConnections.mockResolvedValue([]);
    mockGetAttestationsBySubject.mockResolvedValue([PENDING_ATTESTATION]);

    const element = await DashboardPage({ searchParams: Promise.resolve({}) });

    const pendingSignatures = findElementOfType(element, PendingSignatures);
    expect(pendingSignatures).toBeDefined();
    expect(pendingSignatures?.props?.['attestations']).toEqual([PENDING_ATTESTATION]);
  });

  it('renders PendingSignatures with an empty list when the kernel call fails (fail-closed, non-fatal)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);
    mockGetConnections.mockResolvedValue([]);
    mockGetAttestationsBySubject.mockRejectedValue(new Error('attestations.read failed: 500 Internal Server Error'));

    const element = await DashboardPage({ searchParams: Promise.resolve({}) });

    const pendingSignatures = findElementOfType(element, PendingSignatures);
    expect(pendingSignatures?.props?.['attestations']).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RecentDeliveries — read-only list of the supplier's most recent signed
// lots. Hidden entirely when there are none; every returned lot is shown (#49).
// ---------------------------------------------------------------------------

describe('RecentDeliveries', () => {
  it('renders nothing when there are no recent lots', () => {
    expect(RecentDeliveries({ lots: [] })).toBeNull();
  });

  it('renders a list item for each recent lot, keyed by correlationId', () => {
    const lots: RecentLot[] = [
      {
        correlationId: 'lot_1',
        originatingDid: 'did:imajin:scott',
        commodity: 'eggs',
        status: 'received',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        correlationId: 'lot_2',
        originatingDid: 'did:imajin:scott',
        commodity: null,
        status: 'declared',
        createdAt: '2026-01-02T00:00:00Z',
      },
    ];

    const element = RecentDeliveries({ lots });
    expect(element).not.toBeNull();

    // <section>{<p/>, <ul>{items}</ul>}</section> — the list is the second child.
    const sectionChildren = (element as { props: { children: unknown[] } }).props.children;
    const list = sectionChildren[1] as { props: { children: unknown[] } };
    expect(list.props.children).toHaveLength(2);
  });
});
