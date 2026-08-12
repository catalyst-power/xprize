'use client';

/**
 * PendingSignatures — the pending-signatures inbox (xprize#74).
 *
 * The dashboard only ever queried the acting supplier's own lots; a
 * recipient named as *subject* on a delivery attestation had no way to see
 * it (observed in prod 2026-08-11: Debbie had zero visibility into a
 * delivery attestation naming her). This section lists attestations naming
 * the current session user as subject that are still `pending`, with a
 * Sign action per item — the piece that actually unblocks the two-party
 * flow, even before notifications exist.
 *
 * Data is fetched server-side in `page.tsx` (same pattern as `recentLots`)
 * via `getAttestationsBySubject({ subjectDid: user.did, status: 'pending' })`
 * — never from the browser directly (AGENTS.md §2).
 *
 * The Sign button POSTs to this app's own `/api/attestations/{id}/sign`
 * route, which countersigns via the kernel's
 * `POST /auth/api/attestations/countersign` (see `countersignAttestation`,
 * src/lib/kernel/attestations.ts, and `buildAppWitnessJws`,
 * src/lib/kernel/auth.ts, for the `witnessJws` it requires). On success the
 * page is refreshed (`router.refresh()`) so the now-bilateral attestation
 * drops out of the server-fetched pending set.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AttestationRecord } from '@/lib/kernel/attestations';

// ---------------------------------------------------------------------------
// Pure helpers — exported for testing
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  'supply.received': 'Delivery receipt',
  'supply.declared': 'Lot declaration',
};

/** Human-readable label for an attestation type; falls back to the raw type for unknown ones. */
export function attestationTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/** Short summary line for a pending attestation row — what it is and who's asking for a signature. */
export function attestationSummary(record: AttestationRecord): string {
  return `${attestationTypeLabel(record.type)} from ${record.issuerDid}`;
}

interface SignAttestationResult {
  id: string;
  cid: string | null;
  status: 'bilateral';
}

type RowState = { phase: 'idle' } | { phase: 'signing' } | { phase: 'error'; message: string };

// ---------------------------------------------------------------------------
// Sub-render
// ---------------------------------------------------------------------------

function PendingSignatureRow(
  props: Readonly<{ record: AttestationRecord; onSigned: () => void }>,
) {
  const { record, onSigned } = props;
  const [state, setState] = useState<RowState>({ phase: 'idle' });

  async function handleSign(): Promise<void> {
    setState({ phase: 'signing' });
    try {
      const res = await fetch(`/api/attestations/${encodeURIComponent(record.id)}/sign`, {
        method: 'POST',
      });
      const data = (await res.json()) as SignAttestationResult | { error?: string };
      if (!res.ok) {
        const message = (data as { error?: string }).error ?? `Sign failed (${res.status})`;
        setState({ phase: 'error', message });
        return;
      }
      onSigned();
    } catch {
      setState({ phase: 'error', message: 'Network error while signing' });
    }
  }

  const isSigning = state.phase === 'signing';

  return (
    <li
      data-testid="pending-signature-row"
      className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 space-y-2"
    >
      <div className="flex justify-between items-center gap-3">
        <div className="min-w-0">
          <p className="text-sm text-white truncate">{attestationSummary(record)}</p>
          <p className="text-xs text-zinc-500 font-mono break-all">{record.id}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleSign()}
          disabled={isSigning}
          className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-zinc-100 disabled:opacity-50 transition-colors"
        >
          {isSigning ? 'Signing…' : 'Sign'}
        </button>
      </div>
      {state.phase === 'error' && (
        <p className="text-xs text-red-400">{state.message}</p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PendingSignatures(props: Readonly<{ attestations: AttestationRecord[] }>) {
  const { attestations } = props;
  const router = useRouter();

  if (attestations.length === 0) return null;

  return (
    <section className="space-y-3" data-testid="pending-signatures">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
        Pending your signature
      </p>
      <ul className="space-y-2">
        {attestations.map((record) => (
          <PendingSignatureRow key={record.id} record={record} onSigned={() => router.refresh()} />
        ))}
      </ul>
    </section>
  );
}
