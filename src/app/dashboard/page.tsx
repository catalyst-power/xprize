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
 * Connected Services is a live status panel — it never manages connector
 * lifecycle (select/connect/OAuth). It must NOT appear inside the delivery
 * gesture — friction gate (AGENTS.md §4). See ima-jin/imajin-ai#1540 and
 * catalyst-power/xprize#36 (this supersedes the in-app connect flow from #6).
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

export default async function DashboardPage(props: { searchParams: SearchParams }) {
  const [user, searchParams] = await Promise.all([getSession(), props.searchParams]);

  if (!user) {
    redirect('/');
  }

  const kernelUrl = (process.env.KERNEL_URL ?? 'https://imajin.ai').replace(/\/$/, '');
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const returnTo = `${appUrl}/dashboard`;

  // Pre-fill the delivery card from the supplier's most recent lot (supply:read, read-only).
  // Failure is non-fatal — the card renders with blank defaults on any network/auth error.
  const priorLot: RecentLot | undefined = (await recentLots(user.did, 1).catch(() => [])).at(0);

  const rawLot = searchParams['lot'];
  const lotId = typeof rawLot === 'string' ? rawLot : undefined;

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

        {/* User card */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-1">
          <p className="text-base font-medium text-white">
            {user.displayName}
          </p>
          <p className="text-sm text-zinc-400">@{user.handle}</p>
          <p className="text-xs text-zinc-600 font-mono break-all pt-1">{user.did}</p>
        </section>

        {/* Connected Services — live status only; profile owns connector lifecycle (#36) */}
        <ConnectedServicesPanel kernelUrl={kernelUrl} returnTo={returnTo} />

        {/* Delivery gesture → receipt: gesture signs supply.received; receipt renders from it (#7) */}
        {lotId !== undefined
          ? <DeliveryReceipt correlationId={lotId} />
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
