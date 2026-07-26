'use client';

/**
 * DeliveryGesture — client component.
 *
 * Provides the delivery entry point: commodity, quantity, and unit inputs.
 * On confirm it POSTs to /api/supply/deliver (which runs the two-step kernel
 * sequence: declare → received). On success it navigates to ?lot={correlationId}
 * so the server renders the signed delivery receipt.
 *
 * Friction gate (AGENTS.md §4): the submit path is intentionally short — one
 * confirm tap should land the user on a receipt. QuickBooks / connector setup
 * is in the Connections section above; it must NOT appear here.
 *
 * Note: Gemini voice/photo inference (#5) will extend this gesture — the form
 * below is the confirm-card step, pre-populated by inference in the full flow.
 *
 * Issue: catalyst-power/xprize#7
 */

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeliverSuccessResponse {
  ok: true;
  received: { correlationId: string };
}

interface DeliverErrorResponse {
  ok: false;
  error: string;
}

type DeliverResponse = DeliverSuccessResponse | DeliverErrorResponse;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeliveryGesture() {
  const [commodity, setCommodity] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/supply/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commodity: commodity.trim(),
          quantity: Number(quantity),
          unit: unit.trim(),
        }),
      });

      const data = (await res.json()) as DeliverResponse;

      if (res.ok && data.ok) {
        const successData = data as DeliverSuccessResponse;
        globalThis.location.assign(`?lot=${encodeURIComponent(successData.received.correlationId)}`);
        return;
      }

      const errorData = data as DeliverErrorResponse;
      setError(errorData.error ?? `Unexpected response (${res.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
      <p className="text-sm font-medium text-zinc-300">Record a delivery</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="gesture-commodity" className="text-xs text-zinc-500">
            Commodity
          </label>
          <input
            id="gesture-commodity"
            type="text"
            value={commodity}
            onChange={(e) => setCommodity(e.target.value)}
            placeholder="e.g. eggs"
            required
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor="gesture-quantity" className="text-xs text-zinc-500">
              Quantity
            </label>
            <input
              id="gesture-quantity"
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 6"
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>

          <div className="flex-1 space-y-1">
            <label htmlFor="gesture-unit" className="text-xs text-zinc-500">
              Unit
            </label>
            <input
              id="gesture-unit"
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. dozen"
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>
        </div>

        {error !== null && (
          <p role="alert" className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-zinc-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Signing receipt…' : 'Confirm delivery'}
        </button>
      </form>

      <p className="text-xs text-zinc-600 leading-relaxed">
        Voice note or photo inference via Gemini lands in{' '}
        <a
          href="https://github.com/catalyst-power/xprize/issues/5"
          className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
          target="_blank"
          rel="noopener noreferrer"
        >
          #5
        </a>
        . Confirming above signs a{' '}
        <span className="font-mono">supply.received</span> attestation on your signed record.
      </p>
    </section>
  );
}
