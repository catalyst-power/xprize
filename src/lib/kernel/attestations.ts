/**
 * Public attestation-status client — kernel's `/auth/api/attestations` read
 * surface (xprize#60).
 *
 * `GET /auth/api/attestations?subject_did=...` is unauthenticated on the
 * kernel today (verified against ima-jin/imajin-ai@main
 * apps/kernel/app/auth/api/attestations/route.ts — the `GET` handler calls
 * neither `requireAppAuth` nor any session check, unlike every other kernel
 * surface this app calls). It is the ONLY kernel read surface that exposes
 * `attestationStatus`; `GET /supply/api/lot/{correlationId}` returns
 * `attestationCid` per stage but never the attestation's bilateral status.
 */

import { fetchKernel } from './client';

const DEFAULT_KERNEL_URL = 'https://imajin.ai';

export type AttestationStatus = 'pending' | 'bilateral' | 'declined' | 'collecting' | 'executed' | 'expired';

export interface AttestationRecord {
  id: string;
  issuerDid: string;
  subjectDid: string;
  type: string;
  contextId: string | null;
  contextType: string | null;
  cid: string | null;
  attestationStatus: AttestationStatus | null;
  issuedAt: string;
}

export interface GetAttestationsParams {
  subjectDid: string;
  type?: string;
  status?: AttestationStatus;
  issuerDid?: string;
  limit?: number;
}

export async function getAttestationsBySubject(
  params: GetAttestationsParams,
): Promise<AttestationRecord[]> {
  const kernelUrl = (process.env.KERNEL_URL ?? DEFAULT_KERNEL_URL).replace(/\/$/, '');
  const qs = new URLSearchParams({ subject_did: params.subjectDid });
  if (params.type !== undefined) qs.set('type', params.type);
  if (params.status !== undefined) qs.set('status', params.status);
  if (params.issuerDid !== undefined) qs.set('issuer_did', params.issuerDid);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));

  const res = await fetch(`${kernelUrl}/auth/api/attestations?${qs.toString()}`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`attestations.read failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<AttestationRecord[]>;
}

/** Structural bilateral gate for settlement — never infer this from lot.status. */
export async function isReceiptBilateral(
  supplierDid: string,
  correlationId: string,
): Promise<boolean> {
  const records = await getAttestationsBySubject({
    subjectDid: supplierDid,
    type: 'supply.received',
    status: 'bilateral',
  });
  return records.some((record) => record.contextId === correlationId);
}

// ---------------------------------------------------------------------------
// countersignAttestation — the pending-signatures inbox's sign action
// (xprize#74)
// ---------------------------------------------------------------------------

export interface CountersignResult {
  id: string;
  cid: string | null;
  status: 'bilateral';
}

/**
 * Countersign a pending attestation — `POST /auth/api/attestations/countersign`.
 * Transitions the attestation `pending` → `bilateral`. Only the attestation
 * subject can countersign; the kernel enforces that from the app-auth
 * bearer token's identity (`actingAttestationId` must be the acting
 * session's own consent attestation — the same discipline as every other
 * `fetchKernel` call here, never a value read from process.env).
 *
 * `witnessJws` must be built by the caller — see `buildAppWitnessJws`
 * (src/lib/kernel/auth.ts) for why this app signs it with its own keypair
 * rather than the subject's chain key.
 */
export async function countersignAttestation(
  attestationId: string,
  witnessJws: string,
  actingAttestationId: string,
): Promise<CountersignResult> {
  const res = await fetchKernel(
    '/auth/api/attestations/countersign',
    { method: 'POST', body: JSON.stringify({ attestationId, witnessJws }) },
    actingAttestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`attestations.countersign failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<CountersignResult>;
}
