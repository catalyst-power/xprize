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

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

export interface IntentMetadata {
  product?: string;
  qty?: number;
  unit?: string;
  recipient?: string;
  lot?: string;
  notes?: string;
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
 */
export async function confirmInference(
  sessionId: string,
  attestationId: string,
): Promise<InferenceConfirmResponse> {
  const res = await fetchKernel(
    `/api/inference/confirm/${encodeURIComponent(sessionId)}`,
    { method: 'POST' },
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
