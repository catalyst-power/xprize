/**
 * Server-side supply API helpers.
 *
 * All kernel calls are made from the server with a Bearer app token.
 * The token's JWT `sub` = the userDid (Scott), so the kernel pins
 * issuer/subject = Scott automatically — no spoofing possible.
 */

import { fetchKernel } from '@/lib/kernel/client';

export interface DeclaredInput {
  commodity: string;
  quantity: number;
  unit: string;
}

export interface DeclaredOutput {
  ok: boolean;
  correlationId: string;
  stage: 'declared';
}

export interface ReceivedInput {
  lotId: string;
  commodity: string;
  quantity: number;
  unit: string;
  priorCid?: string;
}

export interface ReceivedOutput {
  ok: boolean;
  correlationId: string;
  stage: 'received';
}

/**
 * POST /supply/api/declared — mint a new lot.
 */
export async function declareLot(input: DeclaredInput): Promise<DeclaredOutput> {
  const res = await fetchKernel('/supply/api/declared', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`declareLot failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<DeclaredOutput>;
}

/**
 * POST /supply/api/received — sign the delivery receipt.
 * Requires an existing lotId from declareLot.
 */
export async function receiveLot(input: ReceivedInput): Promise<ReceivedOutput> {
  const res = await fetchKernel('/supply/api/received', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`receiveLot failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<ReceivedOutput>;
}
