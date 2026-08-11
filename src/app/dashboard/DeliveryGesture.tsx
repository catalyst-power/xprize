'use client';

/**
 * DeliveryGesture — the AgriFortress AI-native delivery input.
 *
 * The card is a packing slip (xprize#56): header (recipient/lot/notes) +
 * 1..n line items (product/qty/unit/unitPrice/total/priceBasis). One
 * confirm/sign by the deliverer covers the whole manifest.
 *
 * Flow:
 *   1. Scott taps "Voice note" → MediaRecorder captures audio
 *      OR taps "Photo" → picks an image from camera/library
 *   2. File is sent to POST /api/inference/capture (server-side; never
 *      direct browser → kernel)
 *   3. candidateIntents[0].metadata pre-fills the header + line items — all
 *      fields fully editable (inference = prior, human = authority; AGENTS.md §4)
 *   4. Scott taps "Confirm delivery" → POST /api/inference/confirm/{sessionId}
 *   5. On success: signed attestationId shown. On failure: honest error —
 *      never a phantom receipt (same discipline as #17).
 *
 * Voice is the primary path. Photo is evidence; the count is never derived
 * from the image — Scott asserts and signs it (AGENTS.md §4).
 */

import { useRef, useState } from 'react';
import type { RecentLot } from '@/lib/supply';
import type {
  CandidateIntent,
  ConfirmIntentBody,
  InferenceCaptureResponse,
  IntentMetadata,
} from '@/lib/inference';
import { connectionLabel, type ConnectionEntry } from '@/lib/kernel/identity';
import {
  applyQtyEdit,
  applyTotalEdit,
  applyUnitPriceEdit,
  createEmptyLine,
  formatCents,
  freezeLine,
  isLineValid,
  legacyFieldsToLine,
  lineTotalLabel,
  manifestGrandTotalCents,
  KNOWN_UNITS,
  type ConfirmedLine,
  type DeliveryLineDraft,
  type PriceBasis,
} from '@/lib/deliveryLines';

// ---------------------------------------------------------------------------
// Types (mirroring kernel spec from issue #5)
// ---------------------------------------------------------------------------

/**
 * The full inference capture response, as returned by POST /api/inference/capture.
 * Aliased from `InferenceCaptureResponse` (src/lib/inference.ts) so the debug
 * panel below always reflects every field the kernel actually returns —
 * never a narrowed local copy (xprize#49).
 *
 * Extended with the optional `error` field that the kernel adds on
 * pipeline-level failures (xprize#48).
 */
export type CaptureResponse = InferenceCaptureResponse & { error?: string };

interface ConfirmResponse {
  sessionId: string;
  status: string;
  attestationId: string;
  /**
   * The `supply.received` lot correlationId — mirrors `InferenceConfirmResponse.externalId`.
   * When present, navigate to `/dashboard?lot={externalId}` to render the signed receipt.
   * When absent (kernel hasn't resolved a supply lot), fall back to the inline attestationId panel.
   */
  externalId?: string;
}

// ---------------------------------------------------------------------------
// Pure helper — exported for testing
// ---------------------------------------------------------------------------

/**
 * Returns the dashboard receipt URL when the confirm response carries a lot
 * correlationId (`externalId`), or `null` to fall back to the inline panel.
 */
export function getReceiptUrl(externalId: string | undefined): string | null {
  if (externalId === undefined || externalId === '') return null;
  return `/dashboard?lot=${encodeURIComponent(externalId)}`;
}

// ---------------------------------------------------------------------------
// Header fields (recipient / lot / notes) — exported for testing
// ---------------------------------------------------------------------------

export interface DeliveryHeaderFields {
  /** The selected connection's DID, or '' when unset — never free text (xprize#55). */
  recipient: string;
  lot: string;
  notes: string;
}

const EMPTY_HEADER_FIELDS: DeliveryHeaderFields = { recipient: '', lot: '', notes: '' };

/**
 * Resolve an inferred recipient string (a free-text name Gemini transcribed,
 * or already a DID) to one of the acting supplier's trust-graph connections.
 *
 * The Recipient field is a native `<select>` over connections (xprize#55,
 * per Ryan's correction on the issue: a native select is preferred over a
 * custom listbox) — it can only hold a DID that is actually one of the
 * options, so an inferred name with no matching connection resolves to ''
 * (no selection) rather than being kept as free text. The raw inferred
 * value is never lost — it's still visible in the always-on Inference Debug
 * panel below (#49).
 */
