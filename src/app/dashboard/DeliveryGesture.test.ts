import { describe, it, expect } from 'vitest';
import {
  applyNotesPriceFallback,
  buildEditingState,
  emailInviteNotice,
  extractPriceFromNotes,
  getReceiptUrl,
  hasRecipient,
  InferenceDebugPanel,
  inviteNoticeForRecipient,
  inviteStatusViewModel,
  isInvitingByEmail,
  isRecipientPendingInvite,
  noActiveConnectionsNotice,
  resolveHeaderFields,
  resolveLines,
  resolveRecipientDid,
  resolveCaptureOutcome,
  type CaptureResponse,
  type DeliveryHeaderFields,
} from './DeliveryGesture';
import {
  createEmptyLine,
  parseCents,
  parseUnitPriceScaled,
  UNIT_PRICE_SCALE,
  type DeliveryLineDraft,
} from '@/lib/deliveryLines';
import type { RecentLot } from '@/lib/supply';
import type { ConnectionEntry } from '@/lib/kernel/identity';

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

// ---------------------------------------------------------------------------
// resolveHeaderFields
// ---------------------------------------------------------------------------

describe('resolveHeaderFields', () => {
  it('maps lot and notes from inference metadata', () => {
    const header = resolveHeaderFields({ lot: 'L1', notes: 'fresh' });
    expect(header.lot).toBe('L1');
    expect(header.notes).toBe('fresh');
  });

  it('defaults lot/notes to empty strings when absent', () => {
    const header = resolveHeaderFields({});
    expect(header.lot).toBe('');
    expect(header.notes).toBe('');
  });

  it('resolves an inferred recipient name to its matching connection DID (xprize#55)', () => {
    const header = resolveHeaderFields({ recipient: 'Grace Harbour Farms' }, CONNECTIONS);
    expect(header.recipient).toBe('did:imajin:grace');
  });

  it('leaves recipient blank when no connections are supplied (defaults to [])', () => {
    const header = resolveHeaderFields({ recipient: 'Grace Harbour Farms' });
    expect(header.recipient).toBe('');
  });
});

// ---------------------------------------------------------------------------
// resolveLines (xprize#56)
// ---------------------------------------------------------------------------

