'use client';

import { useState, useCallback } from 'react';

interface Props {
  initialCustomer: string;
  initialCommodity: string;
  initialUnit: string;
  initialQuantity: number;
  initialDate: string;
}

interface Receipt {
  correlationId: string;
  customer: string;
  commodity: string;
  quantity: number;
  unit: string;
  date: string;
}

export function DeliveryCard({
  initialCustomer,
  initialCommodity,
  initialUnit,
  initialQuantity,
  initialDate,
}: Readonly<Props>) {
  const [customer, setCustomer] = useState(initialCustomer);
  const [commodity, setCommodity] = useState(initialCommodity);
  const [unit, setUnit] = useState(initialUnit);
  const [quantity, setQuantity] = useState(initialQuantity);
  const [date, setDate] = useState(initialDate);

  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const handleConfirm = useCallback(async () => {
    setStatus('submitting');
    setErrorMessage('');

    try {
      const res = await fetch('/api/delivery/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer, commodity, quantity, unit, date }),
      });

      const data = await res.json().catch(() => ({ error: 'Unexpected response' })) as
        | { ok: true; correlationId: string; customer: string; commodity: string; quantity: number; unit: string; date: string }
        | { error: string };

      if (!res.ok || !('ok' in data)) {
        const msg = 'error' in data ? data.error : `Request failed (${res.status})`;
        setErrorMessage(msg);
        setStatus('error');
        return;
      }

      setReceipt({
        correlationId: data.correlationId,
        customer: data.customer,
        commodity: data.commodity,
        quantity: data.quantity,
        unit: data.unit,
        date: data.date,
      });
      setStatus('success');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error');
      setStatus('error');
    }
  }, [customer, commodity, quantity, unit, date]);

  const handleReset = useCallback(() => {
    setStatus('idle');
    setReceipt(null);
    setErrorMessage('');
  }, []);

  const canSubmit = customer.trim().length > 0 && commodity.trim().length > 0 && unit.trim().length > 0 && quantity > 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Confirm delivery</h2>
        <span className="text-xs text-zinc-500">{date}</span>
      </div>

      {status === 'success' && receipt ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-4 py-3">
            <p className="text-sm font-medium text-emerald-300">Receipt created</p>
            <p className="text-xs text-emerald-400/70 font-mono mt-1">{receipt.correlationId}</p>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-zinc-500">Customer</dt>
              <dd className="text-zinc-200">{receipt.customer}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Commodity</dt>
              <dd className="text-zinc-200">{receipt.commodity}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Quantity</dt>
              <dd className="text-zinc-200">{receipt.quantity} {receipt.unit}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Date</dt>
              <dd className="text-zinc-200">{receipt.date}</dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={handleReset}
            className="w-full rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            Deliver another
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Customer */}
          <div className="space-y-1">
            <label htmlFor="delivery-customer" className="text-xs font-medium text-zinc-500">
              Customer
            </label>
            <input
              id="delivery-customer"
              type="text"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="e.g. Grace Harbour / David"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
            />
          </div>

          {/* Commodity */}
          <div className="space-y-1">
            <label htmlFor="delivery-commodity" className="text-xs font-medium text-zinc-500">
              Commodity
            </label>
            <input
              id="delivery-commodity"
              type="text"
              value={commodity}
              onChange={(e) => setCommodity(e.target.value)}
              placeholder="e.g. eggs"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
            />
          </div>

          {/* Quantity + Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="delivery-quantity" className="text-xs font-medium text-zinc-500">
                Quantity
              </label>
              <input
                id="delivery-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="delivery-unit" className="text-xs font-medium text-zinc-500">
                Unit
              </label>
              <input
                id="delivery-unit"
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="e.g. dozen"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Date */}
          <div className="space-y-1">
            <label htmlFor="delivery-date" className="text-xs font-medium text-zinc-500">
              Date
            </label>
            <input
              id="delivery-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
            />
          </div>

          {/* Error */}
          {status === 'error' && errorMessage && (
            <div className="rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3">
              <p className="text-sm text-red-300">{errorMessage}</p>
            </div>
          )}

          {/* Confirm */}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit || status === 'submitting'}
            className="w-full rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            {status === 'submitting' ? 'Confirming…' : 'Confirm delivery'}
          </button>
        </div>
      )}
    </div>
  );
}
