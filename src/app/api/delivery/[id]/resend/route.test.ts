import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
// `resend/route.ts` imports `toReceiptPayload` from DeliveryReceipt.tsx,
// which transitively imports settlementFlow.ts — that module also imports
// from `@/lib/supply`, so this mock spreads the real module (same pattern
// as DeliveryReceipt.test.ts) rather than replacing it wholesale, to avoid
// breaking those unrelated named exports.
vi.mock('@/lib/supply', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supply')>('@/lib/supply');
  return { ...actual, getLotChain: vi.fn(), resolveActiveRecipientDids: vi.fn() };
});
vi.mock('@/lib/settlementFlow', () => ({ attemptInvoiceCreation: vi.fn() }));
vi.mock('@/lib/kernel/attestations', () => ({ isReceiptBilateral: vi.fn() }));
vi.mock('@/lib/kernel/chat', () => ({ sendDirectMessage: vi.fn() }));
vi.mock('@/lib/kernel/identity', () => ({ createConnectionInvite: vi.fn() }));

import { getSession } from '@/lib/session';
import { getLotChain, resolveActiveRecipientDids } from '@/lib/supply';
import { isReceiptBilateral } from '@/lib/kernel/attestations';
import { sendDirectMessage } from '@/lib/kernel/chat';
import { createConnectionInvite } from '@/lib/kernel/identity';
import { __resetDeliveryNotifyStoreForTests, cacheRecipientDid } from '@/lib/deliveryNotifyStore';
import type { LotChain } from '@/lib/supply';

const mockGetSession = vi.mocked(getSession);
const mockGetLotChain = vi.mocked(getLotChain);
const mockResolveActiveRecipientDids = vi.mocked(resolveActiveRecipientDids);
const mockIsBilateral = vi.mocked(isReceiptBilateral);
const mockSendDirectMessage = vi.mocked(sendDirectMessage);
const mockCreateInvite = vi.mocked(createConnectionInvite);

const SESSION_USER = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-1',
};

const CHAIN_WITH_RECEIVED: LotChain = {
  lot: {
    correlationId: 'lot_abc123',
    originatingDid: 'did:imajin:scott',
    commodity: 'eggs',
    status: 'received',
    createdAt: '2026-01-01T00:00:00Z',
  },
  stages: [
    {
      stage: 'received',
      actorDid: 'did:imajin:scott',
      attestationCid: 'bafkreireceived',
      priorCid: null,
      payload: { commodity: 'eggs', quantity: 6, unit: 'dozen', recipient: 'did:imajin:david' },
      createdAt: '2026-01-01T01:00:00Z',
    },
  ],
};

const CHAIN_WITHOUT_RECEIVED: LotChain = {
  lot: { ...CHAIN_WITH_RECEIVED.lot, status: 'declared' },
  stages: [],
};

function makeRequest() {
  return new NextRequest('http://localhost/api/delivery/lot_abc123/resend', { method: 'POST' });
}

function makeParams(id = 'lot_abc123') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  __resetDeliveryNotifyStoreForTests();
});

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

