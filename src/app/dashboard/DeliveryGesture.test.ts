import { describe, it, expect } from 'vitest';
import {
  buildEditingState,
  getReceiptUrl,
  InferenceDebugPanel,
  resolveDeliveryFields,
  resolveRecipientDid,
  resolveCaptureOutcome,
  type CaptureResponse,
} from './DeliveryGesture';
import type { RecentLot } from '@/lib/supply';
import type { ConnectionEntry } from '@/lib/kernel/identity';

// ---------------------------------------------------------------------------
// resolveDeliveryFields
//
// Pure helper that merges Gemini inference metadata with the supplier's most
// recent lot (a fallback prior). Inference wins when present; priorLot.commodity
// seeds the product field only when inference returned nothing.
// ---------------------------------------------------------------------------

const RECENT_LOT: RecentLot = {
  correlationId: 'lot_abc123',
  originatingDid: 'did:imajin:scott',
  commodity: 'eggs',
  status: 'received',
  createdAt: '2026-01-01T00:00:00Z',
};

const CONNECTIONS: ConnectionEntry[] = [
  { did: 'did:imajin:grace', handle: 'graceharbour', name: 'Grace Harbour Farms', nickname: null, connectedAt: '2026-01-01T00:00:00Z' },
  { did: 'did:imajin:david', handle: 'david', name: 'David Ko', nickname: 'David', connectedAt: '2026-01-02T00:00:00Z' },
];

// ---------------------------------------------------------------------------
// resolveRecipientDid (xprize#55)
//
// The Recipient field is a native <select> over trust-graph connections, not
// free text — it can only hold a DID that is actually one of the options.
// ---------------------------------------------------------------------------

describe('resolveRecipientDid', () => {
  it('returns \'\' when the raw recipient is undefined', () => {
    expect(resolveRecipientDid(undefined, CONNECTIONS)).toBe('');
  });

  it('returns \'\' when the raw recipient is an empty string', () => {
    expect(resolveRecipientDid('', CONNECTIONS)).toBe('');
  });

  it('resolves a name that matches a connection\'s name to that connection\'s DID', () => {
    expect(resolveRecipientDid('Grace Harbour Farms', CONNECTIONS)).toBe('did:imajin:grace');
  });

  it('resolves a name that matches a connection\'s nickname (case-insensitive)', () => {
    expect(resolveRecipientDid('david', CONNECTIONS)).toBe('did:imajin:david');
  });

  it('resolves a name that matches a connection\'s handle', () => {
    expect(resolveRecipientDid('graceharbour', CONNECTIONS)).toBe('did:imajin:grace');
  });

  it('passes through an exact DID that is already one of the connections', () => {
    expect(resolveRecipientDid('did:imajin:david', CONNECTIONS)).toBe('did:imajin:david');
  });

  it('returns \'\' for a DID-shaped string that is not in the connections list', () => {
    expect(resolveRecipientDid('did:imajin:unknown', CONNECTIONS)).toBe('');
  });

  it('returns \'\' for a name with no matching connection (no free-text fallback, per Ryan\'s correction on #55)', () => {
    expect(resolveRecipientDid('Someone Else', CONNECTIONS)).toBe('');
  });

  it('returns \'\' when there are no connections at all', () => {
    expect(resolveRecipientDid('Grace Harbour Farms', [])).toBe('');
  });
});

describe('resolveDeliveryFields', () => {
  it('uses inference product when present (inference wins over prior)', () => {
    const fields = resolveDeliveryFields({ product: 'apples' }, RECENT_LOT);
    expect(fields.product).toBe('apples');
  });

  it('falls back to priorLot.commodity when inference returned no product', () => {
    const fields = resolveDeliveryFields({}, RECENT_LOT);
    expect(fields.product).toBe('eggs');
  });

  it('returns empty string for product when priorLot.commodity is null', () => {
    const lotNullCommodity: RecentLot = { ...RECENT_LOT, commodity: null };
    const fields = resolveDeliveryFields({}, lotNullCommodity);
    expect(fields.product).toBe('');
  });

  it('returns empty string for product when no inference and no priorLot', () => {
    const fields = resolveDeliveryFields({}, undefined);
    expect(fields.product).toBe('');
  });

  it('converts numeric qty from inference to a string', () => {
    const fields = resolveDeliveryFields({ qty: 6 }, undefined);
    expect(fields.qty).toBe('6');
  });

  it('leaves qty blank when inference returned no qty', () => {
    const fields = resolveDeliveryFields({}, RECENT_LOT);
    expect(fields.qty).toBe('');
  });

  it('maps unit, lot, and notes from inference metadata', () => {
    const fields = resolveDeliveryFields(
      { unit: 'dozen', recipient: 'Grace Harbour Farms', lot: 'L1', notes: 'fresh' },
      undefined,
    );
    expect(fields.unit).toBe('dozen');
    expect(fields.lot).toBe('L1');
    expect(fields.notes).toBe('fresh');
  });

  it('resolves an inferred recipient name to its matching connection DID (xprize#55)', () => {
    const fields = resolveDeliveryFields({ recipient: 'Grace Harbour Farms' }, undefined, CONNECTIONS);
    expect(fields.recipient).toBe('did:imajin:grace');
  });

  it('leaves recipient blank when the inferred name matches no connection', () => {
    const fields = resolveDeliveryFields({ recipient: 'Grace Harbour' }, undefined, CONNECTIONS);
    expect(fields.recipient).toBe('');
  });

  it('leaves recipient blank when no connections are supplied (defaults to [])', () => {
    const fields = resolveDeliveryFields({ recipient: 'Grace Harbour Farms' }, undefined);
    expect(fields.recipient).toBe('');
  });
});

