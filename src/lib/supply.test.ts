import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  collectRecipientDids,
  declareSupplyLot,
  confirmDelivery,
  getLotChain,
  getLotChainAsSelf,
  materializeInferenceSupplyLot,
  recentLots,
  resolveActiveRecipientDids,
} from './supply';
import type { LotChain, RecentLot } from './supply';

vi.mock('./kernel/client', () => ({
  fetchKernel: vi.fn(),
  fetchKernelAsSelf: vi.fn(),
  fetchKernelAtUrl: vi.fn(),
}));

import { fetchKernel, fetchKernelAsSelf, fetchKernelAtUrl } from './kernel/client';

const mockFetch = vi.mocked(fetchKernel);
const mockFetchAsSelf = vi.mocked(fetchKernelAsSelf);
const mockFetchAtUrl = vi.mocked(fetchKernelAtUrl);

const ORIGINAL_SUPPLY_API_URL = process.env.AGRIFORTRESS_SUPPLY_API_URL;

afterEach(() => {
  vi.resetAllMocks();
  if (ORIGINAL_SUPPLY_API_URL === undefined) {
    delete process.env.AGRIFORTRESS_SUPPLY_API_URL;
  } else {
    process.env.AGRIFORTRESS_SUPPLY_API_URL = ORIGINAL_SUPPLY_API_URL;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okResponse(body: object) {
  return Promise.resolve({
    ok: true,
    status: 201,
    statusText: 'Created',
    json: () => Promise.resolve(body),
  } as Response);
}

function errorResponse(status: number, body: object) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(body),
  } as Response);
}

const DECLARED_RESPONSE = { ok: true, correlationId: 'lot_abc123', stage: 'declared' };
const RECEIVED_RESPONSE = { ok: true, correlationId: 'lot_abc123', stage: 'received' };

const LOT_CHAIN_RESPONSE: LotChain = {
  lot: {
    correlationId: 'lot_abc123',
    originatingDid: 'did:imajin:scott',
    commodity: 'eggs',
    status: 'received',
    createdAt: '2026-01-01T00:00:00Z',
  },
  stages: [
    {
      stage: 'declared',
      actorDid: 'did:imajin:scott',
      attestationCid: 'bafkreideclared',
      priorCid: null,
      payload: { commodity: 'eggs', quantity: 6, unit: 'dozen' },
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      stage: 'received',
      actorDid: 'did:imajin:scott',
      attestationCid: 'bafkreireceived',
      priorCid: 'bafkreideclared',
      payload: { commodity: 'eggs', quantity: 6, unit: 'dozen', recipient: 'Grace Harbour Farms' },
      createdAt: '2026-01-01T01:00:00Z',
    },
  ],
};

// Kernel wraps the array: { lots: RecentLot[] }
// ima-jin/imajin-ai@main apps/kernel/src/lib/supply.ts handleLotsBySupplierGet
const RECENT_LOTS_RESPONSE = {
  lots: [
    {
      correlationId: 'lot_abc123',
      originatingDid: 'did:imajin:scott',
      commodity: 'eggs',
      status: 'received',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ] satisfies RecentLot[],
};

// ---------------------------------------------------------------------------
// recentLots
// ---------------------------------------------------------------------------

describe('recentLots', () => {
  it('GETs /supply/api/lots with the supplier DID and limit encoded in the query string, passing attestationId to fetchKernel', async () => {
    mockFetch.mockReturnValue(okResponse(RECENT_LOTS_RESPONSE));

    await recentLots('did:imajin:scott', 'att-scott-123', 1);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [path, opts, attestationId] = mockFetch.mock.calls[0];
    expect(opts?.method).toBe('GET');
    expect(path).toContain('/supply/api/lots');
    expect(path).toContain('supplier=did%3Aimajin%3Ascott');
    expect(path).toContain('limit=1');
    expect(attestationId).toBe('att-scott-123');
  });

  it('uses limit=1 by default', async () => {
    mockFetch.mockReturnValue(okResponse(RECENT_LOTS_RESPONSE));

    await recentLots('did:imajin:scott', 'att-scott-123');

    const [path] = mockFetch.mock.calls[0];
    expect(path).toContain('limit=1');
  });

  it('returns the parsed RecentLot[] on success', async () => {
    mockFetch.mockReturnValue(okResponse(RECENT_LOTS_RESPONSE));

    const result = await recentLots('did:imajin:scott', 'att-scott-123', 1);

    expect(result).toHaveLength(1);
    expect(result[0].correlationId).toBe('lot_abc123');
    expect(result[0].commodity).toBe('eggs');
    expect(result[0].status).toBe('received');
  });

  it('returns an empty array when the supplier has no prior lots', async () => {
    mockFetch.mockReturnValue(okResponse({ lots: [] }));

    const result = await recentLots('did:imajin:scott', 'att-scott-123', 1);

    expect(result).toEqual([]);
  });

  it('throws with status + error message on a kernel error response', async () => {
    mockFetch.mockReturnValue(errorResponse(403, { error: 'forbidden' }));

    await expect(recentLots('did:imajin:scott', 'att-scott-123', 1)).rejects.toThrow(
      'supply.lots.read failed: 403',
    );
  });

  it('throws with statusText when the error body is not parseable', async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      } as Response),
    );

    await expect(recentLots('did:imajin:scott', 'att-scott-123', 1)).rejects.toThrow(
      'supply.lots.read failed: 500 Internal Server Error',
    );
  });
});

