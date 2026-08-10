import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/supply', () => ({
  recentLots: vi.fn(),
}));

import { getSession } from '@/lib/session';
import { recentLots, type RecentLot } from '@/lib/supply';
import DashboardPage, {
  ConnectErrorBanner,
  connectErrorLabel,
  RecentDeliveries,
  resolveConnectError,
} from './page';

const mockGetSession = vi.mocked(getSession);
const mockRecentLots = vi.mocked(recentLots);

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

describe('DashboardPage', () => {
  it('renders the connect-error banner when connect_error is present in searchParams', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);

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

    const element = await DashboardPage({ searchParams: Promise.resolve({}) });

    expect(findElementOfType(element, ConnectErrorBanner)).toBeUndefined();
  });

  it('fetches up to 5 recent lots and passes them to RecentDeliveries (#49)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([]);

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

    const element = await DashboardPage({ searchParams: Promise.resolve({}) });

    const recentDeliveries = findElementOfType(element, RecentDeliveries);
    expect(recentDeliveries).toBeDefined();
    expect(recentDeliveries?.props?.['lots']).toEqual(lots);
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
