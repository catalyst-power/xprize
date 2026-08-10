import { redirect } from 'next/navigation';
import { buildConsentUrl } from '@/lib/kernel/consent';
import { getSession } from '@/lib/session';

const AUTH_ERRORS: Record<string, string> = {
  missing_params:      'Authorization cancelled — missing parameters.',
  attestation_revoked: 'Your authorization has been revoked. Please sign in again.',
  profile_fetch_failed:'Could not load your profile. Please try again.',
  network_error:       'A network error occurred. Please try again.',
  denied:              'You denied access. Sign in again when ready.',
};

interface Props {
  searchParams: Promise<{ auth_error?: string }>;
}

// Previously this page always showed "Sign in with Imajin", even for a
// visitor with a still-valid session cookie (xprize#53). A session check
// here is a redirect-only read of getSession() — it does not mint, refresh,
// or otherwise mutate the session; the dashboard remains the sole page that
// gates its own access.
export default async function Home({ searchParams }: Props) {
  const user = await getSession();
  if (user) {
    redirect('/dashboard');
  }

  const { auth_error } = await searchParams;
  const errorMessage = auth_error ? (AUTH_ERRORS[auth_error] ?? 'Sign-in failed. Please try again.') : null;

  const appId     = process.env.APP_ID;
  const kernelUrl = process.env.KERNEL_URL ?? 'https://imajin.ai';
  const consentUrl = appId ? buildConsentUrl({ appId, kernelUrl }) : null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
      <main className="max-w-md w-full space-y-8 text-center">
        {/* Wordmark */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            AgriFortress
          </h1>
          <p className="text-sm text-zinc-400">
            Farm-to-farm supply chain — provably yours.
          </p>
        </div>

        {/* Error banner */}
        {errorMessage && (
          <div className="rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3">
            <p className="text-sm text-red-300">{errorMessage}</p>
          </div>
        )}

        {/* Sign in */}
        {consentUrl ? (
          <a
            href={consentUrl}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            Sign in with Imajin
          </a>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <p className="text-xs text-zinc-500">
              App not yet registered.{' '}
              <code className="text-zinc-400">APP_ID</code> env var is missing.
              Run <code className="text-zinc-400">node scripts/generate-keypair.mjs</code> to get started.
            </p>
          </div>
        )}

        {/* Tagline */}
        <p className="text-xs text-zinc-600">
          Powered by{' '}
          <a href="https://imajin.ai" className="text-zinc-500 hover:text-zinc-400 underline underline-offset-2">
            Imajin
          </a>
          {' '}· XPRIZE Build with Gemini 2026
        </p>
      </main>
    </div>
  );
}