// ---------------------------------------------------------------------------
// declareSupplyLot
// ---------------------------------------------------------------------------

describe('declareSupplyLot', () => {
  it('POSTs to /supply/api/declared with commodity/quantity/unit, passing attestationId to fetchKernel', async () => {
    mockFetch.mockReturnValue(okResponse(DECLARED_RESPONSE));

    await declareSupplyLot({ commodity: 'eggs', quantity: 6, unit: 'dozen' }, 'att-scott-123');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [path, opts, attestationId] = mockFetch.mock.calls[0];
    expect(path).toBe('/supply/api/declared');
    expect(opts?.method).toBe('POST');
    expect(JSON.parse(opts?.body as string)).toEqual({ commodity: 'eggs', quantity: 6, unit: 'dozen' });
    expect(attestationId).toBe('att-scott-123');
  });

  it('returns the parsed SupplyStageResponse on success', async () => {
    mockFetch.mockReturnValue(okResponse(DECLARED_RESPONSE));

    const result = await declareSupplyLot(
      { commodity: 'eggs', quantity: 6, unit: 'dozen' },
      'att-scott-123',
    );

    expect(result.ok).toBe(true);
    expect(result.correlationId).toBe('lot_abc123');
    expect(result.stage).toBe('declared');
  });

  it('throws with status + error message on kernel error response', async () => {
    mockFetch.mockReturnValue(errorResponse(400, { error: 'commodity is required' }));

    await expect(
      declareSupplyLot({ commodity: '', quantity: 6, unit: 'dozen' }, 'att-scott-123'),
    ).rejects.toThrow('supply.declared failed: 400');
  });
});

// ---------------------------------------------------------------------------
// confirmDelivery
// ---------------------------------------------------------------------------