export function resolveRecipientDid(
  rawRecipient: string | undefined,
  connections: readonly ConnectionEntry[],
): string {
  if (rawRecipient === undefined || rawRecipient === '') return '';

  const byDid = connections.find((connection) => connection.did === rawRecipient);
  if (byDid !== undefined) return byDid.did;

  const normalized = rawRecipient.toLowerCase();
  const byLabel = connections.find((connection) =>
    [connection.nickname, connection.name, connection.handle].some(
      (label) => label !== null && label.toLowerCase() === normalized,
    ),
  );
  return byLabel?.did ?? '';
}

/** Merge Gemini inference metadata's header fields (recipient/lot/notes) — inference is a prior, never authority. */
export function resolveHeaderFields(
  meta: IntentMetadata,
  connections: readonly ConnectionEntry[] = [],
): DeliveryHeaderFields {
  return {
    recipient: resolveRecipientDid(meta.recipient, connections),
    lot: meta.lot ?? '',
    notes: meta.notes ?? '',
  };
}

// ---------------------------------------------------------------------------
// Recipient activity / invite messaging (xprize#59) — exported for testing
//
// The recipient selector is now populated from the supplier's full
// trust-graph connections, including contacts who've never been active on
// AgriFortress before (xprize#59 requirement #1). `activeRecipientDids`
// (best-effort, see `collectRecipientDids` in src/lib/supply.ts) tells us
// which ones have. Naming an inactive one is still allowed — the delivery
// attestation is created pending with them as subject exactly like an
// active recipient (the claimable-stub move the issue describes) — but the
// UI must say so, and confirm must additionally send them an invite.
// ---------------------------------------------------------------------------

/** True when the selected recipient has never been an AgriFortress recipient before (per the best-effort heuristic). */
export function isRecipientPendingInvite(
  recipientDid: string,
  activeRecipientDids: ReadonlySet<string>,
): boolean {
  return recipientDid !== '' && !activeRecipientDids.has(recipientDid);
}

const INVITE_WILL_BE_SENT_MESSAGE =
  "This recipient hasn't used AgriFortress yet \u2014 confirming will send them an invite to countersign this delivery.";

/** "Invite will be sent" notice for the currently selected recipient, or undefined when none is needed. */
export function inviteNoticeForRecipient(
  recipientDid: string,
  activeRecipientDids: ReadonlySet<string>,
): string | undefined {
  return isRecipientPendingInvite(recipientDid, activeRecipientDids) ? INVITE_WILL_BE_SENT_MESSAGE : undefined;
}

const NO_ACTIVE_CONNECTIONS_NOTICE =
  'None of your Imajin connections have used AgriFortress yet \u2014 selecting one will send them an invite.';

/**
 * Distinguishes the two empty states the issue calls out: "no Imajin
 * connections at all" (handled separately by `RecipientSelect`'s own empty
 * state) vs "connections exist but none are active here" (this notice).
 * Returns undefined when there are no connections at all, or when at least
 * one connection is already active.
 */
export function noActiveConnectionsNotice(
  connections: readonly ConnectionEntry[],
  activeRecipientDids: ReadonlySet<string>,
): string | undefined {
  if (connections.length === 0) return undefined;
  const anyActive = connections.some((connection) => activeRecipientDids.has(connection.did));
  return anyActive ? undefined : NO_ACTIVE_CONNECTIONS_NOTICE;
}

// ---------------------------------------------------------------------------
// Line items — exported for testing
// ---------------------------------------------------------------------------

/**
 * Resolve the card's line items from inference metadata (xprize#56).
 *
 * Prefers the `lines` shape (one gesture, N lines). Falls back to the legacy
 * single-product shape (`product`/`qty`/`unit` at the top level, seeded by
 * `priorLot.commodity` when inference returned nothing) mapped to a single
 * line — "keep backward compatibility: a legacy single-product payload maps
 * to lines[0]". When there's truly nothing to prefill, starts with one
 * empty line so the card always has at least one row to fill in.
 */
export function resolveLines(
  meta: IntentMetadata,
  priorLot: RecentLot | undefined,
): DeliveryLineDraft[] {
  if (meta.lines !== undefined && meta.lines.length > 0) {
    return meta.lines.map((line) => legacyFieldsToLine(line));
  }

  const product = meta.product ?? priorLot?.commodity ?? undefined;
  const hasLegacySingle = product !== undefined || meta.qty !== undefined || meta.unit !== undefined;
  if (hasLegacySingle) {
    return [legacyFieldsToLine({ product, qty: meta.qty, unit: meta.unit })];
  }

  return [createEmptyLine()];
}

