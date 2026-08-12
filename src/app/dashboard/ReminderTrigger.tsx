'use client';

/**
 * ReminderTrigger — fires the automatic reminder-ladder check (xprize#75)
 * once per dashboard load, using the signed-in supplier's own session. This
 * is the pragmatic "no cron infra" trigger documented on
 * POST /api/delivery/reminders/check: AgriFortress has no scheduler, so the
 * closest equivalent is checking whenever the supplier is actually looking
 * at the app.
 *
 * Renders nothing. Fire-and-forget: never blocks rendering, never surfaces
 * a UI state, failures are only logged client-side — this is best-effort
 * background work the supplier didn't explicitly ask for right now, same
 * non-blocking posture as the confirm-time notification (xprize#73).
 */

import { useEffect } from 'react';

export function ReminderTrigger() {
  useEffect(() => {
    fetch('/api/delivery/reminders/check', { method: 'POST' }).catch((err: unknown) => {
      console.error('[ReminderTrigger] reminder check failed:', err);
    });
  }, []);

  return null;
}