describe('confirmDelivery', () => {
  it('POSTs to /supply/api/received with lotId threaded from declared correlationId, passing attestationId to fetchKernel', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await confirmDelivery(
      { lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' },
      'att-scott-123',
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const [path, opts, attestationId] = mockFetch.mock.calls[0];
    expect(path).toBe('/supply/api/received');
    expect(opts?.method).toBe('POST');
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect(sent.lotId).toBe('lot_abc123');
    expect(sent.commodity).toBe('eggs');
    expect(attestationId).toBe('att-scott-123');
  });

  it('includes priorCid in the body when provided', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await confirmDelivery(
      {
        lotId: 'lot_abc123',
        commodity: 'eggs',
        quantity: 6,
        unit: 'dozen',
        priorCid: 'bafkreiabc',
      },
      'att-scott-123',
    );

    const [, opts] = mockFetch.mock.calls[0];
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect(sent.priorCid).toBe('bafkreiabc');
  });

  it('omits priorCid when not provided', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await confirmDelivery(
      { lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' },
      'att-scott-123',
    );

    const [, opts] = mockFetch.mock.calls[0];
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect('priorCid' in sent).toBe(false);
  });

  // -------------------------------------------------------------------------
  // recipientDid (ima-jin/imajin-ai#1820/#1821) — additive counterparty
  // pending-signature notification field. See the doc comment on
  // `SupplyReceivedRequest` for the full contract.
  // -------------------------------------------------------------------------

  it('includes recipientDid in the body when it looks like a real DID', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await confirmDelivery(
      {
        lotId: 'lot_abc123',
        commodity: 'eggs',
        quantity: 6,
        unit: 'dozen',
        recipientDid: 'did:imajin:david',
      },
      'att-scott-123',
    );

    const [, opts] = mockFetch.mock.calls[0];
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect(sent.recipientDid).toBe('did:imajin:david');
  });

  it('omits recipientDid when not provided', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await confirmDelivery(
      { lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' },
      'att-scott-123',
    );

    const [, opts] = mockFetch.mock.calls[0];
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect('recipientDid' in sent).toBe(false);
  });

  it('omits recipientDid rather than sending an empty string (e.g. an unresolved/unclaimed recipient)', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await confirmDelivery(
      {
        lotId: 'lot_abc123',
        commodity: 'eggs',
        quantity: 6,
        unit: 'dozen',
        recipientDid: '',
      },
      'att-scott-123',
    );

    const [, opts] = mockFetch.mock.calls[0];
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect('recipientDid' in sent).toBe(false);
  });

  it('omits recipientDid when it does not look like a DID (e.g. a free-text name)', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await confirmDelivery(
      {
        lotId: 'lot_abc123',
        commodity: 'eggs',
        quantity: 6,
        unit: 'dozen',
        recipientDid: 'Grace Harbour Farms',
      },
      'att-scott-123',
    );

    const [, opts] = mockFetch.mock.calls[0];
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect('recipientDid' in sent).toBe(false);
  });

  it('returns the parsed SupplyStageResponse on success', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    const result = await confirmDelivery(
      { lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' },
      'att-scott-123',
    );

    expect(result.ok).toBe(true);
    expect(result.correlationId).toBe('lot_abc123');
    expect(result.stage).toBe('received');
  });

  it('throws with status + error message on kernel error response', async () => {
    mockFetch.mockReturnValue(errorResponse(400, { error: 'lotId is required' }));

    await expect(
      confirmDelivery({ lotId: '', commodity: 'eggs', quantity: 6, unit: 'dozen' }, 'att-scott-123'),
    ).rejects.toThrow('supply.received failed: 400');
  });
});

// ---------------------------------------------------------------------------
// materializeInferenceSupplyLot (xprize#88)
//
// The inference vocabulary resolver signs a `supply.received` attestation
// on confirm but never creates a real supply-domain lot record. This app-
// side bridge calls `/supply/api/received` itself so `collectRecipientDids()`
// has something to scan. Gated on its own `AGRIFORTRESS_SUPPLY_API_URL` env
// var, independent of `KERNEL_URL`.
// ---------------------------------------------------------------------------

