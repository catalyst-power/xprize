/**
 * Reminder ladder pure helpers (xprize#75) — kept dependency-free so the
 * scheduling math and messaging text are unit-testable without touching the
 * kernel HTTP boundary. See src/app/api/delivery/reminders/check/route.ts
 * for how these compose into the actual check-and-send flow, and its header
 * comment for why "no cron infra" makes a dashboard-load trigger the
 * primary mechanism, with an opt-in shared-secret path for real cron.
 */

/** Default ladder, in minutes since the delivery was signed: 5m, 1h, 24h, 7d. */
const DEFAULT_LADDER_MINUTES = [5, 60, 24 * 60, 7 * 24 * 60];

/**
 * The reminder ladder, in minutes-since-signing, configurable via the
 * REMINDER_LADDER_MINUTES env var (comma-separated minutes, e.g.
 * "5,60,1440,10080"). Falls back to the default 5m/1h/24h/7d ladder on any
 * unset/empty/unparseable value — never throws, never silently produces an
 * empty ladder.
 */
export function resolveReminderLadderMinutes(): number[] {
  const raw = process.env.REMINDER_LADDER_MINUTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_LADDER_MINUTES;

  const parsed = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  return parsed.length > 0 ? parsed : DEFAULT_LADDER_MINUTES;
}

/** Minutes elapsed between an ISO timestamp and `now`. */
export function minutesSince(isoTimestamp: string, now: Date): number {
  return (now.getTime() - new Date(isoTimestamp).getTime()) / 60000;
}

/**
 * The earliest ladder rung whose threshold has elapsed but hasn't already
 * been sent, or undefined when none is due. Always the earliest unsent due
 * rung — never skips ahead — so a lot that missed several checks (e.g. the
 * supplier didn't load the dashboard for days) still gets nudged once per
 * check rather than in a burst; the next check picks up the following rung.
 */
export function nextDueRung(
  elapsedMinutes: number,
  ladderMinutes: readonly number[],
  sentRungs: ReadonlySet<number>,
): number | undefined {
  for (let i = 0; i < ladderMinutes.length; i++) {
    if (!sentRungs.has(i) && elapsedMinutes >= ladderMinutes[i]) return i;
  }
  return undefined;
}

const DEFAULT_APP_URL = 'https://integrity.imajin.ai';

function deliveryUrl(correlationId: string): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL).replace(/\/$/, '');
  return `${appUrl}/delivery/${encodeURIComponent(correlationId)}`;
}

/** Human-readable label for a rung's threshold, for the reminder message text (e.g. 90 -> "1.5 hours"). */
export function rungLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes < 24 * 60) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = minutes / (24 * 60);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** The automatic reminder-ladder DM text for a given rung's threshold. Links to the standalone /delivery/{id} route (xprize#76) — a durable URL, not tied to dashboard navigation state. */
export function buildReminderMessage(correlationId: string, thresholdMinutes: number): string {
  return `Reminder: a delivery attestation has been awaiting your signature in AgriFortress for over ${rungLabel(thresholdMinutes)}: ${deliveryUrl(correlationId)}`;
}

/** The manual-resend DM text — distinct wording from the automatic ladder so a recipient reading their chat history can tell this one was operator-triggered. */
export function buildResendMessage(correlationId: string): string {
  return `Reminder: a delivery attestation is still awaiting your signature in AgriFortress: ${deliveryUrl(correlationId)}`;
}

/** True when a string looks like an Imajin DID — guards against treating a free-text label (the known kernel limitation on the persisted recipient field, see deliveryNotifyStore.ts) as a real recipient identity. */
export function looksLikeDid(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('did:');
}

/**
 * Resolve the best-known recipient DID for a lot: the DID cached at
 * confirm/resend time (deliveryNotifyStore.ts — known-good, since it comes
 * from the Recipient selector's resolved DID, xprize#55) if it looks like a
 * real DID, else the received stage's own payload `recipient` field only
 * when that field itself already looks like a DID. Returns undefined when
 * neither source yields a real DID — callers must fail closed (never guess
 * a chat recipient) rather than message an inferred free-text name.
 */
export function resolveRecipientDid(
  cachedRecipientDid: string | undefined,
  payloadRecipient: string | null,
): string | undefined {
  if (looksLikeDid(cachedRecipientDid)) return cachedRecipientDid;
  if (looksLikeDid(payloadRecipient)) return payloadRecipient;
  return undefined;
}