describe('getReceiptUrl', () => {
  it('returns the dashboard receipt URL when externalId is present', () => {
    const url = getReceiptUrl('lot_abc123');
    expect(url).toBe('/dashboard?lot=lot_abc123');
  });

  it('URL-encodes the externalId in the query string', () => {
    const url = getReceiptUrl('lot/with slashes');
    expect(url).toBe('/dashboard?lot=lot%2Fwith%20slashes');
  });

  it('returns null when externalId is undefined (fallback to inline attestationId panel)', () => {
    expect(getReceiptUrl(undefined)).toBeNull();
  });

  it('returns null when externalId is an empty string (kernel returned no lot id)', () => {
    expect(getReceiptUrl('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildEditingState
//
// The full inference capture response is retained verbatim in state so the
// Inference Debug panel can always show what inference produced — never
// discarded after only the first candidate's fields are extracted (#49).
// ---------------------------------------------------------------------------

const CAPTURE_RESPONSE: CaptureResponse = {
  sessionId: 'sess-1',
  assetId: 'asset-1',
  status: 'pending_confirm',
  candidateIntents: [
    { intentType: 'supply.received', metadata: { product: 'eggs', qty: 6 }, confidence: 0.9 },
  ],
};

describe('buildEditingState', () => {
  it('stores the full capture response in captureResponse', () => {
    const state = buildEditingState(CAPTURE_RESPONSE, undefined);
    expect(state.captureResponse).toBe(CAPTURE_RESPONSE);
  });

  it('sets phase to editing and carries over the sessionId', () => {
    const state = buildEditingState(CAPTURE_RESPONSE, undefined);
    expect(state.phase).toBe('editing');
    expect(state.sessionId).toBe('sess-1');
  });

  it('pre-fills fields from the first candidate intent metadata', () => {
    const state = buildEditingState(CAPTURE_RESPONSE, undefined);
    expect(state.fields?.product).toBe('eggs');
    expect(state.fields?.qty).toBe('6');
  });

  it('retains captureResponse even when there are no candidate intents (e.g. a failed inference)', () => {
    const failed: CaptureResponse = { sessionId: 'sess-2', assetId: 'asset-2', status: 'failed' };
    const state = buildEditingState(failed, undefined);
    expect(state.captureResponse).toBe(failed);
    expect(state.fields?.product).toBe('');
  });
});

// ---------------------------------------------------------------------------
// InferenceDebugPanel
//
// Always-visible debug section (never collapsed, hidden, or removed —
// AGENTS.md constraint from #49). Shows every candidate intent, not just
// the first, each with its confidence and full metadata.
// ---------------------------------------------------------------------------

function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (typeof node === 'object' && 'type' in node) {
    const element = node as { type: unknown; props?: { children?: unknown } };
    // Nested function components (e.g. CandidateIntentDebug) are never actually
    // invoked by JSX/React.createElement — render one level deeper ourselves so
    // their output is visible to the assertions below.
    if (typeof element.type === 'function') {
      return collectText((element.type as (props: unknown) => unknown)(element.props));
    }
    return collectText(element.props?.children);
  }
  return [];
}

function textOf(node: unknown): string {
  // No separator: sibling text nodes (e.g. a number and a literal '%') must
  // concatenate exactly as they render, e.g. "90%" not "90 %".
  return collectText(node).join('');
}

describe('InferenceDebugPanel', () => {
  it('renders nothing when there is no capture response', () => {
    expect(InferenceDebugPanel({ captureResponse: undefined })).toBeNull();
  });

  it('shows the session id, status, and asset id', () => {
    const text = textOf(
      InferenceDebugPanel({
        captureResponse: { sessionId: 'sess-1', assetId: 'asset-1', status: 'pending_confirm' },
      }),
    );
    expect(text).toContain('sess-1');
    expect(text).toContain('pending_confirm');
    expect(text).toContain('asset-1');
  });

  it('shows "No candidates returned." when candidateIntents is an empty array', () => {
    const text = textOf(
      InferenceDebugPanel({
        captureResponse: {
          sessionId: 'sess-1',
          assetId: 'asset-1',
          status: 'pending_confirm',
          candidateIntents: [],
        },
      }),
    );
    expect(text).toContain('No candidates returned.');
  });

  it('shows "No candidates returned." when candidateIntents is absent (e.g. a failed inference)', () => {
    const text = textOf(
      InferenceDebugPanel({
        captureResponse: { sessionId: 'sess-1', assetId: 'asset-1', status: 'failed' },
      }),
    );
    expect(text).toContain('No candidates returned.');
  });

  it('renders every candidate intent (not just the first) with confidence as a percentage and full metadata', () => {
    const text = textOf(
      InferenceDebugPanel({
        captureResponse: {
          sessionId: 'sess-1',
          assetId: 'asset-1',
          status: 'pending_confirm',
          candidateIntents: [
            { intentType: 'supply.received', metadata: { product: 'eggs' }, confidence: 0.9 },
            { intentType: 'delivery.noted', metadata: { notes: 'left at gate' }, confidence: 0.42 },
          ],
        },
      }),
    );
    expect(text).toContain('supply.received');
    expect(text).toContain('90%');
    expect(text).toContain('delivery.noted');
    expect(text).toContain('42%');
    expect(text).toContain('eggs');
    expect(text).toContain('left at gate');
  });
});

// ---------------------------------------------------------------------------
// resolveCaptureOutcome (xprize#48)
//
// The kernel returns HTTP 200 even for a pipeline-level failure (zero
// candidate intents parsed); `sendCapture` must key off `capture.status`,
// not `res.ok`, to avoid landing on a blank, unexplained delivery card.
// ---------------------------------------------------------------------------

describe('resolveCaptureOutcome', () => {
  it('returns an error outcome when status is "failed", using the kernel-provided message', () => {
    const outcome = resolveCaptureOutcome(
      { sessionId: 's1', status: 'failed', error: 'No candidate intents inferred' },
      undefined,
    );
    expect(outcome).toEqual({ kind: 'error', errorMessage: 'No candidate intents inferred' });
  });

  it('falls back to a default message when status is "failed" but no error string is provided', () => {
    const outcome = resolveCaptureOutcome({ sessionId: 's1', status: 'failed' }, undefined);
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.errorMessage).toMatch(/try again or fill in manually/i);
    }
  });

  it('returns an editing outcome with a notice when candidateIntents is empty and there is no prior lot', () => {
    const outcome = resolveCaptureOutcome(
      { sessionId: 's1', status: 'ok', candidateIntents: [] },
      undefined,
    );
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.notice).toBeDefined();
      expect(outcome.fields.product).toBe('');
    }
  });

  it('returns an editing outcome with a notice when candidateIntents is absent entirely and there is no prior lot', () => {
    const outcome = resolveCaptureOutcome({ sessionId: 's1', status: 'ok' }, undefined);
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.notice).toBeDefined();
    }
  });

  it('does not show a notice when a prior lot can seed the fields, even with no inferred metadata', () => {
    const outcome = resolveCaptureOutcome(
      { sessionId: 's1', status: 'ok', candidateIntents: [] },
      RECENT_LOT,
    );
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.notice).toBeUndefined();
      expect(outcome.fields.product).toBe('eggs');
    }
  });

  it('returns a plain editing outcome with no notice on a successful parse', () => {
    const outcome = resolveCaptureOutcome(
      {
        sessionId: 's1',
        status: 'ok',
        candidateIntents: [
          { intentType: 'delivery', metadata: { product: 'eggs', qty: 6, recipient: 'David' } },
        ],
      },
      undefined,
    );
    expect(outcome).toEqual({
      kind: 'editing',
      fields: { product: 'eggs', qty: '6', unit: '', recipient: '', lot: '', notes: '' },
    });
  });

  it('resolves the inferred recipient name to a connection DID when connections are supplied (xprize#55)', () => {
    const outcome = resolveCaptureOutcome(
      {
        sessionId: 's1',
        status: 'ok',
        candidateIntents: [
          { intentType: 'delivery', metadata: { product: 'eggs', qty: 6, recipient: 'David' } },
        ],
      },
      undefined,
      CONNECTIONS,
    );
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.fields.recipient).toBe('did:imajin:david');
    }
  });
});