describe('materializeInferenceSupplyLot', () => {
  it('logs a warning and skips the call (returns undefined) when AGRIFORTRESS_SUPPLY_API_URL is unset', async () => {
    delete process.env.AGRIFORTRESS_SUPPLY_API_URL;
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await materializeInferenceSupplyLot(
      { lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' },
      'att-scott-123',
    );

    expect(result).toBeUndefined();
    expect(mockFetchAtUrl).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('AGRIFORTRESS_SUPPLY_API_URL not configured'),
    );

    consoleWarnSpy.mockRestore();
  });

  it('never throws when AGRIFORTRESS_SUPPLY_API_URL is unset — degrades gracefully', async () => {
    delete process.env.AGRIFORTRESS_SUPPLY_API_URL;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      materializeInferenceSupplyLot(
        { lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' },
        'att-scott-123',
      ),
    ).resolves.toBeUndefined();
  });

  it('POSTs to /supply/api/received at the configured AGRIFORTRESS_SUPPLY_API_URL when set', async () => {
    process.env.AGRIFORTRESS_SUPPLY_API_URL = 'https://dev-jin.imajin.ai';
    mockFetchAtUrl.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await materializeInferenceSupplyLot(
      { lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' },
      'att-scott-123',
    );

    expect(mockFetchAtUrl).toHaveBeenCalledOnce();
    const [baseUrl, path, opts, attestationId] = mockFetchAtUrl.mock.calls[0];
    expect(baseUrl).toBe('https://dev-jin.imajin.ai');
    expect(path).toBe('/supply/api/received');
    expect(opts?.method).toBe('POST');
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect(sent.lotId).toBe('lot_abc123');
    expect(sent.commodity).toBe('eggs');
    expect(sent.quantity).toBe(6);
    expect(sent.unit).toBe('dozen');
    expect(attestationId).toBe('att-scott-123');
  });

  it('includes recipientDid when it looks like a real DID', async () => {
    process.env.AGRIFORTRESS_SUPPLY_API_URL = 'https://dev-jin.imajin.ai';
    mockFetchAtUrl.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await materializeInferenceSupplyLot(
      {
        lotId: 'lot_abc123',
        commodity: 'eggs',
        quantity: 6,
        unit: 'dozen',
        recipientDid: 'did:imajin:david',
      },
      'att-scott-123',
    );

    const [, , opts] = mockFetchAtUrl.mock.calls[0];
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect(sent.recipientDid).toBe('did:imajin:david');
  });

  it('omits recipientDid when it does not look like a DID (e.g. a free-text name)', async () => {
    process.env.AGRIFORTRESS_SUPPLY_API_URL = 'https://dev-jin.imajin.ai';
    mockFetchAtUrl.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await materializeInferenceSupplyLot(
      {
        lotId: 'lot_abc123',
        commodity: 'eggs',
        quantity: 6,
        unit: 'dozen',
        recipientDid: 'Grace Harbour Farms',
      },
      'att-scott-123',
    );

    const [, , opts] = mockFetchAtUrl.mock.calls[0];
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect('recipientDid' in sent).toBe(false);
  });

  it('returns the parsed SupplyStageResponse on success', async () => {
    process.env.AGRIFORTRESS_SUPPLY_API_URL = 'https://dev-jin.imajin.ai';
    mockFetchAtUrl.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    const result = await materializeInferenceSupplyLot(
      { lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' },
      'att-scott-123',
    );

    expect(result).toEqual(RECEIVED_RESPONSE);
  });

  it('throws with status + error message on a kernel error response', async () => {
    process.env.AGRIFORTRESS_SUPPLY_API_URL = 'https://dev-jin.imajin.ai';
    mockFetchAtUrl.mockReturnValue(errorResponse(400, { error: 'lotId is required' }));

    await expect(
      materializeInferenceSupplyLot(
        { lotId: '', commodity: 'eggs', quantity: 6, unit: 'dozen' },
        'att-scott-123',
      ),
    ).rejects.toThrow('supply.received (inference bridge) failed: 400');
  });
});

// ---------------------------------------------------------------------------
// collectRecipientDids (xprize#59)
//
// Best-effort "active on AgriFortress" signal, scanned from already-fetched
// lot chains. See the doc comment on the function itself for why this is a
// heuristic (no authoritative kernel query exists) rather than a guarantee.
// ---------------------------------------------------------------------------

describe('collectRecipientDids', () => {
  function chainWithPayloads(...payloads: unknown[]): LotChain {
    return {
      lot: { correlationId: 'lot_x', originatingDid: 'did:imajin:scott', commodity: 'eggs', status: 'received', createdAt: '2026-01-01T00:00:00Z' },
      stages: payloads.map((payload, i) => ({
        stage: `stage_${i}`,
        actorDid: 'did:imajin:scott',
        attestationCid: null,
        priorCid: null,
        payload,
        createdAt: '2026-01-01T00:00:00Z',
      })),
    };
  }

  it('collects a recipientDid found on a stage payload', () => {
    const chain = chainWithPayloads({ recipientDid: 'did:imajin:david' });
    expect(collectRecipientDids([chain])).toEqual(new Set(['did:imajin:david']));
  });

  it('falls back to a "recipient" field when recipientDid is absent', () => {
    const chain = chainWithPayloads({ recipient: 'did:imajin:grace' });
    expect(collectRecipientDids([chain])).toEqual(new Set(['did:imajin:grace']));
  });

  it('prefers recipientDid over recipient when both are present', () => {
    const chain = chainWithPayloads({ recipientDid: 'did:imajin:david', recipient: 'did:imajin:grace' });
    expect(collectRecipientDids([chain])).toEqual(new Set(['did:imajin:david']));
  });

  it('collects DIDs across multiple stages and multiple chains', () => {
    const chainA = chainWithPayloads({ recipientDid: 'did:imajin:david' }, { commodity: 'eggs' });
    const chainB = chainWithPayloads({ recipientDid: 'did:imajin:grace' });
    expect(collectRecipientDids([chainA, chainB])).toEqual(new Set(['did:imajin:david', 'did:imajin:grace']));
  });

  it('ignores stages with no recipient field', () => {
    const chain = chainWithPayloads({ commodity: 'eggs', quantity: 6, unit: 'dozen' });
    expect(collectRecipientDids([chain])).toEqual(new Set());
  });

  it('ignores non-object payloads', () => {
    const chain = chainWithPayloads(null, 'a string payload', 42);
    expect(collectRecipientDids([chain])).toEqual(new Set());
  });

  it('returns an empty set for an empty chain list', () => {
    expect(collectRecipientDids([])).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// getLotChain
// ---------------------------------------------------------------------------

describe('getLotChain', () => {
  it('GETs /supply/api/lot/{correlationId}, passing attestationId to fetchKernel', async () => {
    mockFetch.mockReturnValue(okResponse(LOT_CHAIN_RESPONSE));

    await getLotChain('lot_abc123', 'att-scott-123');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [path, opts, attestationId] = mockFetch.mock.calls[0];
    expect(path).toBe('/supply/api/lot/lot_abc123');
    expect(opts?.method).toBe('GET');
    expect(attestationId).toBe('att-scott-123');
  });

  it('URL-encodes the correlationId in the path', async () => {
    mockFetch.mockReturnValue(okResponse(LOT_CHAIN_RESPONSE));

    await getLotChain('lot/with/slashes', 'att-scott-123');

    const [path] = mockFetch.mock.calls[0];
    expect(path).toBe('/supply/api/lot/lot%2Fwith%2Fslashes');
  });

  it('returns the parsed LotChain on success', async () => {
    mockFetch.mockReturnValue(okResponse(LOT_CHAIN_RESPONSE));

    const result = await getLotChain('lot_abc123', 'att-scott-123');

    expect(result.lot.correlationId).toBe('lot_abc123');
    expect(result.lot.commodity).toBe('eggs');
    expect(result.stages).toHaveLength(2);
    expect(result.stages[1].stage).toBe('received');
  });

  it('throws with status + error message on a 404 response', async () => {
    mockFetch.mockReturnValue(errorResponse(404, { error: 'lot not found' }));

    await expect(getLotChain('lot_missing', 'att-scott-123')).rejects.toThrow(
      'supply.lot.read failed: 404',
    );
  });

  it('throws with statusText when the error body is not parseable', async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      } as Response),
    );

    await expect(getLotChain('lot_abc123', 'att-scott-123')).rejects.toThrow(
      'supply.lot.read failed: 500 Internal Server Error',
    );
  });
});

// ---------------------------------------------------------------------------
// resolveActiveRecipientDids (xprize#75) — a thin fetch-chains-then-scan
// wrapper around collectRecipientDids, reused by delivery resend/reminders.
// ---------------------------------------------------------------------------

describe('resolveActiveRecipientDids', () => {
  it('fetches recent lots, their chains, and returns collectRecipientDids over them', async () => {
    mockFetch
      .mockReturnValueOnce(okResponse(RECENT_LOTS_RESPONSE))
      .mockReturnValueOnce(okResponse(LOT_CHAIN_RESPONSE));

    const result = await resolveActiveRecipientDids('did:imajin:scott', 'att-scott-123');

    expect(result).toEqual(new Set(['Grace Harbour Farms']));
  });

  it('passes a custom limit through to recentLots', async () => {
    mockFetch.mockReturnValue(okResponse({ lots: [] }));

    await resolveActiveRecipientDids('did:imajin:scott', 'att-scott-123', 5);

    const [path] = mockFetch.mock.calls[0];
    expect(path).toContain('limit=5');
  });

  it('returns an empty set when the supplier has no recent lots', async () => {
    mockFetch.mockReturnValue(okResponse({ lots: [] }));

    const result = await resolveActiveRecipientDids('did:imajin:scott', 'att-scott-123');

    expect(result).toEqual(new Set());
  });

  it('fails open (empty set) when recentLots itself throws', async () => {
    mockFetch.mockReturnValue(errorResponse(500, { error: 'boom' }));

    const result = await resolveActiveRecipientDids('did:imajin:scott', 'att-scott-123');

    expect(result).toEqual(new Set());
  });

  it('omits a lot from the scan (non-fatal) when its chain fetch fails', async () => {
    mockFetch
      .mockReturnValueOnce(okResponse(RECENT_LOTS_RESPONSE))
      .mockReturnValueOnce(errorResponse(500, { error: 'boom' }));

    const result = await resolveActiveRecipientDids('did:imajin:scott', 'att-scott-123');

    expect(result).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// getLotChainAsSelf (xprize#68) — the webhook-triggered read path, using the
// app's own session-less service credential instead of a borrowed
// attestation. Mocked at the fetchKernelAsSelf HTTP boundary, same as every
// other client function in this file.
// ---------------------------------------------------------------------------

describe('getLotChainAsSelf', () => {
  it('GETs /supply/api/lot/{correlationId} via fetchKernelAsSelf, never fetchKernel', async () => {
    mockFetchAsSelf.mockReturnValue(okResponse(LOT_CHAIN_RESPONSE));

    await getLotChainAsSelf('lot_abc123');

    expect(mockFetchAsSelf).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
    const [path, opts] = mockFetchAsSelf.mock.calls[0];
    expect(path).toBe('/supply/api/lot/lot_abc123');
    expect(opts?.method).toBe('GET');
  });

  it('URL-encodes the correlationId in the path', async () => {
    mockFetchAsSelf.mockReturnValue(okResponse(LOT_CHAIN_RESPONSE));

    await getLotChainAsSelf('lot/with/slashes');

    const [path] = mockFetchAsSelf.mock.calls[0];
    expect(path).toBe('/supply/api/lot/lot%2Fwith%2Fslashes');
  });

  it('returns the parsed LotChain on success', async () => {
    mockFetchAsSelf.mockReturnValue(okResponse(LOT_CHAIN_RESPONSE));

    const result = await getLotChainAsSelf('lot_abc123');

    expect(result.lot.correlationId).toBe('lot_abc123');
    expect(result.lot.commodity).toBe('eggs');
    expect(result.stages).toHaveLength(2);
  });

  it('throws with status + error message on a kernel error response (e.g. out-of-scope service token)', async () => {
    mockFetchAsSelf.mockReturnValue(errorResponse(403, { error: 'insufficient scope' }));

    await expect(getLotChainAsSelf('lot_abc123')).rejects.toThrow(
      'supply.lot.read failed: 403',
    );
  });

  it('propagates a service-token mint failure (fetchKernelAsSelf rejects before any response exists)', async () => {
    mockFetchAsSelf.mockRejectedValue(new Error('Token mint failed: 401 Invalid proof-of-possession signature'));

    await expect(getLotChainAsSelf('lot_abc123')).rejects.toThrow('Token mint failed');
  });

  it('throws with statusText when the error body is not parseable', async () => {
    mockFetchAsSelf.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      } as Response),
    );

    await expect(getLotChainAsSelf('lot_abc123')).rejects.toThrow(
      'supply.lot.read failed: 500 Internal Server Error',
    );
  });
});
