/**
 * /dashboard — the post-login home screen.
 *
 * Session is verified server-side via getSession(). Middleware provides a
 * first line of defence (cookie presence check); this page does full JWT
 * verification and handles the edge case where the cookie is present but
 * the token is invalid/expired.
 *
 * Layout (top → bottom):
 *   Header → User card → Connected Services (status only) → Delivery gesture | receipt
 *   → Pending Signatures (#74) → Recent Deliveries (#49) → Attestation
 *
 * Connected Services is a live status panel — it never asks the user to
 * configure connector credentials (the app owns those). It must NOT appear
 * inside the delivery gesture — friction gate (AGENTS.md §4). See
 * catalyst-power/xprize#36.
 *
 * After confirm, DeliveryGesture navigates to ?lot={correlationId}. This page
 * then renders DeliveryReceipt (server component, view-only) in its place. (#7)
 */

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { recentLots, getLotChain, collectRecipientDids, type LotChain, type RecentLot } from '@/lib/supply';
import { getConnections, type ConnectionEntry } from '@/lib/kernel/identity';
import { getAttestationsBySubject, type AttestationRecord } from '@/lib/kernel/attestations';
import { ConnectedServicesPanel } from './ConnectedServicesPanel';
import { DeliveryGesture } from './DeliveryGesture';
import { DeliveryReceipt } from './DeliveryReceipt';
import { ReminderTrigger } from './ReminderTrigger';
import { PendingSignatures } from './PendingSignatures';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// ---------------------------------------------------------------------------
// Pure helpers — exported for testing
// ---------------------------------------------------------------------------

/**
 * Read the `connect_error` flag set when a connector's own connect route
 * (e.g. /api/connectors/quickbooks/connect) redirects back here on failure
 * (xprize#46). Previously read but never surfaced, so failures were silent.
 */
export function resolveConnectError(
  searchParams: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = searchParams['connect_error'];
  return typeof raw === 'string' ? raw : undefined;
}

/** Human-readable label for a connector id, for display in the connect-error banner. */
export function connectErrorLabel(connectError: string): string {
  return connectError === 'quickbooks' ? 'QuickBooks' : connectError;
}

/**
 * Attestation types that may appear in the pending-signatures inbox (xprize#89).
 *
 * `getAttestationsBySubject` has no way to request more than one `type` at
 * once (the kernel's `type` query param takes a single value), and the
 * dashboard needs both delivery-lifecycle types, so the fetch stays
 * unfiltered and the allow-list is applied client-side instead. This is
 * also the fix for a kernel bug where `connection.invited` publishes
 * `subject = sender DID`: without this filter the sender sees their own
 * outgoing invite as a signable pending attestation. Connection-management
 * attestations (`connection.invited`, `app.authorized`, `app.revoked`) must
 * never reach the delivery-signing inbox.
 */
export const SIGNABLE_ATTESTATION_TYPES = ['supply.received', 'supply.declared'] as const;

/** Whether an attestation type belongs in the pending-signatures inbox (xprize#89). */
export function isSignableAttestationType(type: string): boolean {
  return (SIGNABLE_ATTESTATION_TYPES as readonly string[]).includes(type);
}

/**
 * Read the `invite_error` flag `DeliveryGesture` appends to the receipt
 * redirect URL when its best-effort connection invite (xprize#59) failed to
 * send (xprize#77). The delivery itself is unaffected — this is a small
 * non-blocking note, never a failure of the confirm outcome (claim
 * boundary, AGENTS.md §4).
 */
export function resolveInviteError(
  searchParams: Record<string, string | string[] | undefined>,
): boolean {
  return searchParams['invite_error'] === '1';
}

// ---------------------------------------------------------------------------
// Sub-render
// ---------------------------------------------------------------------------

export function ConnectErrorBanner(props: Readonly<{ connectError: string }>) {
  const { connectError } = props;
  return (
    <div
      data-testid="connect-error-banner"
      className="rounded-xl border border-red-800 bg-red-950/30 p-4 flex items-start justify-between"
    >
      <div>
        <p className="text-sm font-medium text-red-400">Connection failed</p>
        <p className="text-xs text-red-300 mt-1">
          Could not connect {connectErrorLabel(connectError)}. Please try again or contact your
          administrator.
        </p>
      </div>
      <a
        href="/dashboard"
        aria-label="Dismiss"
        className="shrink-0 pl-3 text-sm leading-none text-red-400 hover:text-red-200"
      >
        ×
      </a>
    </div>
  );
}

/**
 * Small, non-blocking note (xprize#77) shown on the receipt when the
 * best-effort connection invite (xprize#59) failed to send. Dismissing
 * re-navigates to the same receipt with `invite_error` dropped, rather than
 * losing the `?lot=` context like the connect-error banner's dismiss does.
 */
export function InviteErrorNotice(props: Readonly<{ dismissHref: string }>) {
  const { dismissHref } = props;
  return (
    <div
      data-testid="invite-error-notice"
      className="rounded-xl border border-amber-800 bg-amber-950/30 p-4 flex items-start justify-between"
    >
      <p className="text-xs text-amber-300">
        Invite could not be sent — the delivery was still recorded. Share the invite link with
        the recipient directly.
      </p>
      <a
        href={dismissHref}
        aria-label="Dismiss"
        className="shrink-0 pl-3 text-sm leading-none text-amber-300 hover:text-amber-100"
      >
        ×
      </a>
    </div>
  );
}

/**
 * Recent Deliveries — a read-only list of the supplier's most recent signed
 * lots (supply:read). Hidden entirely when there are no prior lots; renders
 * nothing else conditionally — every lot the kernel returns is shown (#49).
 */
