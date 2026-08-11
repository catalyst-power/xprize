/**
 * Process-local settlement idempotency guard (xprize#60).
 *
 * AgriFortress has no database of its own (it composes Imajin via the public
 * app surface only — AGENTS.md §2), so "settle exactly once per invoice,
 * correlationId-keyed" cannot be backed by a durable store here. This is a
 * best-effort, in-process guard against a duplicate webhook delivery or a
 * duplicate page-view racing the same lot — it does NOT protect against
 * multiple app instances, restarts, or the cross-channel case (a QBO-paid
 * settle and a Stripe-paid settle landing on the same lot from two different
 * processes). The durable fix is kernel-side: either a kernel-exposed
 * "claim/mark settled" primitive keyed on correlationId, or the canonical
 * `/api/settle` convergence already tracked upstream (ima-jin/imajin-ai#1073).
 *
 * Uses the same `globalThis` cache convention as `src/lib/kernel/client.ts`
 * so state survives Next.js module hot-reload in dev but never crosses
 * processes.
 */

import type { SettlementState } from './settlement';

interface SettlementRecord {
  state: SettlementState;
  invoiceId?: string;
  checkoutUrl?: string;
  error?: string;
}

function getStore(): Map<string, SettlementRecord> {
  const g = globalThis as typeof globalThis & { __agrifortressSettlementStore?: Map<string, SettlementRecord> };
  g.__agrifortressSettlementStore ??= new Map();
  return g.__agrifortressSettlementStore;
}

export function getSettlementRecord(correlationId: string): SettlementRecord | undefined {
  return getStore().get(correlationId);
}

export function setSettlementRecord(correlationId: string, record: SettlementRecord): void {
  getStore().set(correlationId, record);
}

/**
 * Atomically claim a correlationId for a given target state transition.
 * Returns `true` if the caller won the claim (no record yet, or the record
 * is in a state that allows the requested transition) and `false` if
 * another call already reached or passed that state — the caller must
 * treat `false` as a no-op, never retry the money-moving action.
 */
export function tryClaimTransition(
  correlationId: string,
  from: readonly SettlementState[],
  to: SettlementState,
): boolean {
  const existing = getStore().get(correlationId);
  if (existing !== undefined && !from.includes(existing.state)) {
    return false;
  }
  getStore().set(correlationId, { ...existing, state: to });
  return true;
}

/** Test-only reset — production code has no legitimate reason to clear this. */
export function __resetSettlementStoreForTests(): void {
  getStore().clear();
}
