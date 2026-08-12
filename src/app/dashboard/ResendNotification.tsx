'use client';

/**
 * ResendNotification — manual resend action on the delivery receipt
 * (xprize#75). Rendered by `DeliveryReceipt` on both /delivery/[id]
 * (xprize#76) and the ?lot= dashboard variant, while the receipt is not yet
 * bilateral (settlement.state === 'pending-invoice'). Calls
 * POST /api/delivery/{id}/resend, which re-sends the counterparty chat DM
 * (xprize#73) and re-fires the connection invite for inactive recipients
 * (xprize#59) server-side.
 */

import { useState } from 'react';

type ResendPhase = 'idle' | 'sending' | 'done' | 'error';

interface ResendApiResponse {
  notified?: boolean;
  inviteSent?: boolean;
  inviteFailed?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

/**
 * Resolve the status line shown after a resend attempt. Exported so the
 * copy logic is unit-testable without mounting the component — this repo's
 * vitest config runs in `environment: 'node'` (no DOM/hook rendering), the
 * same reason DeliveryGesture.tsx keeps its interactive logic thin and puts
 * the testable decisions in plain exported functions.
 */
export function resendResultMessage(res: ResendApiResponse): string {
  if (res.skipped === true) return res.reason ?? 'Already signed \u2014 no reminder needed.';
  if (res.error !== undefined) return res.error;
  if (res.inviteFailed === true) {
    return 'Notification resent. Invite could not be resent \u2014 share the invite link directly.';
  }
  if (res.inviteSent === true) return 'Notification and invite resent.';
  return 'Notification resent.';
}

export function ResendNotification(props: Readonly<{ correlationId: string }>) {
  const { correlationId } = props;
  const [phase, setPhase] = useState<ResendPhase>('idle');
  const [message, setMessage] = useState<string | undefined>();

  async function handleResend(): Promise<void> {
    setPhase('sending');
    setMessage(undefined);
    try {
      const res = await fetch(`/api/delivery/${encodeURIComponent(correlationId)}/resend`, {
        method: 'POST',
      });
      const data = (await res.json().catch(() => ({}))) as ResendApiResponse;
      if (!res.ok) {
        setPhase('error');
        setMessage(resendResultMessage({ ...data, error: data.error ?? `Resend failed (${res.status})` }));
        return;
      }
      setPhase('done');
      setMessage(resendResultMessage(data));
    } catch {
      setPhase('error');
      setMessage('Network error while resending.');
    }
  }

  return (
    <div className="border-t border-zinc-800 pt-3 space-y-2">
      <button
        type="button"
        onClick={() => void handleResend()}
        disabled={phase === 'sending'}
        data-testid="resend-notification-button"
        className="text-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
      >
        {phase === 'sending' ? 'Resending\u2026' : 'Resend notification'}
      </button>
      {message !== undefined && (
        <p
          data-testid="resend-notification-message"
          className={phase === 'error' ? 'text-xs text-red-400' : 'text-xs text-zinc-500'}
        >
          {message}
        </p>
      )}
    </div>
  );
}