// ---------------------------------------------------------------------------
// Price-extraction fallback (xprize#58) — exported for testing
//
// The kernel-side inference vocabulary doesn't yet extract structured price
// data at all (see ima-jin/imajin-ai
// apps/kernel/src/lib/inference/vocabulary/agrifortress.ts: the systemPrompt's
// metadata field list has no price fields), so a gesture like "12 eggs for
// $5" gets its price text-shunted into the free-text `notes` field
// ("price: $5") instead of the line's unitPrice/total. This fallback
// recovers it on the app side: when there is exactly one line and its money
// fields are still empty, it looks for a dollar amount in `notes`, guesses
// whether it's a per-unit or lump-sum price from nearby keywords, applies it
// via the same derivation helpers a human edit would use, and strips the
// matched text out of `notes` — notes should only ever keep genuinely
// unstructured remainder (xprize#58 acceptance), never structured money the
// schema already has fields for.
//
// With more than one line there's no reliable way to know which line a lone
// notes-field price belongs to, so it's left alone — still visible in notes,
// still editable by hand.
// ---------------------------------------------------------------------------

const PRICE_AMOUNT_PATTERN = /\$\s*(\d+(?:\.\d{1,4})?)/;
const PER_UNIT_HINT = /\b(at|per|each|apiece|unit)\b/i;
const TOTAL_HINT = /\b(for|total|altogether|sum)\b/i;

interface ExtractedNotesPrice {
  dollars: number;
  priceBasis: PriceBasis;
  remainder: string;
}

/** The single word immediately adjacent to a match, trimmed — '' when there isn't one. */
function adjacentWord(text: string, fromEnd: boolean): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  const words = trimmed.split(/\s+/);
  return fromEnd ? words[words.length - 1] : words[0];
}

/**
 * Find a dollar amount in free text and guess whether it's a per-unit or
 * lump-sum ('total') price from the single word immediately adjacent to it
 * — "at $0.50" / "$0.50 each" reads as per-unit, "for $5" / "price: $5" (no
 * adjacent per-unit word) reads as a lump-sum total, matching the xprize#58
 * acceptance criteria for both phrasings. Only the immediately adjacent word
 * is checked (not the whole note) so an unrelated "at"/"for" earlier in a
 * longer note doesn't misclassify the price. Returns null when no dollar
 * amount is found.
 */
export function extractPriceFromNotes(notes: string): ExtractedNotesPrice | null {
  const match = PRICE_AMOUNT_PATTERN.exec(notes);
  if (match === null) return null;

  const dollars = Number(match[1]);
  if (!Number.isFinite(dollars)) return null;

  const before = notes.slice(0, match.index);
  const after = notes.slice(match.index + match[0].length);

  const context = `${adjacentWord(before, true)} ${adjacentWord(after, false)}`;
  const priceBasis: PriceBasis =
    PER_UNIT_HINT.test(context) && !TOTAL_HINT.test(context) ? 'per_unit' : 'total';

  // Strip a price "label" phrase immediately preceding the amount (e.g.
  // "price:", "cost:", "for", "at") and a unit qualifier immediately
  // following it (e.g. "each", "per unit") along with the amount itself, so
  // notes keeps only genuinely unstructured remainder (xprize#58
  // acceptance) — never the structured price the schema already has fields for.
  const beforeStripped = before.replace(/\b(price|cost|total|for|at)\s*[:-]?\s*$/i, '');
  const afterStripped = after.replace(/^\s*(per\s+\w+|each|apiece)\b/i, '');
  const remainder = (beforeStripped + afterStripped)
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
    .trim();

  return { dollars, priceBasis, remainder };
}

/**
 * Apply the notes price-extraction fallback to a resolved header + lines
 * pair. Only fires for a single-line manifest whose money fields are still
 * blank (i.e. nothing structured already populated them) — see rationale
 * above.
 */
export function applyNotesPriceFallback(
  header: DeliveryHeaderFields,
  lines: readonly DeliveryLineDraft[],
): { header: DeliveryHeaderFields; lines: DeliveryLineDraft[] } {
  if (lines.length !== 1) return { header, lines: [...lines] };

  const [line] = lines;
  if (line.unitPrice.trim() !== '' || line.total.trim() !== '') {
    return { header, lines: [...lines] };
  }

  const extracted = extractPriceFromNotes(header.notes);
  if (extracted === null) return { header, lines: [...lines] };

  const updatedLine =
    extracted.priceBasis === 'per_unit'
      ? applyUnitPriceEdit(line, String(extracted.dollars))
      : applyTotalEdit(line, String(extracted.dollars));

  return {
    header: { ...header, notes: extracted.remainder },
    lines: [updatedLine],
  };
}

const DEFAULT_FAILED_MESSAGE =
  'Could not understand the voice note — try again or fill in manually.';
const ZERO_CANDIDATE_NOTICE =
  "We heard your voice note but couldn't extract details — fill in the fields below.";
const INVALID_LINES_MESSAGE =
  'Each line needs a product, unit, quantity, and consistent pricing before you can confirm.';
