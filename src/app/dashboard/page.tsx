/**
 * /dashboard — the post-login home screen.
 *
 * Session is verified server-side via getSession(). Middleware provides a
 * first line of defence (cookie presence check); this page does full JWT
 * verification and handles the edge case where the cookie is present but
 * the token is invalid/expired.
 */

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { DeliveryGesture } from './DeliveryGesture';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getSession();

  if (!user) {
    redirect('/');
  }

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

        {/* AI-native delivery gesture */}
        <DeliveryGesture />

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
