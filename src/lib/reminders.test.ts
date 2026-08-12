import { describe, it, expect, afterEach } from 'vitest';
import {
  buildReminderMessage,
  buildResendMessage,
  looksLikeDid,
  minutesSince,
  nextDueRung,
  resolveRecipientDid,
  resolveReminderLadderMinutes,
  rungLabel,
} from './reminders';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ---------------------------------------------------------------------------
// resolveReminderLadderMinutes
// ---------------------------------------------------------------------------

describe('resolveReminderLadderMinutes', () => {
  it('defaults to 5m/1h/24h/7d when unset', () => {
    delete process.env.REMINDER_LADDER_MINUTES;
    expect(resolveReminderLadderMinutes()).toEqual([5, 60, 1440, 10080]);
  });

  it('defaults when the env var is an empty string', () => {
    process.env.REMINDER_LADDER_MINUTES = '   ';
    expect(resolveReminderLadderMinutes()).toEqual([5, 60, 1440, 10080]);
  });

  it('parses a configured comma-separated ladder', () => {
    process.env.REMINDER_LADDER_MINUTES = '10, 30, 120';
    expect(resolveReminderLadderMinutes()).toEqual([10, 30, 120]);
  });

  it('drops non-positive/unparseable entries but keeps the valid ones', () => {
    process.env.REMINDER_LADDER_MINUTES = '10,-5,abc,0,30';
    expect(resolveReminderLadderMinutes()).toEqual([10, 30]);
  });

  it('falls back to the default ladder when every entry is invalid', () => {
    process.env.REMINDER_LADDER_MINUTES = 'abc,-1,0';
    expect(resolveReminderLadderMinutes()).toEqual([5, 60, 1440, 10080]);
  });
});

// ---------------------------------------------------------------------------
// minutesSince / nextDueRung
// ---------------------------------------------------------------------------

describe('minutesSince', () => {
  it('computes elapsed minutes between two timestamps', () => {
    const base = '2026-01-01T00:00:00Z';
    const now = new Date('2026-01-01T01:30:00Z');
    expect(minutesSince(base, now)).toBe(90);
  });

  it('is zero for identical timestamps', () => {
    const base = '2026-01-01T00:00:00Z';
    expect(minutesSince(base, new Date(base))).toBe(0);
  });
});

describe('nextDueRung', () => {
  const LADDER = [5, 60, 1440, 10080];

  it('returns undefined when nothing is due yet', () => {
    expect(nextDueRung(2, LADDER, new Set())).toBeUndefined();
  });

  it('returns rung 0 once the first threshold elapses', () => {
    expect(nextDueRung(5, LADDER, new Set())).toBe(0);
  });

  it('returns the earliest unsent due rung, never skipping ahead', () => {
    // 2000 minutes elapsed clears rungs 0, 1, and 2 — but rung 0 hasn't been sent yet.
    expect(nextDueRung(2000, LADDER, new Set())).toBe(0);
  });

  it('moves to the next rung once earlier ones are marked sent', () => {
    expect(nextDueRung(2000, LADDER, new Set([0]))).toBe(1);
    expect(nextDueRung(2000, LADDER, new Set([0, 1]))).toBe(2);
  });

  it('returns undefined once every rung has been sent', () => {
    expect(nextDueRung(999999, LADDER, new Set([0, 1, 2, 3]))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// rungLabel / message builders
// ---------------------------------------------------------------------------

describe('rungLabel', () => {
  it('labels sub-hour thresholds in minutes', () => {
    expect(rungLabel(5)).toBe('5 minutes');
    expect(rungLabel(1)).toBe('1 minute');
  });

  it('labels sub-day thresholds in hours', () => {
    expect(rungLabel(60)).toBe('1 hour');
    expect(rungLabel(120)).toBe('2 hours');
  });

  it('labels multi-day thresholds in days', () => {
    expect(rungLabel(1440)).toBe('1 day');
    expect(rungLabel(10080)).toBe('7 days');
  });
});

describe('buildReminderMessage / buildResendMessage', () => {
  it('links to the standalone /delivery/{id} route and mentions the elapsed threshold', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://integrity.imajin.ai';
    const message = buildReminderMessage('lot_abc123', 60);
    expect(message).toContain('/delivery/lot_abc123');
    expect(message).toContain('1 hour');
  });

  it('uses distinct wording for a manual resend vs. the automatic ladder', () => {
    const resend = buildResendMessage('lot_abc123');
    const reminder = buildReminderMessage('lot_abc123', 60);
    expect(resend).not.toBe(reminder);
    expect(resend).toContain('/delivery/lot_abc123');
  });

  it('falls back to the default app URL when NEXT_PUBLIC_APP_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(buildResendMessage('lot_1')).toContain('https://integrity.imajin.ai/delivery/lot_1');
  });
});

// ---------------------------------------------------------------------------
// looksLikeDid / resolveRecipientDid
// ---------------------------------------------------------------------------

describe('looksLikeDid', () => {
  it('is true for a did: prefixed string', () => {
    expect(looksLikeDid('did:imajin:david')).toBe(true);
  });

  it('is false for a free-text business name (known kernel limitation payload shape)', () => {
    expect(looksLikeDid('Grace Harbour Farms')).toBe(false);
  });

  it('is false for null/undefined', () => {
    expect(looksLikeDid(null)).toBe(false);
    expect(looksLikeDid(undefined)).toBe(false);
  });
});

describe('resolveRecipientDid', () => {
  it('prefers a cached DID over the payload recipient', () => {
    expect(resolveRecipientDid('did:imajin:cached', 'did:imajin:payload')).toBe('did:imajin:cached');
  });

  it('falls back to the payload recipient when it looks like a DID and no cache exists', () => {
    expect(resolveRecipientDid(undefined, 'did:imajin:payload')).toBe('did:imajin:payload');
  });

  it('ignores a cached value that does not look like a DID', () => {
    expect(resolveRecipientDid('Grace Harbour Farms', 'did:imajin:payload')).toBe('did:imajin:payload');
  });

  it('returns undefined when neither source yields a real DID (never guesses a free-text label)', () => {
    expect(resolveRecipientDid(undefined, 'Grace Harbour Farms')).toBeUndefined();
    expect(resolveRecipientDid(undefined, null)).toBeUndefined();
  });
});
