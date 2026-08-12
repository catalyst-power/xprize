/**
 * Process-local delivery-notification state (xprize#75).
 *
 * AgriFortress has no database of its own (AGENTS.md §2), so state that
 * isn't authoritative on the kernel — "which reminder rungs have already
 * fired for this lot" and "the recipient DID we actually notified at
 * confirm time" — is kept the same way settlementStore.ts keeps settlement
 * idempotency: a best-effort, in-process globalThis Map. This does NOT
 * survive a restart or span multiple app instances; the durable fix would
 * be a kernel-side reminder/notification primitive (out of scope here, see
 * the PR description for xprize#75).
 *
 * `recipientDid` matters because of a known kernel limitation (documented
 * on `ConfirmIntentBody` in src/lib/inference.ts): `POST
 * /api/inference/confirm/:sessionId` re-signs from the captured session's
 * metadata rather than the edited confirm body, so the `received` stage's
 * persisted payload may carry the raw inferred recipient text (e.g. a
 * business name) instead of the DID the supplier actually selected. The
 * confirm route (xprize#73) already has the real DID in hand at confirm
 * time — from `ConfirmIntentBody.recipient`, resolved by the Recipient
 * selector (xprize#55) — so it caches it here for reuse by manual resend
 * and the reminder ladder, which run in later, unrelated requests.
 */

export interface DeliveryNotifyRecord {
  recipientDid: string;
  /** Rung indices (0-based, into the configured reminder ladder — see src/lib/reminders.ts) already sent for this lot. */
  sentRungs: number[];
  /** Set once the counterparty has countersigned — reminders never resume after this (xprize#75: "stops permanently"). */
  stoppedAt?: string;
  lastSentAt?: string;
}

function getStore(): Map<string, DeliveryNotifyRecord> {
  const g = globalThis as typeof globalThis & { __agrifortressDeliveryNotifyStore?: Map<string, DeliveryNotifyRecord> };
  g.__agrifortressDeliveryNotifyStore ??= new Map();
  return g.__agrifortressDeliveryNotifyStore;
}

export function getDeliveryNotifyRecord(correlationId: string): DeliveryNotifyRecord | undefined {
  return getStore().get(correlationId);
}

/** Cache the recipient DID confirmed/resolved for a lot — additive, never drops already-tracked rung/stop state. */
export function cacheRecipientDid(correlationId: string, recipientDid: string): void {
  const existing = getStore().get(correlationId);
  getStore().set(correlationId, {
    sentRungs: existing?.sentRungs ?? [],
    stoppedAt: existing?.stoppedAt,
    lastSentAt: existing?.lastSentAt,
    recipientDid,
  });
}

/** Record that a reminder rung was sent (idempotent — sending the same rung twice is a no-op on the stored set). */
export function markRungSent(correlationId: string, recipientDid: string, rung: number): void {
  const existing = getStore().get(correlationId);
  const sentRungs = existing?.sentRungs ?? [];
  getStore().set(correlationId, {
    recipientDid,
    stoppedAt: existing?.stoppedAt,
    sentRungs: sentRungs.includes(rung) ? sentRungs : [...sentRungs, rung],
    lastSentAt: new Date().toISOString(),
  });
}

/** Permanently stop the reminder ladder for a lot (the counterparty countersigned). Idempotent. */
export function markStopped(correlationId: string): void {
  const existing = getStore().get(correlationId);
  if (existing?.stoppedAt !== undefined) return;
  getStore().set(correlationId, {
    recipientDid: existing?.recipientDid ?? '',
    sentRungs: existing?.sentRungs ?? [],
    lastSentAt: existing?.lastSentAt,
    stoppedAt: new Date().toISOString(),
  });
}

/** Test-only reset — production code has no legitimate reason to clear this. */
export function __resetDeliveryNotifyStoreForTests(): void {
  getStore().clear();
}
