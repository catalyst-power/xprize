/**
 * /dashboard — the post-login home screen.
 *
 * Session is verified server-side via getSession(). Middleware provides a
 * first line of defence (cookie presence check); this page does full JWT
 * verification and handles the edge case where the cookie is present but
 * the token is invalid/expired.
 *
 * Layout (top → bottom):
 *   Header → User card → Connected Services (status only) → Delivery gesture | receipt → Attestation
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
import { recentLots, type RecentLot } from '@/lib/supply';
import { ConnectedServicesPanel } from './ConnectedServicesPanel';
import { DeliveryGesture } from './DeliveryGesture';
import { DeliveryReceipt } from './DeliveryReceipt';

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

export default async function DashboardPage(props: { searchParams: SearchParams }) {
  const [user, searchParams] = await Promise.all([getSession(), props.searchParams]);

  if (!user) {
    redirect('/');
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const returnTo = `${appUrl}/dashboard`;

  // Pre-fill the delivery card from the supplier's most recent lot (supply:read, read-only).
  // Failure is non-fatal — the card renders with blank defaults on any network/auth error.
  const priorLot: RecentLot | undefined = (
    await recentLots(user.did, user.attestationId, 1).catch(() => [])
  ).at(0);

  const rawLot = searchParams['lot'];
  const lotId = typeof rawLot === 'string' ? rawLot : undefined;
  const connectError = resolveConnectError(searchParams);

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-6">
      <div className="max-w-2xl mx-auto space-y-8">

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
          : <DeliveryGesture priorLot={priorLot} />}

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
