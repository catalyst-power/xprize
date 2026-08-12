import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, resolveReminderTargets } from './route';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/supply', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supply')>('@/lib/supply');
  return { ...actual, getLotChain: vi.fn(), recentLots: vi.fn() };
});
vi.mock('@/lib/settlementFlow', () => ({ attemptInvoiceCreation: vi.fn() }));
vi.mock('@/lib/kernel/attestations', () => ({ isReceiptBilateral: vi.fn() }));
vi.mock('@/lib/kernel/chat', () => ({ sendDirectMessage: vi.fn() }));

import { getSession } from '@/lib/session';
import { getLotChain, recentLots } from '@/lib/supply';
import { isReceiptBilateral } from '@/lib/kernel/attestations';
import { sendDirectMessage } from '@/lib/kernel/chat';
import { __resetDeliveryNotifyStoreForTests, markRungSent, markStopped } from '@/lib/deliveryNotifyStore';
import type { LotChain, RecentLot } from '@/lib/supply';

const mockGetSession = vi.mocked(getSession);
const mockGetLotChain = vi.mocked(getLotChain);
const mockRecentLots = vi.mocked(recentLots);
const mockIsBilateral = vi.mocked(isReceiptBilateral);
const mockSendDirectMessage = vi.mocked(sendDirectMessage);

const SESSION_USER = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-1',
};

const RECENT_LOT: RecentLot = {
  correlationId: 'lot_abc123',
  originatingDid: 'did:imajin:scott',
  commodity: 'eggs',
  status: 'received',
  createdAt: '2026-01-01T00:00:00Z',
};

function chainSignedMinutesAgo(minutesAgo: number, now: Date, recipient = 'did:imajin:david'): LotChain {
  const createdAt = new Date(now.getTime() - minutesAgo * 60000).toISOString();
  return {
    lot: {
      correlationId: 'lot_abc123',
      originatingDid: 'did:imajin:scott',
      commodity: 'eggs',
      status: 'received',
      createdAt,
    },
    stages: [
      {
        stage: 'received',
        actorDid: 'did:imajin:scott',
        attestationCid: 'bafkreireceived',
        priorCid: null,
        payload: { commodity: 'eggs', quantity: 6, unit: 'dozen', recipient },
        createdAt,
      },
    ],
  };
}

function makeRequest(body?: object, authorization?: string) {
  return new NextRequest('http://localhost/api/delivery/reminders/check', {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(authorization !== undefined ? { headers: { authorization } } : {}),
  });
}

beforeEach(() => {
  __resetDeliveryNotifyStoreForTests();
  delete process.env.REMINDER_CRON_SECRET;
});

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// resolveReminderTargets — pure auth-mode resolution
// ---------------------------------------------------------------------------