const MISSING_RECIPIENT_MESSAGE = 'Select a recipient before confirming.';

/**
 * A delivery receipt is a claim *about* someone — the recipient DID is the
 * attestation's subject. Without one there is nothing to sign against, so the
 * confirm gesture stays disabled until a recipient is chosen (xprize#65).
 */
export function hasRecipient(header: DeliveryHeaderFields): boolean {
  return header.recipient.trim() !== '';
}

type CaptureOutcome =
  | { kind: 'error'; errorMessage: string }
  | {
      kind: 'editing';
      header: DeliveryHeaderFields;
      lines: DeliveryLineDraft[];
      notice?: string;
    };

/**
 * Decide the UI outcome for a capture response, honoring the claim boundary
 * (AGENTS.md §4): a pipeline-level failure (`status === 'failed'`, e.g. zero
 * candidate intents parsed) must surface as an honest error — never a blank
 * card — even though the kernel returns HTTP 200 for it. A parse that
 * succeeded but extracted nothing useful still lets the user edit manually,
 * but with an informational notice rather than silence.
 */
export function resolveCaptureOutcome(
  capture: CaptureResponse,
  priorLot: RecentLot | undefined,
  connections: readonly ConnectionEntry[] = [],
): CaptureOutcome {
  if (capture.status === 'failed') {
    return { kind: 'error', errorMessage: capture.error ?? DEFAULT_FAILED_MESSAGE };
  }

  const meta = capture.candidateIntents?.at(0)?.metadata ?? {};
  const hasAnyMeta = Object.values(meta).some((v) => v !== undefined && v !== '' && v !== null);
  const resolvedHeader = resolveHeaderFields(meta, connections);
  const resolvedLines = resolveLines(meta, priorLot);
  const { header, lines } = applyNotesPriceFallback(resolvedHeader, resolvedLines);

  if (!hasAnyMeta && priorLot === undefined) {
    return { kind: 'editing', header, lines, notice: ZERO_CANDIDATE_NOTICE };
  }

  return { kind: 'editing', header, lines };
}

type Phase = 'idle' | 'recording' | 'capturing' | 'editing' | 'submitting' | 'done' | 'error';

/** A line draft plus a stable React list key, independent of its position (no array-index keys). */
interface KeyedLine {
  key: string;
  draft: DeliveryLineDraft;
}

interface GestureState {
  phase: Phase;
  sessionId?: string;
  header?: DeliveryHeaderFields;
  lines?: KeyedLine[];
  attestationId?: string;
  errorMessage?: string;
  /** The full inference capture response — kept for the always-visible debug panel below (xprize#49). */
  captureResponse?: CaptureResponse;
  /** Informational, non-blocking — shown above the fields in the editing phase. */
  notice?: string;
}

// ---------------------------------------------------------------------------
// Post-capture state builder — exported for testing
// ---------------------------------------------------------------------------

export interface EditingStateSnapshot {
  phase: 'editing';
  sessionId: string;
  header: DeliveryHeaderFields;
  lines: DeliveryLineDraft[];
  captureResponse: CaptureResponse;
}

/**
 * Build the 'editing' snapshot from a successful capture response. The full
 * `capture` response is retained verbatim as `captureResponse` — never
 * discarded — so the Inference Debug panel can always show exactly what
 * inference produced, not just the first candidate's fields (xprize#49).
 */
export function buildEditingState(
  capture: CaptureResponse,
  priorLot: RecentLot | undefined,
  connections: readonly ConnectionEntry[] = [],
): EditingStateSnapshot {
  const meta = capture.candidateIntents?.at(0)?.metadata ?? {};
  const { header, lines } = applyNotesPriceFallback(
    resolveHeaderFields(meta, connections),
    resolveLines(meta, priorLot),
  );
  return {
    phase: 'editing',
    sessionId: capture.sessionId,
    header,
    lines,
    captureResponse: capture,
  };
}

// ---------------------------------------------------------------------------
// Inference debug panel — pure, no hooks; ALWAYS visible while editing or
// submitting. The operator needs MORE information to debug inference, not
// less — never hide, collapse, or drop candidates/fields here (xprize#49).
// ---------------------------------------------------------------------------

function CandidateIntentDebug(props: Readonly<{ intent: CandidateIntent }>) {
  const { intent } = props;
  const confidencePct = Math.round((intent.confidence ?? 0) * 100);

  return (
    <div className="space-y-1 border-t border-zinc-800/40 pt-2 mt-2">
      <div className="flex justify-between">
        <span className="text-zinc-400">{intent.intentType}</span>
        <span className="text-zinc-500">{confidencePct}%</span>
      </div>
      <pre className="text-zinc-600 text-[10px] whitespace-pre-wrap">
        {JSON.stringify(intent.metadata, null, 2)}
      </pre>
    </div>
  );
}

