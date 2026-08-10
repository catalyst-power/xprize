'use client';

/**
 * DeliveryGesture — the AgriFortress AI-native delivery input.
 *
 * Flow:
 *   1. Scott taps "Voice note" → MediaRecorder captures audio
 *      OR taps "Photo" → picks an image from camera/library
 *   2. File is sent to POST /api/inference/capture (server-side; never
 *      direct browser → kernel)
 *   3. candidateIntents[0].metadata pre-fills the delivery card — all fields
 *      fully editable (inference = prior, human = authority; AGENTS.md §4)
 *   4. Scott taps "Confirm delivery" → POST /api/inference/confirm/{sessionId}
 *   5. On success: signed attestationId shown. On failure: honest error —
 *      never a phantom receipt (same discipline as #17).
 *
 * Voice is the primary path. Photo is evidence; the count is never derived
 * from the image — Scott asserts and signs it (AGENTS.md §4).
 */

import { useRef, useState } from 'react';
import type { RecentLot } from '@/lib/supply';
import type { CandidateIntent, InferenceCaptureResponse, IntentMetadata } from '@/lib/inference';

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

interface DeliveryFields {
  product: string;
  qty: string;
  unit: string;
  recipient: string;
  lot: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Pre-fill helper — exported for testing
// ---------------------------------------------------------------------------

/**
 * Merge Gemini inference metadata with the most recent lot (a prior, never authority).
 * Inference wins when present; `priorLot.commodity` seeds the product field only when
 * inference returned nothing. The human's confirmation is the signing event.
 */
export function resolveDeliveryFields(
  meta: IntentMetadata,
  priorLot: RecentLot | undefined,
): DeliveryFields {
  return {
    product: meta.product ?? priorLot?.commodity ?? '',
    qty: meta.qty != null ? String(meta.qty) : '',
    unit: meta.unit ?? '',
    recipient: meta.recipient ?? '',
    lot: meta.lot ?? '',
    notes: meta.notes ?? '',
  };
}

const DEFAULT_FAILED_MESSAGE =
  'Could not understand the voice note — try again or fill in manually.';
const ZERO_CANDIDATE_NOTICE =
  "We heard your voice note but couldn't extract details — fill in the fields below.";

type CaptureOutcome =
  | { kind: 'error'; errorMessage: string }
  | { kind: 'editing'; fields: DeliveryFields; notice?: string };

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
): CaptureOutcome {
  if (capture.status === 'failed') {
    return { kind: 'error', errorMessage: capture.error ?? DEFAULT_FAILED_MESSAGE };
  }

  const meta = capture.candidateIntents?.at(0)?.metadata ?? {};
  const hasAnyMeta = Object.values(meta).some((v) => v !== undefined && v !== '' && v !== null);
  const fields = resolveDeliveryFields(meta, priorLot);

  if (!hasAnyMeta && priorLot === undefined) {
    return { kind: 'editing', fields, notice: ZERO_CANDIDATE_NOTICE };
  }

  return { kind: 'editing', fields };
}

type Phase = 'idle' | 'recording' | 'capturing' | 'editing' | 'submitting' | 'done' | 'error';

interface GestureState {
  phase: Phase;
  sessionId?: string;
  fields?: DeliveryFields;
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

/**
 * Build the 'editing' state from a successful capture response. The full
 * `capture` response is retained verbatim as `captureResponse` — never
 * discarded — so the Inference Debug panel can always show exactly what
 * inference produced, not just the first candidate's fields (xprize#49).
 */
export function buildEditingState(
  capture: CaptureResponse,
  priorLot: RecentLot | undefined,
): GestureState {
  const meta = capture.candidateIntents?.at(0)?.metadata ?? {};
  return {
    phase: 'editing',
    sessionId: capture.sessionId,
    fields: resolveDeliveryFields(meta, priorLot),
    captureResponse: capture,
  };
}

// ---------------------------------------------------------------------------
// Field order for the delivery card
// ---------------------------------------------------------------------------

const DELIVERY_FIELDS: ReadonlyArray<[keyof DeliveryFields, string, 'text' | 'number']> = [
  ['product', 'Product', 'text'],
  ['qty', 'Quantity', 'number'],
  ['unit', 'Unit', 'text'],
  ['recipient', 'Recipient', 'text'],
  ['lot', 'Lot', 'text'],
  ['notes', 'Notes', 'text'],
];

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
// Component
// ---------------------------------------------------------------------------

interface DeliveryGestureProps {
  readonly priorLot?: RecentLot;
}

export function DeliveryGesture({ priorLot }: DeliveryGestureProps) {
  const [state, setState] = useState<GestureState>({ phase: 'idle' });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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

    const outcome = resolveCaptureOutcome(capture, priorLot);
    if (outcome.kind === 'error') {
      setState({ phase: 'error', errorMessage: outcome.errorMessage });
      return;
    }
    setState({
      phase: 'editing',
      sessionId: capture.sessionId,
      fields: outcome.fields,
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

  // --- Editing ---

  function updateField(key: keyof DeliveryFields, value: string): void {
    if (state.phase !== 'editing' || state.fields === undefined) return;
    setState({ ...state, fields: { ...state.fields, [key]: value } });
  }

  // --- Confirm ---

  async function handleConfirm(): Promise<void> {
    if (state.phase !== 'editing' || state.sessionId === undefined) return;
    const { sessionId } = state;

    setState({ ...state, phase: 'submitting' });

    let confirm: ConfirmResponse;
    try {
      const res = await fetch(
        `/api/inference/confirm/${encodeURIComponent(sessionId)}`,
        { method: 'POST' },
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
    const fields = state.fields ?? {
      product: '', qty: '', unit: '', recipient: '', lot: '', notes: '',
    };

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

          <div className="space-y-3">
            {DELIVERY_FIELDS.map(([key, label, inputType]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs text-zinc-400">{label}</label>
                <input
                  type={inputType}
                  value={fields[key]}
                  onChange={(e) => updateField(key, e.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isSubmitting}
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
