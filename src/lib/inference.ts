/**
 * Kernel inference domain client for AgriFortress.
 *
 * Wraps the two kernel calls that make up the AI-native delivery gesture:
 *   1. POST /api/inference/capture   → submits voice/photo; returns candidateIntents
 *   2. POST /api/inference/confirm/{sessionId} → signs the chosen intent → attestationId
 *
 * Both calls are server-side only (never browser → kernel with the app token).
 * `vocabulary: "agrifortress"` is always injected — callers never set it.
 * Auth is handled transparently by fetchKernel (TokenProvider + Bearer injection).
 *
 * Reference kernel routes: ima-jin/imajin-ai PR #1290 (inference engine)
 *   capture  — transcribe/context → policy(LLM) → consent gate → candidateIntents
 *   confirm  — advances chosen intent → signs attestation → resolvedAttestation
 *
 * Parallel dependency: ima-jin/imajin-ai#1431 adds app-auth support to these
 * routes. Until that lands, calls will 401 on app-auth — expected.
 *
 * Issue: catalyst-power/xprize#5
 */

import { fetchKernel } from './kernel/client';
import type { ConfirmedLine } from './deliveryLines';

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

/** One inferred line item, before it's confirmed/priced (xprize#56). */
export interface IntentLineMetadata {
  product?: string;
  qty?: number;
  unit?: string;
  /** Dollars per unit, if Gemini could infer a price. */
  unitPrice?: number;
}

export interface IntentMetadata {
  /**
   * @deprecated Legacy single-product shape, kept only so an older/simpler
   * candidate payload still resolves (xprize#56: "a legacy single-product
   * payload maps to lines[0]"). New candidates use `lines`.
   */
  product?: string;
  qty?: number;
  unit?: string;
  recipient?: string;
  lot?: string;
  notes?: string;
  /**
   * Packing-slip line items (xprize#56) — one gesture like "40 eggs and 20
   * chickens" produces one card with N lines. When absent, callers fall
   * back to the legacy top-level `product`/`qty`/`unit` as a single line.
   */
  lines?: IntentLineMetadata[];
}

export interface CandidateIntent {
  intentType: string;
  metadata: IntentMetadata;
  /** Kernel-assigned confidence for this candidate, in [0, 1]. Candidates are ranked by this value. */
  confidence?: number;
}

export interface InferenceCaptureResponse {
  sessionId: string;
  assetId: string;
  /** "pending_confirm" for all agrifortress intents (all are `deliberate`). */
  status: string;
  candidateIntents?: CandidateIntent[];
}

export interface InferenceConfirmResponse {
  sessionId: string;
  status: 'resolved';
  attestationId: string;
  intentType: string;
  primitiveType: string;
  /**
   * The `supply.received` lot correlationId — the same value `getLotChain()`
   * expects. Set by the agrifortress vocabulary resolver when it signs the
   * `supply.received` attestation. Use this to key the delivery receipt.
   */
  externalId: string;
  resolvedAt: string;
}

/**
 * The human's confirmed/edited delivery card, sent as the confirm request
 * body so the signed attestation reflects what Scott actually confirmed —
 * not just whatever Gemini inferred at capture time (AGENTS.md §4: inference
 * is a prior, the human is the authority).
 *
 * `recipient` must be a DID resolved from the supplier's own trust-graph
 * connections (xprize#55), never a free-text name — the receiver can only
 * countersign via `POST /auth/api/attestations/countersign` if the signed
 * attestation's subject is their own DID.
 *
 * NOTE (known kernel limitation, discovered while implementing xprize#55/#56):
 * as of this writing, the kernel's `POST /api/inference/confirm/:sessionId`
 * route (ima-jin/imajin-ai apps/kernel/app/api/inference/confirm/[sessionId]/route.ts)
 * does not read a request body at all — it re-signs whatever `metadata` was
 * stored on the session at capture time. Sending this body is forward-compatible
 * (harmless no-op today, ready the day the kernel route is extended to consume
 * edits) but does NOT yet change what gets signed. Tracked as a follow-up;
 * see the PR description for xprize#55/#56.
 */
export interface ConfirmIntentBody {
  recipient?: string;
  lot?: string;
  notes?: string;
  /**
   * The frozen, validated packing-slip lines (xprize#56) — qty/unitPrice/total
   * are mutually consistent numbers, never formulas (AGENTS.md §4: the signed
   * artifact is deterministic, not a signed ambiguity).
   */
  lines: ConfirmedLine[];
}

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

/**
 * Submit a voice note or photo blob to the inference engine.
 *
 * Sends `vocabulary=agrifortress` so the kernel routes to the correct vocab
 * (Gemini adapter + supply intents). Returns `candidateIntents` ranked by
 * confidence; callers should present `candidateIntents[0]` for editing.
 *
 * @param file          Audio/photo blob from the browser (via the app server route).
 * @param attestationId The acting user's own session attestation.
 * @param filename      Optional display filename forwarded to the kernel.
 */
export async function captureInference(
  file: File | Blob,
  attestationId: string,
  filename?: string,
): Promise<InferenceCaptureResponse> {
  const effectiveFilename =
    filename ?? (file instanceof File ? file.name : 'capture');

  const form = new FormData();
  form.append('file', file, effectiveFilename);
  form.append('vocabulary', 'agrifortress');
  if (filename !== undefined) {
    form.append('filename', filename);
  }

  const res = await fetchKernel(
    '/api/inference/capture',
    { method: 'POST', body: form },
    attestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(
      `inference.capture failed: ${res.status} ${data.error ?? res.statusText}`,
    );
  }

  return res.json() as Promise<InferenceCaptureResponse>;
}

/**
 * Advance a pending inference session to `resolved`.
 *
 * Confirms the chosen candidate intent, signs the `supply.received`
 * attestation via the agrifortress vocabulary resolver, and returns the
 * signed `attestationId`. No retry is safe — the intent is signed exactly once.
 *
 * @param sessionId     The `sessionId` returned by `captureInference`.
 * @param attestationId The acting user's own session attestation.
 * @param body          The human's confirmed/edited delivery card (see
 *                       `ConfirmIntentBody`). Omitted entirely when there is
 *                       nothing to send (e.g. tests exercising the bare call).
 */
export async function confirmInference(
  sessionId: string,
  attestationId: string,
  body?: ConfirmIntentBody,
): Promise<InferenceConfirmResponse> {
  const res = await fetchKernel(
    `/api/inference/confirm/${encodeURIComponent(sessionId)}`,
    { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
    attestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(
      `inference.confirm failed: ${res.status} ${data.error ?? res.statusText}`,
    );
  }

  return res.json() as Promise<InferenceConfirmResponse>;
}