describe('POST /api/delivery/[id]/resend — auth', () => {
  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

describe('POST /api/delivery/[id]/resend — guard rails', () => {
  it('returns 502 when the lot chain cannot be read', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetLotChain.mockRejectedValue(new Error('supply.lot.read failed: 404 Not Found'));

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(502);
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it('returns 400 when the lot has no received stage yet', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetLotChain.mockResolvedValue(CHAIN_WITHOUT_RECEIVED);

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(400);
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it('returns 400 when no recipient DID can be resolved (neither cache nor a DID-shaped payload field)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetLotChain.mockResolvedValue({
      ...CHAIN_WITH_RECEIVED,
      stages: [
        {
          ...CHAIN_WITH_RECEIVED.stages[0],
          payload: { ...CHAIN_WITH_RECEIVED.stages[0].payload, recipient: 'Grace Harbour Farms' },
        },
      ],
    });
    mockIsBilateral.mockResolvedValue(false);

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(400);
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it('skips (200) without sending when the receipt is already bilateral, and marks the ladder stopped', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetLotChain.mockResolvedValue(CHAIN_WITH_RECEIVED);
    mockIsBilateral.mockResolvedValue(true);

    const res = await POST(makeRequest(), makeParams());
    const body = (await res.json()) as { skipped: boolean };

    expect(res.status).toBe(200);
    expect(body.skipped).toBe(true);
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /api/delivery/[id]/resend — success', () => {
  it('re-sends the chat DM to the recipient DID cached at confirm time', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetLotChain.mockResolvedValue(CHAIN_WITH_RECEIVED);
    mockIsBilateral.mockResolvedValue(false);
    mockSendDirectMessage.mockResolvedValue(undefined);
    mockResolveActiveRecipientDids.mockResolvedValue(new Set(['did:imajin:david']));
    cacheRecipientDid('lot_abc123', 'did:imajin:david');

    const res = await POST(makeRequest(), makeParams());
    const body = (await res.json()) as { notified: boolean; inviteSent: boolean };

    expect(res.status).toBe(200);
    expect(body.notified).toBe(true);
    expect(body.inviteSent).toBe(false);
    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      'did:imajin:david',
      expect.stringContaining('/delivery/lot_abc123'),
      SESSION_USER.attestationId,
    );
  });

  it('falls back to the received stage payload recipient when it already looks like a DID and nothing is cached', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetLotChain.mockResolvedValue(CHAIN_WITH_RECEIVED);
    mockIsBilateral.mockResolvedValue(false);
    mockSendDirectMessage.mockResolvedValue(undefined);
    mockResolveActiveRecipientDids.mockResolvedValue(new Set(['did:imajin:david']));

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      'did:imajin:david',
      expect.any(String),
      SESSION_USER.attestationId,
    );
  });

  it('re-fires the connection invite when the recipient is not yet active on AgriFortress', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetLotChain.mockResolvedValue(CHAIN_WITH_RECEIVED);
    mockIsBilateral.mockResolvedValue(false);
    mockSendDirectMessage.mockResolvedValue(undefined);
    mockResolveActiveRecipientDids.mockResolvedValue(new Set()); // recipient not active
    mockCreateInvite.mockResolvedValue({ invite: { id: 'inv_1', code: 'c1', delivery: 'link', status: 'pending' }, url: 'https://example.test/invite' });

    const res = await POST(makeRequest(), makeParams());
    const body = (await res.json()) as { inviteSent: boolean; inviteFailed: boolean };

    expect(res.status).toBe(200);
    expect(body.inviteSent).toBe(true);
    expect(body.inviteFailed).toBe(false);
    expect(mockCreateInvite).toHaveBeenCalledOnce();
  });

  it('does not re-fire the invite for an already-active recipient', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetLotChain.mockResolvedValue(CHAIN_WITH_RECEIVED);
    mockIsBilateral.mockResolvedValue(false);
    mockSendDirectMessage.mockResolvedValue(undefined);
    mockResolveActiveRecipientDids.mockResolvedValue(new Set(['did:imajin:david']));

    await POST(makeRequest(), makeParams());

    expect(mockCreateInvite).not.toHaveBeenCalled();
  });

  it('reports inviteFailed but still returns 200 when the invite resend throws (non-blocking)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetLotChain.mockResolvedValue(CHAIN_WITH_RECEIVED);
    mockIsBilateral.mockResolvedValue(false);
    mockSendDirectMessage.mockResolvedValue(undefined);
    mockResolveActiveRecipientDids.mockResolvedValue(new Set());
    mockCreateInvite.mockRejectedValue(new Error('identity.invites.create failed: 500'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await POST(makeRequest(), makeParams());
    const body = (await res.json()) as { notified: boolean; inviteFailed: boolean };

    expect(res.status).toBe(200);
    expect(body.notified).toBe(true);
    expect(body.inviteFailed).toBe(true);

    consoleErrorSpy.mockRestore();
  });

  it('returns 502 when the chat DM send fails', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetLotChain.mockResolvedValue(CHAIN_WITH_RECEIVED);
    mockIsBilateral.mockResolvedValue(false);
    mockSendDirectMessage.mockRejectedValue(new Error('chat.messages.send failed: 403 Soft DID'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(502);
    expect(mockCreateInvite).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
