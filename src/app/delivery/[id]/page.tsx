/**
 * /delivery/[id] — standalone, shareable/linkable delivery receipt route.
 *
 * Wraps the existing `DeliveryReceipt` server component (already used inline
 * at /dashboard?lot={correlationId}) in its own route so a signed delivery
 * receipt has a durable URL that isn't tied to dashboard navigation state —
 * this becomes the link target for notifications (#73) and reminders (#75).
 *
 * `id` is the lot's `correlationId` — the same `externalId` DeliveryGesture
 * navigates to via `/dashboard?lot={correlationId}` on confirm, and the same
 * value `getLotChain()` expects. `DeliveryReceipt` itself is reused verbatim,
 * never duplicated.
 *
 * Auth-gated the same way /dashboard is: session verified server-side via
 * getSession(); a visitor without a valid session is redirected to sign in.
 *
 * Issue: catalyst-power/xprize#76
 */

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { DeliveryReceipt } from '@/app/dashboard/DeliveryReceipt';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export default async function DeliveryPage(props: { params: Params }) {
  const [user, { id }] = await Promise.all([getSession(), props.params]);

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
            href="/dashboard"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Back to dashboard
          </a>
        </header>

        <DeliveryReceipt correlationId={id} attestationId={user.attestationId} />
      </div>
    </div>
  );
}
