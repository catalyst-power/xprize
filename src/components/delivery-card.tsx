'use client';

/**
 * DeliveryCard — one-confirm delivery receipt gesture.
 *
 * Pre-fills from localStorage (keyed by user DID) with last delivery values.
 * All fields editable (inference = prior, human = authority).
 * One tap on "Confirm delivery" fires POST /api/supply/deliver server-side.
 *
 * Zero required typing on the happy path.
 */

import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeliveryFormData {
  recipient: string;
  commodity: string;
  unit: string;
  quantity: number;
  date: string; // YYYY-MM-DD
}

interface DeliveryResult {
  ok: boolean;
  correlationId: string;
  stage: string;
}

interface PartialFailure {
  error: string;
  partialLotId?: string;
  stage?: string;
}

type DeliveryState =
  | { status: 'idle' }
  | { status: 'confirming' }
  | { status: 'success'; result: DeliveryResult }
  | { status: 'error'; message: string; partialLotId?: string };

// ---------------------------------------------------------------------------
// Local storage helpers — pre-fill source (v0.1 stopgap)
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'agrifortress_last_delivery_';

function getStorageKey(userDid: string): string {
  return `${STORAGE_PREFIX}${userDid}`;
}

function loadLastDelivery(userDid: string): Partial<DeliveryFormData> | null {
  try {
    const raw = globalThis.localStorage?.getItem(getStorageKey(userDid));
    if (!raw) return null;
    return JSON.parse(raw) as Partial<DeliveryFormData>;
  } catch {
    return null;
  }
}

function saveLastDelivery(userDid: string, data: DeliveryFormData): void {
  try {
    globalThis.localStorage?.setItem(getStorageKey(userDid), JSON.stringify(data));
  } catch {
    // localStorage unavailable — non-critical
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function todayString(): string {
  return new Date().toISOString().split('T')[0];
}

const DEFAULT_FORM: DeliveryFormData = {
  recipient: 'Grace Harbour / David',
  commodity: 'eggs',
  unit: 'dozen',
  quantity: 6,
  date: todayString(),
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeliveryCard(props: Readonly<{ userDid: string }>) {
  const { userDid } = props;

  const [form, setForm] = useState<DeliveryFormData>(() => {
    const last = loadLastDelivery(userDid);
    return {
      recipient: last?.recipient ?? DEFAULT_FORM.recipient,
      commodity: last?.commodity ?? DEFAULT_FORM.commodity,
      unit: last?.unit ?? DEFAULT_FORM.unit,
      quantity: last?.quantity ?? DEFAULT_FORM.quantity,
      date: todayString(), // Always today regardless of last delivery
    };
  });

  const [state, setState] = useState<DeliveryState>({ status: 'idle' });

  // Re-hydrate on mount (SSR may not have localStorage)
  useEffect(() => {
    const last = loadLastDelivery(userDid);
    if (last) {
      setForm(prev => ({
        ...prev,
        recipient: last.recipient ?? prev.recipient,
        commodity: last.commodity ?? prev.commodity,
        unit: last.unit ?? prev.unit,
        quantity: last.quantity ?? prev.quantity,
      }));
    }
  }, [userDid]);

  const updateField = useCallback(
    <K extends keyof DeliveryFormData>(field: K, value: DeliveryFormData[K]) => {
      setForm(prev => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleConfirm = useCallback(async () => {
    setState({ status: 'confirming' });

    try {
      const res = await fetch('/api/supply/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commodity: form.commodity,
          quantity: form.quantity,
          unit: form.unit,
          recipient: form.recipient,
        }),
      });

      const data = await res.json() as DeliveryResult & PartialFailure;

      if (res.ok && data.ok) {
        saveLastDelivery(userDid, form);
        setState({ status: 'success', result: data });
      } else {
        setState({
          status: 'error',
          message: data.error ?? `Unexpected error (${res.status})`,
          partialLotId: data.partialLotId,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      setState({ status: 'error', message });
    }
  }, [form, userDid]);

  const handleReset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Success state
  if (state.status === 'success') {
    return (
      <div className="rounded-xl border border-green-800/60 bg-green-950/30 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-green-400 text-lg">✓</span>
          <p className="text-sm font-medium text-green-300">Receipt created</p>
        </div>
        <p className="text-xs text-green-500/80 font-mono break-all">
          {state.result.correlationId}
        </p>
        <p className="text-xs text-zinc-500">
          {form.quantity} {form.unit} {form.commodity} → {form.recipient}
        </p>
        <button
          onClick={handleReset}
          className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors underline underline-offset-2"
        >
          Record another delivery
        </button>
      </div>
    );
  }

  // Error state
  if (state.status === 'error') {
    return (
      <div className="rounded-xl border border-red-800/60 bg-red-950/30 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-red-400 text-lg">✕</span>
          <p className="text-sm font-medium text-red-300">Delivery failed</p>
        </div>
        <p className="text-xs text-red-400/80">{state.message}</p>
        {state.partialLotId && (
          <p className="text-xs text-zinc-500">
            Lot created ({state.partialLotId}) but receipt signing failed. Try again.
          </p>
        )}
        <button
          onClick={handleReset}
          className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  // Idle / confirming state — the delivery card
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white">Record Delivery</p>
        <span className="text-xs text-zinc-600">{form.date}</span>
      </div>

      {/* Recipient */}
      <div className="space-y-1">
        <label htmlFor="delivery-recipient" className="text-xs text-zinc-500">
          Customer
        </label>
        <input
          id="delivery-recipient"
          type="text"
          value={form.recipient}
          onChange={e => updateField('recipient', e.target.value)}
          className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          disabled={state.status === 'confirming'}
        />
      </div>

      {/* Commodity + Quantity + Unit — inline row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label htmlFor="delivery-commodity" className="text-xs text-zinc-500">
            Product
          </label>
          <input
            id="delivery-commodity"
            type="text"
            value={form.commodity}
            onChange={e => updateField('commodity', e.target.value)}
            className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
            disabled={state.status === 'confirming'}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="delivery-quantity" className="text-xs text-zinc-500">
            Quantity
          </label>
          <input
            id="delivery-quantity"
            type="number"
            min={1}
            value={form.quantity}
            onChange={e => updateField('quantity', Number(e.target.value))}
            className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
            disabled={state.status === 'confirming'}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="delivery-unit" className="text-xs text-zinc-500">
            Unit
          </label>
          <input
            id="delivery-unit"
            type="text"
            value={form.unit}
            onChange={e => updateField('unit', e.target.value)}
            className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
            disabled={state.status === 'confirming'}
          />
        </div>
      </div>

      {/* Date */}
      <div className="space-y-1">
        <label htmlFor="delivery-date" className="text-xs text-zinc-500">
          Date
        </label>
        <input
          id="delivery-date"
          type="date"
          value={form.date}
          onChange={e => updateField('date', e.target.value)}
          className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          disabled={state.status === 'confirming'}
        />
      </div>

      {/* Confirm button — THE gesture */}
      <button
        onClick={handleConfirm}
        disabled={state.status === 'confirming'}
        className="w-full rounded-lg bg-green-700 hover:bg-green-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-3 text-sm transition-colors"
      >
        {state.status === 'confirming' ? 'Recording…' : 'Confirm delivery'}
      </button>

      <p className="text-[10px] text-zinc-600 text-center">
        Creates a signed delivery receipt on Imajin
      </p>
    </div>
  );
}