export function RecentDeliveries(props: Readonly<{ lots: RecentLot[] }>) {
  const { lots } = props;
  if (lots.length === 0) return null;

  return (
    <section className="space-y-3" data-testid="recent-deliveries">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
        Recent Deliveries
      </p>
      <ul className="space-y-2">
        {lots.map((lot) => (
          <li
            key={lot.correlationId}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 flex justify-between items-center"
          >
            <div>
              <p className="text-sm text-white">{lot.commodity ?? 'Delivery'}</p>
              <p className="text-xs text-zinc-500">{lot.correlationId}</p>
            </div>
            <a
              href={`/dashboard?lot=${encodeURIComponent(lot.correlationId)}`}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              View →
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function DashboardPage(props: { searchParams: SearchParams }) {
  const [user, searchParams] = await Promise.all([getSession(), props.searchParams]);

  if (!user) {
    redirect('/');
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const returnTo = `${appUrl}/dashboard`;

  // Fetch the supplier's most recent lots (supply:read, read-only) and trust-graph
  // connections (connections:read, for the Recipient DID selector, xprize#55) once
  // up front, in parallel. Failure on either is non-fatal — the page renders with
  // an empty list/selector on any network/auth error rather than failing the whole
  // dashboard.
  const [recentLotsList, connections, pendingAttestations]: [RecentLot[], ConnectionEntry[], AttestationRecord[]] = await Promise.all([
    recentLots(user.did, user.attestationId, 5).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[dashboard] recentLots fetch failed:', message);
      return [];
    }),
    getConnections(user.attestationId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[dashboard] getConnections fetch failed:', message);
      return [];
    }),
    // Pending-signatures inbox (xprize#74) — attestations naming the current
    // user as *subject* that are awaiting their signature. Non-fatal on
    // failure, like every other dashboard fetch above.
    getAttestationsBySubject({ subjectDid: user.did, status: 'pending' }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[dashboard] getAttestationsBySubject fetch failed:', message);
      return [];
    }),
  ]);
  // xprize#89: the kernel's `type` query param only accepts a single value,
  // and connection-management attestations (`connection.invited`,
  // `app.authorized`, `app.revoked`) must never appear in the delivery-
  // signing inbox, so the allow-list is applied here rather than at the
  // fetch call above.
  const signablePendingAttestations = pendingAttestations.filter((record) =>
    isSignableAttestationType(record.type),
  );

  const priorLot: RecentLot | undefined = recentLotsList.at(0);

  // xprize#59: best-effort "active on AgriFortress" signal for the recipient
  // selector, scanned from the same bounded set of recent lot chains already
  // fetched above for Recent Deliveries — see `collectRecipientDids` (src/lib/supply.ts)
  // for why this is a heuristic, not an authoritative query. Any lot chain
  // fetch failure is non-fatal (just omitted from the scan, never a page error).
  const lotChains = await Promise.all(
    recentLotsList.map((lot) =>
      getLotChain(lot.correlationId, user.attestationId).catch((): LotChain | null => null),
    ),
  );
  const activeRecipientDids = [...collectRecipientDids(
    lotChains.filter((chain): chain is LotChain => chain !== null),
  )];

  const rawLot = searchParams['lot'];
  const lotId = typeof rawLot === 'string' ? rawLot : undefined;
  const connectError = resolveConnectError(searchParams);
  const inviteError = resolveInviteError(searchParams);
  const receiptDismissHref = lotId !== undefined ? `/dashboard?lot=${encodeURIComponent(lotId)}` : '/dashboard';

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-6">
      <div className="max-w-2xl mx-auto space-y-8">

        {/* Reminder ladder (xprize#75) — fire-and-forget check on every dashboard load, the closest this app gets to cron. */}
        <ReminderTrigger />

        {/* Header */}
        <header className="flex items-center justify-between pt-4">
          <h1 className="text-lg font-semibold text-white">AgriFortress</h1>
          <a
            href="/api/auth/logout"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Sign out
          </a>
        </header>

        {/* Connect error — surfaced from a connector's connect route redirect (#46) */}
        {connectError !== undefined && <ConnectErrorBanner connectError={connectError} />}

        {/* Invite failed — best-effort connection invite (xprize#59) send failure, non-blocking (xprize#77) */}
        {inviteError && <InviteErrorNotice dismissHref={receiptDismissHref} />}

        {/* User card */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-1">
          <p className="text-base font-medium text-white">
            {user.displayName}
          </p>
          <p className="text-sm text-zinc-400">@{user.handle}</p>
          <p className="text-xs text-zinc-600 font-mono break-all pt-1">{user.did}</p>
        </section>

        {/* Connected Services — live status only; the app owns connector credentials (#36) */}
        <ConnectedServicesPanel returnTo={returnTo} />

        {/* Delivery gesture → receipt: gesture signs supply.received; receipt renders from it (#7) */}
        {lotId !== undefined
          ? <DeliveryReceipt correlationId={lotId} attestationId={user.attestationId} />
          : (
            <DeliveryGesture
              priorLot={priorLot}
              connections={connections}
              activeRecipientDids={activeRecipientDids}
            />
          )}

        {/* Pending signatures — attestations naming the current user as subject, awaiting their
            signature, restricted to signable supply types (#74, #89) */}
        <PendingSignatures attestations={signablePendingAttestations} />

        {/* Recent Deliveries — read-only list of the supplier's most recent signed lots (#49) */}
        <RecentDeliveries lots={recentLotsList} />

        {/* Auth debug */}
        <section className="rounded-xl border border-zinc-800/60 p-4">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Attestation
          </p>
          <p className="text-xs text-zinc-600 font-mono break-all">{user.attestationId}</p>
        </section>

      </div>
    </div>
  );
}