export function InferenceDebugPanel(
  props: Readonly<{ captureResponse: CaptureResponse | undefined }>,
) {
  const { captureResponse } = props;
  if (captureResponse === undefined) return null;

  const candidates = captureResponse.candidateIntents ?? [];

  return (
    <section className="rounded-xl border border-zinc-800/60 p-4 space-y-2">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
        Inference Response
      </p>

      <div className="text-xs font-mono space-y-1">
        <div className="flex justify-between gap-3">
          <span className="text-zinc-500 shrink-0">Session ID</span>
          <span className="text-zinc-300 break-all">{captureResponse.sessionId}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-zinc-500 shrink-0">Status</span>
          <span className="text-zinc-300">{captureResponse.status}</span>
        </div>
        {captureResponse.assetId !== undefined && (
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Asset ID</span>
            <span className="text-zinc-300 break-all">{captureResponse.assetId}</span>
          </div>
        )}
      </div>

      <div className="pt-1">
        <p className="text-xs text-zinc-500 mb-1">Candidate Intents</p>
        {candidates.length === 0
          ? <p className="text-xs text-zinc-600">No candidates returned.</p>
          : candidates.map((intent) => (
              <CandidateIntentDebug key={JSON.stringify(intent)} intent={intent} />
            ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recipient selector — native <select> over the supplier's full trust-graph
// connections (xprize#55, extended by xprize#59 to include contacts who've
// never been active on AgriFortress before). Per Ryan's correction on #55,
// a native select is preferred over a custom listbox/combobox — kept native
// here too (xprize#59 notes: grey via a label suffix + a scoped `<option>`
// text color, not a custom component). Dark-mode popup styling is tracked
// separately (ima-jin/imajin-ai#1781) — not touched here; the inline color
// below only dims text within the native popup and doesn't touch any global
// styling.
// ---------------------------------------------------------------------------

const INACTIVE_OPTION_SUFFIX = ' — invite required';
const INACTIVE_OPTION_COLOR = '#71717a'; // zinc-500, matching the app's existing dim-text palette

function RecipientSelect(
  props: Readonly<{
    value: string;
    connections: readonly ConnectionEntry[];
    activeRecipientDids: ReadonlySet<string>;
    disabled: boolean;
    onChange: (did: string) => void;
  }>,
) {
  const { value, connections, activeRecipientDids, disabled, onChange } = props;

  if (connections.length === 0) {
    return (
      <p className="text-xs text-zinc-500 italic rounded-lg border border-zinc-800 bg-zinc-800/50 px-3 py-2">
        No connections yet — add a trust-graph connection to choose a recipient.
      </p>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none disabled:opacity-50"
    >
      <option value="">Select recipient…</option>
      {connections.map((connection) => {
        const isActive = activeRecipientDids.has(connection.did);
        return (
          <option
            key={connection.did}
            value={connection.did}
            style={isActive ? undefined : { color: INACTIVE_OPTION_COLOR }}
          >
            {connectionLabel(connection)}{isActive ? '' : INACTIVE_OPTION_SUFFIX}
          </option>
        );
      })}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Line item row — one packing-slip line (xprize#56). Product is currently a
// free-text label; `product.id` is left unset here since full catalog
// typed-ref selection is a follow-up (see PR description) — the shape
// already supports attaching an id once that UI exists.
// ---------------------------------------------------------------------------

const UNITS_DATALIST_ID = 'delivery-line-units';

function DeliveryLineRow(
  props: Readonly<{
    line: DeliveryLineDraft;
    disabled: boolean;
    canRemove: boolean;
    onProductLabelChange: (label: string) => void;
    onUnitChange: (unit: string) => void;
    onQtyChange: (qty: string) => void;
    onUnitPriceChange: (unitPrice: string) => void;
    onTotalChange: (total: string) => void;
    onRemove: () => void;
  }>,
) {
  const {
    line, disabled, canRemove,
    onProductLabelChange, onUnitChange, onQtyChange, onUnitPriceChange, onTotalChange, onRemove,
  } = props;
  const totalLabel = lineTotalLabel(line);
  const inputClassName =
    'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50';

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-800/40 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <input
          type="text"
          placeholder="Product"
          value={line.product.label}
          onChange={(e) => onProductLabelChange(e.target.value)}
          disabled={disabled}
          className={inputClassName}
        />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label="Remove line"
            className="shrink-0 text-xs text-zinc-500 hover:text-red-400 px-2 py-2 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          placeholder="Quantity"
          value={line.qty}
          onChange={(e) => onQtyChange(e.target.value)}
          disabled={disabled}
          className={inputClassName}
        />
        <input
          type="text"
          list={UNITS_DATALIST_ID}
          placeholder="Unit"
          value={line.unit}
          onChange={(e) => onUnitChange(e.target.value)}
          disabled={disabled}
          className={inputClassName}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          placeholder="Unit price ($)"
          value={line.unitPrice}
          onChange={(e) => onUnitPriceChange(e.target.value)}
          disabled={disabled}
          className={inputClassName}
        />
        <input
          type="text"
          placeholder="Total ($)"
          value={line.total}
          onChange={(e) => onTotalChange(e.target.value)}
          disabled={disabled}
          className={inputClassName}
        />
      </div>

      {totalLabel !== null && <p className="text-xs text-zinc-500">{totalLabel}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DeliveryGestureProps {
  readonly priorLot?: RecentLot;
  readonly connections?: readonly ConnectionEntry[];
  /** DIDs the best-effort heuristic (see `collectRecipientDids`, src/lib/supply.ts) found as prior AgriFortress recipients (xprize#59). */
  readonly activeRecipientDids?: readonly string[];
}

export function DeliveryGesture({ priorLot, connections = [], activeRecipientDids = [] }: DeliveryGestureProps) {
  const [state, setState] = useState<GestureState>({ phase: 'idle' });
  const activeRecipientDidSet = new Set(activeRecipientDids);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const nextLineKeyRef = useRef(0);

  function makeLineKey(): string {
    nextLineKeyRef.current += 1;
    return `line-${nextLineKeyRef.current}`;
  }

  function toKeyedLines(drafts: readonly DeliveryLineDraft[]): KeyedLine[] {
    return drafts.map((draft) => ({ key: makeLineKey(), draft }));
  }

  // --- Capture ---

  async function sendCapture(blob: Blob, filename: string): Promise<void> {
    setState({ phase: 'capturing' });

    const form = new FormData();
    form.append('file', blob, filename);

    let capture: CaptureResponse;
    try {
      const res = await fetch('/api/inference/capture', {
        method: 'POST',
        body: form,
      });
      const data = await res.json() as CaptureResponse | { error?: string };
      if (!res.ok) {
        const msg = (data as { error?: string }).error ?? `Capture failed (${res.status})`;
        setState({ phase: 'error', errorMessage: msg });
        return;
      }
      capture = data as CaptureResponse;
    } catch {
      setState({ phase: 'error', errorMessage: 'Network error during capture' });
      return;
    }

    const outcome = resolveCaptureOutcome(capture, priorLot, connections);
    if (outcome.kind === 'error') {
      setState({ phase: 'error', errorMessage: outcome.errorMessage });
      return;
    }
    setState({
      phase: 'editing',
      sessionId: capture.sessionId,
      header: outcome.header,
      lines: toKeyedLines(outcome.lines),
      notice: outcome.notice,
      captureResponse: capture,
    });
  }

  // --- Voice recording ---

  async function startRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];

      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        for (const track of stream.getTracks()) {
          track.stop();
        }
        void sendCapture(blob, 'voice.webm');
      };

      mediaRecorderRef.current = mr;
      mr.start();
      setState({ phase: 'recording' });
    } catch {
      setState({ phase: 'error', errorMessage: 'Microphone access denied' });
    }
  }

  function stopRecording(): void {
    mediaRecorderRef.current?.stop();
    // Phase transitions to 'capturing' inside mr.onstop → sendCapture
  }

  // --- Photo upload ---

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.item(0);
    if (file) void sendCapture(file, file.name);
  }

  // --- Editing: header ---

  function updateHeaderField(key: keyof DeliveryHeaderFields, value: string): void {
    if (state.phase !== 'editing' || state.header === undefined) return;
    setState({ ...state, header: { ...state.header, [key]: value } });
  }

  // --- Editing: line items ---

  function updateLine(key: string, updater: (line: DeliveryLineDraft) => DeliveryLineDraft): void {
    if (state.phase !== 'editing' || state.lines === undefined) return;
    const nextLines = state.lines.map((l) => (l.key === key ? { key: l.key, draft: updater(l.draft) } : l));
    setState({ ...state, lines: nextLines });
  }

  function addLine(): void {
    if (state.phase !== 'editing' || state.lines === undefined) return;
    setState({ ...state, lines: [...state.lines, { key: makeLineKey(), draft: createEmptyLine() }] });
  }

  function removeLine(key: string): void {
    if (state.phase !== 'editing' || state.lines === undefined) return;
    if (state.lines.length <= 1) return; // the manifest always keeps at least one line
    setState({ ...state, lines: state.lines.filter((l) => l.key !== key) });
  }

  // --- Confirm ---

  async function handleConfirm(): Promise<void> {
    if (state.phase !== 'editing' || state.sessionId === undefined) return;
    const { sessionId } = state;
    const header = state.header ?? EMPTY_HEADER_FIELDS;
    const lines = state.lines ?? [];

    // A delivery receipt without a subject is unsignable — the attestation's
    // recipient IS the claim's subject (AGENTS.md §4), so an empty recipient
    // must never reach the confirm call.
    if (!hasRecipient(header)) {
      setState({ phase: 'error', errorMessage: MISSING_RECIPIENT_MESSAGE });
      return;
    }

    // Freeze qty/unitPrice/total per line, mutually consistent, validated at
    // sign time — the signed payload contains exact resolved numbers, never
    // formulas (AGENTS.md §4: never a signed ambiguity).
    const frozenLines: ConfirmedLine[] = [];
    for (const { draft } of lines) {
      const frozen = freezeLine(draft);
      if (frozen === null) {
        setState({ phase: 'error', errorMessage: INVALID_LINES_MESSAGE });
        return;
      }
      frozenLines.push(frozen);
    }
    if (frozenLines.length === 0) {
      setState({ phase: 'error', errorMessage: INVALID_LINES_MESSAGE });
      return;
    }

    setState({ ...state, phase: 'submitting' });

    const confirmedCard: ConfirmIntentBody = {
      ...(header.recipient !== '' ? { recipient: header.recipient } : {}),
      ...(header.lot !== '' ? { lot: header.lot } : {}),
      ...(header.notes !== '' ? { notes: header.notes } : {}),
      lines: frozenLines,
    };

    let confirm: ConfirmResponse;
    try {
      const res = await fetch(
        `/api/inference/confirm/${encodeURIComponent(sessionId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(confirmedCard),
        },
      );
      const data = await res.json() as ConfirmResponse | { error?: string };
      if (!res.ok) {
        const msg = (data as { error?: string }).error ?? `Confirm failed (${res.status})`;
        setState({ phase: 'error', errorMessage: msg });
        return;
      }
      confirm = data as ConfirmResponse;
    } catch {
      setState({ phase: 'error', errorMessage: 'Network error during confirm' });
      return;
    }

    // The delivery attestation is already signed at this point (pending, with
    // the chosen recipient as subject — same behavior whether or not they've
    // been active on AgriFortress before, xprize#59's claimable-stub move).
    // Sending the invite is best-effort and secondary: a failed invite send
    // must never look like a failed delivery (claim boundary, AGENTS.md §4),
    // so errors here are swallowed rather than surfaced as the confirm outcome.
    if (isRecipientPendingInvite(header.recipient, activeRecipientDidSet)) {
      const recipientConnection = connections.find((c) => c.did === header.recipient);
      try {
        await fetch('/api/connections/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipientLabel: recipientConnection !== undefined ? connectionLabel(recipientConnection) : undefined,
          }),
        });
      } catch {
        // Best-effort — see comment above.
      }
    }

    const receiptUrl = getReceiptUrl(confirm.externalId);
    if (receiptUrl !== null) {
      globalThis.location.assign(receiptUrl);
      return;
    }
    // Fallback: no correlationId returned — keep the signed attestationId panel.
    // Never fabricate a receipt when the lot id is absent (claim boundary, AGENTS.md §4).
    setState({ phase: 'done', attestationId: confirm.attestationId });
  }

  // --- Reset ---

  function reset(): void {
    setState({ phase: 'idle' });
    chunksRef.current = [];
    mediaRecorderRef.current = null;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (state.phase === 'done') {
    return (
      <section className="rounded-xl border border-green-800 bg-green-950/30 p-5 space-y-3">
        <p className="text-sm font-medium text-green-400">Delivery recorded</p>
        <p className="text-xs text-zinc-400">Attestation</p>
        <p className="text-xs text-zinc-300 font-mono break-all">{state.attestationId}</p>
        <button
          type="button"
          onClick={reset}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          New delivery
        </button>
      </section>
    );
  }

  if (state.phase === 'error') {
    return (
      <section className="rounded-xl border border-red-800 bg-red-950/30 p-5 space-y-3">
        <p className="text-sm font-medium text-red-400">Error</p>
        <p className="text-xs text-red-300">{state.errorMessage}</p>
        <button
          type="button"
          onClick={reset}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Try again
        </button>
      </section>
    );
  }

  if (state.phase === 'editing' || state.phase === 'submitting') {
    const isSubmitting = state.phase === 'submitting';
    const header = state.header ?? EMPTY_HEADER_FIELDS;
    const lines = state.lines ?? [];
    const drafts = lines.map((l) => l.draft);
    const allLinesValid = drafts.length > 0 && drafts.every((draft) => isLineValid(draft));
    const grandTotalCents = manifestGrandTotalCents(drafts);

    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">Delivery card</p>
            <p className="text-xs text-zinc-500 mt-1">
              AI-inferred. All fields are editable — you confirm and sign.
            </p>
          </div>

          {state.notice !== undefined && (
            <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800 rounded-lg px-3 py-2">
              {state.notice}
            </p>
          )}

          {/* Header — recipient (DID selector, xprize#55), lot, notes */}
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Recipient</label>
              <RecipientSelect
                value={header.recipient}
                connections={connections}
                activeRecipientDids={activeRecipientDidSet}
                disabled={isSubmitting}
                onChange={(did) => updateHeaderField('recipient', did)}
              />
              {noActiveConnectionsNotice(connections, activeRecipientDidSet) !== undefined && (
                <p className="text-xs text-zinc-500">
                  {noActiveConnectionsNotice(connections, activeRecipientDidSet)}
                </p>
              )}
              {inviteNoticeForRecipient(header.recipient, activeRecipientDidSet) !== undefined && (
                <p
                  data-testid="invite-notice"
                  className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800 rounded-lg px-3 py-2"
                >
                  {inviteNoticeForRecipient(header.recipient, activeRecipientDidSet)}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Lot</label>
              <input
                type="text"
                value={header.lot}
                onChange={(e) => updateHeaderField('lot', e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Notes</label>
              <input
                type="text"
                value={header.notes}
                onChange={(e) => updateHeaderField('notes', e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          {/* Line items — 1..n, each a product + qty/unit + unitPrice/total (xprize#56) */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Line items
            </p>

            {lines.map(({ key, draft }) => (
              <DeliveryLineRow
                key={key}
                line={draft}
                disabled={isSubmitting}
                canRemove={lines.length > 1}
                onProductLabelChange={(label) =>
                  updateLine(key, (l) => ({ ...l, product: { ...l.product, label } }))
                }
                onUnitChange={(unit) => updateLine(key, (l) => ({ ...l, unit }))}
                onQtyChange={(qty) => updateLine(key, (l) => applyQtyEdit(l, qty))}
                onUnitPriceChange={(unitPrice) => updateLine(key, (l) => applyUnitPriceEdit(l, unitPrice))}
                onTotalChange={(total) => updateLine(key, (l) => applyTotalEdit(l, total))}
                onRemove={() => removeLine(key)}
              />
            ))}

            <datalist id={UNITS_DATALIST_ID}>
              {KNOWN_UNITS.map((unit) => <option key={unit} value={unit} />)}
            </datalist>

            <button
              type="button"
              onClick={addLine}
              disabled={isSubmitting}
              className="w-full rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50 transition-colors"
            >
              + Add line
            </button>
          </div>

          {/* Manifest grand total */}
          <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
            <span className="text-xs text-zinc-400">Manifest total</span>
            <span className="text-sm font-semibold text-white">${formatCents(grandTotalCents)}</span>
          </div>

          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isSubmitting || !allLinesValid || !hasRecipient(header)}
            className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-zinc-100 disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? 'Signing…' : 'Confirm delivery'}
          </button>
        </section>

        {/* Inference Debug — always visible; never collapsed or hidden (xprize#49) */}
        <InferenceDebugPanel captureResponse={state.captureResponse} />
      </div>
    );
  }

  // idle / recording / capturing
  const isBusy = state.phase === 'capturing';
  const isRecording = state.phase === 'recording';

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
      <div>
        <p className="text-sm font-medium text-zinc-300">Record a delivery</p>
        <p className="text-xs text-zinc-500 mt-1">
          Voice note or photo → AI infers intent → you confirm and sign.
          Photo is evidence only — you assert the count.
        </p>
      </div>

      <div className="flex gap-3">
        {isRecording ? (
          <button
            type="button"
            onClick={stopRecording}
            className="flex-1 rounded-lg border border-red-700 bg-red-950/40 px-4 py-2.5 text-sm font-medium text-red-300 hover:bg-red-900/40 transition-colors"
          >
            Stop recording
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={isBusy}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            {isBusy ? 'Processing…' : 'Voice note'}
          </button>
        )}

        <label
          className={[
            'flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5',
            'text-sm font-medium text-zinc-200 text-center cursor-pointer',
            'hover:bg-zinc-700 transition-colors',
            isBusy || isRecording ? 'pointer-events-none opacity-50' : '',
          ].join(' ')}
        >
          Photo
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handlePhotoChange}
            disabled={isBusy || isRecording}
          />
        </label>
      </div>
    </section>
  );
}