describe('resolveLines', () => {
  it('maps the new lines[] shape to one draft per line', () => {
    const lines = resolveLines(
      { lines: [{ product: 'eggs', qty: 40, unit: 'each' }, { product: 'chickens', qty: 20, unit: 'each' }] },
      undefined,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].product.label).toBe('eggs');
    expect(lines[0].qty).toBe('40');
    expect(lines[1].product.label).toBe('chickens');
    expect(lines[1].qty).toBe('20');
  });

  it('derives total for a line when the inferred line carries a unitPrice', () => {
    const lines = resolveLines({ lines: [{ product: 'eggs', qty: 6, unit: 'dozen', unitPrice: 2 }] }, undefined);
    expect(lines[0].unitPrice).toBe('2');
    expect(lines[0].total).toBe('12.00');
  });

  it('falls back to the legacy single-product shape when lines is absent (backward compatibility)', () => {
    const lines = resolveLines({ product: 'eggs', qty: 6, unit: 'dozen' }, undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0].product.label).toBe('eggs');
    expect(lines[0].qty).toBe('6');
    expect(lines[0].unit).toBe('dozen');
  });

  it('falls back to the legacy shape when lines is an empty array', () => {
    const lines = resolveLines({ lines: [], product: 'eggs', qty: 6, unit: 'dozen' }, undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0].product.label).toBe('eggs');
  });

  it('seeds the legacy product from priorLot.commodity when inference returned nothing', () => {
    const lines = resolveLines({}, RECENT_LOT);
    expect(lines).toHaveLength(1);
    expect(lines[0].product.label).toBe('eggs');
  });

  it('starts with a single empty line when there is no inference and no prior lot', () => {
    const lines = resolveLines({}, undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0].product.label).toBe('');
    expect(lines[0].qty).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractPriceFromNotes / applyNotesPriceFallback (xprize#58)
//
// The kernel-side inference vocabulary doesn't yet extract structured price
// fields (see ima-jin/imajin-ai
// apps/kernel/src/lib/inference/vocabulary/agrifortress.ts), so a mentioned
// price gets text-shunted into the free-text notes field instead of the
// line's money fields. This fallback recovers it on the app side.
// ---------------------------------------------------------------------------

describe('extractPriceFromNotes', () => {
  it('extracts a lump-sum total from "price: $5" (the exact xprize#58 repro text) with no per-unit hint', () => {
    const extracted = extractPriceFromNotes('price: $5');
    expect(extracted).not.toBeNull();
    expect(extracted?.dollars).toBe(5);
    expect(extracted?.priceBasis).toBe('total');
    expect(extracted?.remainder).toBe('');
  });

  it('extracts a per-unit price from text carrying an "at" hint', () => {
    const extracted = extractPriceFromNotes('at $0.50');
    expect(extracted).not.toBeNull();
    expect(extracted?.dollars).toBe(0.5);
    expect(extracted?.priceBasis).toBe('per_unit');
    expect(extracted?.remainder).toBe('');
  });

  it('extracts a per-unit price from an "each" hint after the amount', () => {
    const extracted = extractPriceFromNotes('$0.50 each');
    expect(extracted).not.toBeNull();
    expect(extracted?.priceBasis).toBe('per_unit');
  });

  it('preserves genuinely unstructured remainder text around the price, stripping only the price label', () => {
    const extracted = extractPriceFromNotes('left at gate, price: $5');
    expect(extracted?.dollars).toBe(5);
    expect(extracted?.priceBasis).toBe('total');
    expect(extracted?.remainder).toBe('left at gate');
  });

  it('does not misclassify priceBasis from an unrelated "at" earlier in a longer note', () => {
    // The "at" in "left at gate" is unrelated to the price -- only the word
    // immediately adjacent to the amount ("price:") should be consulted.
    const extracted = extractPriceFromNotes('left at gate, price: $5');
    expect(extracted?.priceBasis).toBe('total');
  });

  it('returns null when there is no dollar amount in the text', () => {
    expect(extractPriceFromNotes('left at gate')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(extractPriceFromNotes('')).toBeNull();
  });
});

function singleLine(overrides: Partial<DeliveryLineDraft> = {}): DeliveryLineDraft {
  return { ...createEmptyLine(), product: { label: 'eggs' }, unit: 'units', qty: '12', ...overrides };
}

describe('applyNotesPriceFallback', () => {
  it('recovers a lump-sum total from notes: "12 eggs for $5" repro -> total $5.00 (manifest), priceBasis total, notes emptied', () => {
    const header: DeliveryHeaderFields = { recipient: '', lot: '', notes: 'price: $5' };
    const result = applyNotesPriceFallback(header, [singleLine()]);
    expect(parseCents(result.lines[0].total)).toBe(500); // -> manifest shows $5.00
    expect(result.lines[0].priceBasis).toBe('total');
    expect(result.header.notes).toBe('');
  });

  it('recovers a per-unit price from notes: "12 eggs at $0.50" -> unitPrice $0.50, total $6.00, priceBasis per_unit', () => {
    const header: DeliveryHeaderFields = { recipient: '', lot: '', notes: 'at $0.50' };
    const result = applyNotesPriceFallback(header, [singleLine()]);
    expect(parseUnitPriceScaled(result.lines[0].unitPrice)).toBe(50 * UNIT_PRICE_SCALE);
    expect(result.lines[0].total).toBe('6.00');
    expect(result.lines[0].priceBasis).toBe('per_unit');
    expect(result.header.notes).toBe('');
  });

  it('does nothing when notes has no price mention (no-price gesture regression)', () => {
    const header: DeliveryHeaderFields = { recipient: '', lot: '', notes: 'left at gate' };
    const result = applyNotesPriceFallback(header, [singleLine()]);
    expect(result.lines[0].total).toBe('');
    expect(result.lines[0].unitPrice).toBe('');
    expect(result.header.notes).toBe('left at gate');
  });

  it('does not override a line whose money fields are already structured', () => {
    const header: DeliveryHeaderFields = { recipient: '', lot: '', notes: 'price: $99' };
    const already = singleLine({ unitPrice: '1.00', total: '12.00', priceBasis: 'per_unit' as const });
    const result = applyNotesPriceFallback(header, [already]);
    expect(result.lines[0].total).toBe('12.00');
    expect(result.header.notes).toBe('price: $99');
  });

  it('does not attempt extraction across multiple lines (ambiguous attribution)', () => {
    const header: DeliveryHeaderFields = { recipient: '', lot: '', notes: 'price: $5' };
    const lines = [singleLine(), singleLine({ product: { label: 'chickens' } })];
    const result = applyNotesPriceFallback(header, lines);
    expect(result.lines[0].total).toBe('');
    expect(result.lines[1].total).toBe('');
    expect(result.header.notes).toBe('price: $5');
  });
});

// ---------------------------------------------------------------------------
// isRecipientPendingInvite / inviteNoticeForRecipient / noActiveConnectionsNotice (xprize#59)
// ---------------------------------------------------------------------------

describe('isRecipientPendingInvite', () => {
  it('is false when no recipient is selected', () => {
    expect(isRecipientPendingInvite('', new Set(['did:imajin:david']))).toBe(false);
  });

  it('is false when the selected recipient is in the active set', () => {
    expect(isRecipientPendingInvite('did:imajin:david', new Set(['did:imajin:david']))).toBe(false);
  });

  it('is true when the selected recipient is not in the active set (never been active on AgriFortress)', () => {
    expect(isRecipientPendingInvite('did:imajin:grace', new Set(['did:imajin:david']))).toBe(true);
  });

  it('is true when the active set is empty', () => {
    expect(isRecipientPendingInvite('did:imajin:grace', new Set())).toBe(true);
  });
});

describe('inviteNoticeForRecipient', () => {
  it('returns undefined when no recipient is selected', () => {
    expect(inviteNoticeForRecipient('', new Set())).toBeUndefined();
  });

  it('returns undefined when the recipient is already active', () => {
    expect(inviteNoticeForRecipient('did:imajin:david', new Set(['did:imajin:david']))).toBeUndefined();
  });

  it('returns an "invite will be sent" message when the recipient has never been active', () => {
    const notice = inviteNoticeForRecipient('did:imajin:grace', new Set());
    expect(notice).toBeDefined();
    expect(notice).toMatch(/invite/i);
  });
});

describe('noActiveConnectionsNotice', () => {
  it('returns undefined when there are no connections at all (the dedicated empty state handles that case)', () => {
    expect(noActiveConnectionsNotice([], new Set())).toBeUndefined();
  });

  it('returns undefined when at least one connection is active', () => {
    expect(noActiveConnectionsNotice(CONNECTIONS, new Set(['did:imajin:david']))).toBeUndefined();
  });

  it('returns a notice when connections exist but none are active (distinguishes from "no connections at all")', () => {
    const notice = noActiveConnectionsNotice(CONNECTIONS, new Set());
    expect(notice).toBeDefined();
    expect(notice).toMatch(/invite|active/i);
  });
});

// ---------------------------------------------------------------------------
// hasRecipient (xprize#65)
//
// The recipient DID is the delivery attestation's subject — a receipt with no
// subject is unsignable, so the confirm gesture must be gated on it. With an
// empty trust graph the <select> only offers the "No connections yet"
// placeholder and recipient stays ''.
// ---------------------------------------------------------------------------

describe('hasRecipient', () => {
  it('is false when no recipient has been selected (empty trust graph placeholder)', () => {
    expect(hasRecipient({ recipient: '', lot: '', notes: '' })).toBe(false);
  });

  it('is false for a whitespace-only recipient', () => {
    expect(hasRecipient({ recipient: '   ', lot: '', notes: '' })).toBe(false);
  });

  it('is true once a connection DID is selected', () => {
    expect(hasRecipient({ recipient: 'did:imajin:david', lot: '', notes: '' })).toBe(true);
  });

  it('is true when a well-formed recipientEmail is entered instead of a connection (xprize#86)', () => {
    expect(hasRecipient({ recipient: '', lot: '', notes: '', recipientEmail: 'david@graceharbour.farm' })).toBe(true);
  });

  it('is false when recipientEmail is malformed and no connection is selected', () => {
    expect(hasRecipient({ recipient: '', lot: '', notes: '', recipientEmail: 'not-an-email' })).toBe(false);
  });

  it('is false when recipientEmail is absent (backward compatible with pre-xprize#86 literals)', () => {
    expect(hasRecipient({ recipient: '', lot: '', notes: '' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isInvitingByEmail / emailInviteNotice (xprize#86)
// ---------------------------------------------------------------------------

describe('isInvitingByEmail', () => {
  it('is true when recipient is empty and recipientEmail is a well-formed address', () => {
    expect(isInvitingByEmail({ recipient: '', lot: '', notes: '', recipientEmail: 'david@graceharbour.farm' })).toBe(true);
  });

  it('is false when a connection DID is selected, even if recipientEmail also happens to be set', () => {
    expect(
      isInvitingByEmail({
        recipient: 'did:imajin:david',
        lot: '',
        notes: '',
        recipientEmail: 'david@graceharbour.farm',
      }),
    ).toBe(false);
  });

  it('is false when recipientEmail is malformed', () => {
    expect(isInvitingByEmail({ recipient: '', lot: '', notes: '', recipientEmail: 'not-an-email' })).toBe(false);
  });

  it('is false when recipientEmail is absent', () => {
    expect(isInvitingByEmail({ recipient: '', lot: '', notes: '' })).toBe(false);
  });
});

describe('emailInviteNotice', () => {
  it('returns undefined for an undefined email', () => {
    expect(emailInviteNotice(undefined)).toBeUndefined();
  });

  it('returns undefined for a malformed email', () => {
    expect(emailInviteNotice('not-an-email')).toBeUndefined();
  });

  it('returns an "invite will be emailed" notice naming the address for a well-formed email', () => {
    const notice = emailInviteNotice('david@graceharbour.farm');
    expect(notice).toBeDefined();
    expect(notice).toMatch(/emailed/i);
    expect(notice).toContain('david@graceharbour.farm');
  });
});

// ---------------------------------------------------------------------------
// inviteStatusViewModel (xprize#90) — surfaces the kernel's emailSent flag
// (ima-jin/imajin-ai PR #1849) with an always-available invite-link fallback.
// ---------------------------------------------------------------------------

describe('inviteStatusViewModel', () => {
  it('shows the email-sent message and offers the copy link when emailSent is true', () => {
    const result = inviteStatusViewModel({ inviteFailed: false, inviteUrl: 'https://example.com/invite/1', emailSent: true });
    expect(result.shouldShowCopyLink).toBe(true);
    expect(result.message).toMatch(/sent/i);
  });

  it('shows the email-not-sent fallback message and offers the copy link when emailSent is false', () => {
    const result = inviteStatusViewModel({ inviteFailed: false, inviteUrl: 'https://example.com/invite/1', emailSent: false });
    expect(result.shouldShowCopyLink).toBe(true);
    expect(result.message).toMatch(/could not be sent/i);
    expect(result.message).toMatch(/share the invite link manually/i);
  });

  it('still offers the copy link when an invite URL is present but emailSent is unset (link invites)', () => {
    const result = inviteStatusViewModel({ inviteFailed: false, inviteUrl: 'https://example.com/invite/1' });
    expect(result.shouldShowCopyLink).toBe(true);
  });

  it('falls back to the invite-failed message when the whole invite request failed and no URL is available', () => {
    const result = inviteStatusViewModel({ inviteFailed: true });
    expect(result.shouldShowCopyLink).toBe(false);
    expect(result.message).toMatch(/invite could not be sent/i);
  });

  it('shows nothing when there was no invite attempt at all', () => {
    const result = inviteStatusViewModel({ inviteFailed: false });
    expect(result.shouldShowCopyLink).toBe(false);
    expect(result.message).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getReceiptUrl
// ---------------------------------------------------------------------------

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

  it('does not append invite_error when inviteFailed is omitted (default)', () => {
    expect(getReceiptUrl('lot_abc123')).toBe('/dashboard?lot=lot_abc123');
  });

  it('does not append invite_error when inviteFailed is explicitly false', () => {
    expect(getReceiptUrl('lot_abc123', false)).toBe('/dashboard?lot=lot_abc123');
  });

  it('appends invite_error=1 when inviteFailed is true (xprize#77)', () => {
    expect(getReceiptUrl('lot_abc123', true)).toBe('/dashboard?lot=lot_abc123&invite_error=1');
  });

  it('returns null (never a query string) when externalId is absent, regardless of inviteFailed', () => {
    expect(getReceiptUrl(undefined, true)).toBeNull();
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

  it('pre-fills a single line from the legacy candidate intent metadata', () => {
    const state = buildEditingState(CAPTURE_RESPONSE, undefined);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0].product.label).toBe('eggs');
    expect(state.lines[0].qty).toBe('6');
  });

  it('retains captureResponse even when there are no candidate intents (e.g. a failed inference)', () => {
    const failed: CaptureResponse = { sessionId: 'sess-2', assetId: 'asset-2', status: 'failed' };
    const state = buildEditingState(failed, undefined);
    expect(state.captureResponse).toBe(failed);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0].product.label).toBe('');
  });

  it('pre-fills multiple lines from a multi-line candidate (xprize#56)', () => {
    const multiLine: CaptureResponse = {
      sessionId: 'sess-3',
      assetId: 'asset-3',
      status: 'pending_confirm',
      candidateIntents: [
        {
          intentType: 'supply.received',
          metadata: { lines: [{ product: 'eggs', qty: 40 }, { product: 'chickens', qty: 20 }] },
        },
      ],
    };
    const state = buildEditingState(multiLine, undefined);
    expect(state.lines).toHaveLength(2);
    expect(state.lines[0].product.label).toBe('eggs');
    expect(state.lines[1].product.label).toBe('chickens');
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
      { sessionId: 's1', assetId: 'asset-1', status: 'failed', error: 'No candidate intents inferred' },
      undefined,
    );
    expect(outcome).toEqual({ kind: 'error', errorMessage: 'No candidate intents inferred' });
  });

  it('falls back to a default message when status is "failed" but no error string is provided', () => {
    const outcome = resolveCaptureOutcome({ sessionId: 's1', assetId: 'asset-1', status: 'failed' }, undefined);
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.errorMessage).toMatch(/try again or fill in manually/i);
    }
  });

  it('returns an editing outcome with a notice when candidateIntents is empty and there is no prior lot', () => {
    const outcome = resolveCaptureOutcome(
      { sessionId: 's1', assetId: 'asset-1', status: 'ok', candidateIntents: [] },
      undefined,
    );
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.notice).toBeDefined();
      expect(outcome.lines).toHaveLength(1);
      expect(outcome.lines[0].product.label).toBe('');
    }
  });

  it('returns an editing outcome with a notice when candidateIntents is absent entirely and there is no prior lot', () => {
    const outcome = resolveCaptureOutcome({ sessionId: 's1', assetId: 'asset-1', status: 'ok' }, undefined);
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.notice).toBeDefined();
    }
  });

  it('does not show a notice when a prior lot can seed the fields, even with no inferred metadata', () => {
    const outcome = resolveCaptureOutcome(
      { sessionId: 's1', assetId: 'asset-1', status: 'ok', candidateIntents: [] },
      RECENT_LOT,
    );
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.notice).toBeUndefined();
      expect(outcome.lines[0].product.label).toBe('eggs');
    }
  });

  it('returns a plain editing outcome with no notice on a successful parse', () => {
    const outcome = resolveCaptureOutcome(
      {
        sessionId: 's1',
        assetId: 'asset-1',
        status: 'ok',
        candidateIntents: [
          { intentType: 'delivery', metadata: { product: 'eggs', qty: 6, recipient: 'David' } },
        ],
      },
      undefined,
    );
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.notice).toBeUndefined();
      expect(outcome.header).toEqual({ recipient: '', lot: '', notes: '' });
      expect(outcome.lines).toHaveLength(1);
      expect(outcome.lines[0]).toMatchObject({ product: { label: 'eggs' }, qty: '6' });
    }
  });

  it('resolves the inferred recipient name to a connection DID when connections are supplied (xprize#55)', () => {
    const outcome = resolveCaptureOutcome(
      {
        sessionId: 's1',
        assetId: 'asset-1',
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
      expect(outcome.header.recipient).toBe('did:imajin:david');
    }
  });

  it('produces multiple lines from one gesture producing multiple candidate line items (xprize#56)', () => {
    const outcome = resolveCaptureOutcome(
      {
        sessionId: 's1',
        assetId: 'asset-1',
        status: 'ok',
        candidateIntents: [
          {
            intentType: 'supply.received',
            metadata: { lines: [{ product: 'eggs', qty: 40 }, { product: 'chickens', qty: 20 }] },
          },
        ],
      },
      undefined,
    );
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.lines).toHaveLength(2);
      expect(outcome.lines[0].product.label).toBe('eggs');
      expect(outcome.lines[1].product.label).toBe('chickens');
    }
  });
});