describe('resolveReminderTargets', () => {
  it('resolves the caller session as the sole target when no cron secret is configured', () => {
    const targets = resolveReminderTargets(null, undefined, undefined, {
      did: 'did:imajin:scott',
      attestationId: 'att-1',
    });
    expect(targets).toEqual([{ supplierDid: 'did:imajin:scott', attestationId: 'att-1' }]);
  });

  it('returns undefined when there is no session and no cron secret configured', () => {
    expect(resolveReminderTargets(null, undefined, undefined, null)).toBeUndefined();
  });

  it('returns undefined when a bearer header is sent but no cron secret is configured (never trusts an unconfigured secret)', () => {
    expect(resolveReminderTargets('Bearer whatever', undefined, { targets: [] }, null)).toBeUndefined();
  });

  it('accepts the shared-secret bearer path and uses the body-supplied targets', () => {
    const targets = resolveReminderTargets(
      'Bearer s3cr3t',
      's3cr3t',
      { targets: [{ supplierDid: 'did:imajin:scott', attestationId: 'att-ext' }] },
      null,
    );
    expect(targets).toEqual([{ supplierDid: 'did:imajin:scott', attestationId: 'att-ext' }]);
  });

  it('rejects a mismatched bearer secret even when one is configured, falling back to session/undefined', () => {
    expect(resolveReminderTargets('Bearer wrong', 's3cr3t', { targets: [] }, null)).toBeUndefined();
  });

  it('filters out incomplete target entries from the cron body', () => {
    const targets = resolveReminderTargets(
      'Bearer s3cr3t',
      's3cr3t',
      { targets: [{ supplierDid: '', attestationId: 'att-1' }, { supplierDid: 'did:imajin:scott', attestationId: '' }] },
      null,
    );
    expect(targets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST — auth
// ---------------------------------------------------------------------------

describe('POST /api/delivery/reminders/check — auth', () => {
  it('returns 401 when there is no session and no cron secret configured', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
  });

  it('returns 400 for an unparseable body', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    const badRequest = new NextRequest('http://localhost/api/delivery/reminders/check', {
      method: 'POST',
      body: '{not json',
    });

    const res = await POST(badRequest);

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST — scheduling behavior
// ---------------------------------------------------------------------------

describe('POST /api/delivery/reminders/check — scheduling', () => {
  it('sends rung 0 once 5 minutes have elapsed and marks it sent', async () => {
    process.env.REMINDER_LADDER_MINUTES = '5,60,1440,10080';
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([RECENT_LOT]);
    mockGetLotChain.mockResolvedValue(chainSignedMinutesAgo(10, new Date()));
    mockIsBilateral.mockResolvedValue(false);
    mockSendDirectMessage.mockResolvedValue(undefined);

    const res = await POST(makeRequest());
    const body = (await res.json()) as { checked: number; sent: { correlationId: string; rung: number }[] };

    expect(res.status).toBe(200);
    expect(body.sent).toEqual([{ correlationId: 'lot_abc123', rung: 0, sent: true }]);
    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      'did:imajin:david',
      expect.any(String),
      SESSION_USER.attestationId,
    );
  });

  it('does not send when no rung is due yet', async () => {
    process.env.REMINDER_LADDER_MINUTES = '5,60,1440,10080';
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([RECENT_LOT]);
    mockGetLotChain.mockResolvedValue(chainSignedMinutesAgo(1, new Date()));
    mockIsBilateral.mockResolvedValue(false);

    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: unknown[] };

    expect(res.status).toBe(200);
    expect(body.sent).toEqual([]);
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it('never re-sends a rung that was already recorded as sent', async () => {
    process.env.REMINDER_LADDER_MINUTES = '5,60,1440,10080';
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([RECENT_LOT]);
    mockGetLotChain.mockResolvedValue(chainSignedMinutesAgo(10, new Date()));
    mockIsBilateral.mockResolvedValue(false);
    markRungSent('lot_abc123', 'did:imajin:david', 0);

    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: unknown[] };

    expect(body.sent).toEqual([]);
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it('stops permanently once the receipt is bilateral, without sending', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([RECENT_LOT]);
    mockGetLotChain.mockResolvedValue(chainSignedMinutesAgo(999999, new Date()));
    mockIsBilateral.mockResolvedValue(true);

    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: unknown[] };

    expect(body.sent).toEqual([]);
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it('never resumes for a lot already marked permanently stopped, even without re-checking bilateral', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([RECENT_LOT]);
    mockGetLotChain.mockResolvedValue(chainSignedMinutesAgo(999999, new Date()));
    markStopped('lot_abc123');

    await POST(makeRequest());

    expect(mockIsBilateral).not.toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it('skips a lot whose recipient DID cannot be resolved (no cache, non-DID payload field)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([RECENT_LOT]);
    mockGetLotChain.mockResolvedValue(chainSignedMinutesAgo(10, new Date(), 'Grace Harbour Farms'));
    mockIsBilateral.mockResolvedValue(false);

    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: unknown[] };

    expect(body.sent).toEqual([]);
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it('omits lots with no signed delivery yet (no received stage)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockRecentLots.mockResolvedValue([RECENT_LOT]);
    mockGetLotChain.mockResolvedValue({
      lot: { ...RECENT_LOT, status: 'declared' },
      stages: [],
    });

    const res = await POST(makeRequest());
    const body = (await res.json()) as { checked: number; sent: unknown[] };

    expect(body.checked).toBe(0);
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it('checks multiple explicitly-configured suppliers via the shared-secret path', async () => {
    process.env.REMINDER_CRON_SECRET = 's3cr3t';
    mockGetSession.mockResolvedValue(null);
    mockRecentLots.mockResolvedValue([RECENT_LOT]);
    mockGetLotChain.mockResolvedValue(chainSignedMinutesAgo(10, new Date()));
    mockIsBilateral.mockResolvedValue(false);
    mockSendDirectMessage.mockResolvedValue(undefined);

    const res = await POST(
      makeRequest(
        {
          targets: [
            { supplierDid: 'did:imajin:scott', attestationId: 'att-scott' },
            { supplierDid: 'did:imajin:other', attestationId: 'att-other' },
          ],
        },
        'Bearer s3cr3t',
      ),
    );
    const body = (await res.json()) as { checked: number };

    expect(res.status).toBe(200);
    expect(body.checked).toBe(2); // one lot per supplier target
    expect(mockRecentLots).toHaveBeenCalledWith('did:imajin:scott', 'att-scott', expect.any(Number));
    expect(mockRecentLots).toHaveBeenCalledWith('did:imajin:other', 'att-other', expect.any(Number));
  });
});
