/** Kernel pay client — hosted checkout and canonical .fair settlement (xprize#60). */

import { fetchKernel } from './client';

const DEFAULT_KERNEL_URL = 'https://imajin.ai';

export interface CheckoutItem {
  name: string;
  description?: string;
  /** Integer cents. */
  amount: number;
  quantity: number;
}

export interface CreateCheckoutRequest {
  items: CheckoutItem[];
  currency: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  sellerDid?: string;
}

export interface CheckoutResponse {
  id: string;
  url: string;
  expiresAt: string;
  transactionId: string;
}

export interface FairManifestChainItem {
  did: string;
  /** Dollars — matches `/pay/api/settle` chain sum semantics in the kernel route. */
  amount: number;
  role: string;
}

export interface FairManifest {
  chain: FairManifestChainItem[];
}

export interface SettleFairRequest {
  from_did: string;
  /** Dollars — the kernel route compares this with `fair_manifest.chain[].amount`. */
  total_amount: number;
  service: string;
  type: string;
  fair_manifest: FairManifest;
  funded?: boolean;
  funded_provider?: string;
  metadata?: Record<string, unknown>;
  currency?: string;
}

export interface SettleFairResponse {
  settled: true;
  batchId: string;
  transactions: string[];
  total_amount: number;
  recipients: number;
  source: string;
}

export async function createCheckoutSession(
  body: CreateCheckoutRequest,
  attestationId: string,
): Promise<CheckoutResponse> {
  const res = await fetchKernel(
    '/pay/api/checkout',
    { method: 'POST', body: JSON.stringify(body) },
    attestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`pay.checkout.create failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<CheckoutResponse>;
}

/**
 * Canonical settlement endpoint. This is service-to-service API-key auth — NOT
 * app-auth — per ima-jin/imajin-ai@main apps/kernel/app/pay/api/settle/route.ts.
 */
export async function settleFair(body: SettleFairRequest): Promise<SettleFairResponse> {
  const apiKey = process.env.PAY_SERVICE_API_KEY;
  if (!apiKey) {
    throw new Error('PAY_SERVICE_API_KEY env var is required for canonical .fair settlement');
  }

  const kernelUrl = (process.env.KERNEL_URL ?? DEFAULT_KERNEL_URL).replace(/\/$/, '');
  const res = await fetch(`${kernelUrl}/pay/api/settle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`pay.settle failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<SettleFairResponse>;
}
