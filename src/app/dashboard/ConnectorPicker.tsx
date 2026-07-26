'use client';

/**
 * ConnectorPicker — self-service connector config surface.
 *
 * Lets the supplier (Scott) select and authorise accounting/payment services.
 * The app navigates the browser to the kernel connector URL (full-page nav);
 * it does NOT hold OAuth tokens or exchange codes — that is kernel #1210's job.
 * Zero @imajin/* dependencies; the kernel connect route is invoked by URL only.
 *
 * Connected state is reflected ONLY on an actual return signal: the server
 * passes connectedId derived from the ?connected=<id> query param the kernel
 * redirects back with. Fabricated "connected" banners are forbidden
 * (AGENTS.md §4 claim boundary).
 *
 * Adding a future connector (Xero, Stripe, bank) is a data change: add one
 * entry to CONNECTORS below. No component logic changes required.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectorDef {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly description: string;
  readonly scopes: readonly string[];
  readonly connectorDid: string;
  readonly ingestionPattern: 'oauth';
}

// ---------------------------------------------------------------------------
// Registry — v0.1 static list; a public registry-list route does not exist yet.
// ---------------------------------------------------------------------------

export const CONNECTORS: readonly ConnectorDef[] = [
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    icon: '📒',
    description: 'Read/write your QuickBooks Online invoices',
    scopes: ['quickbooks:read', 'quickbooks:write'],
    connectorDid: 'did:imajin:quickbooks-connector',
    ingestionPattern: 'oauth',
  },
  // Future: { id: 'xero', name: 'Xero', ... }
  // Future: { id: 'stripe', name: 'Stripe', ... }
] as const;

// ---------------------------------------------------------------------------
// URL builder — exported for tests; pure function, no side effects.
// ---------------------------------------------------------------------------

export function buildConnectUrl(kernelUrl: string, connectorId: string): string {
  return `${kernelUrl.replace(/\/$/, '')}/${connectorId}/api/connect`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConnectorPicker(
  props: Readonly<{ kernelUrl: string; connectedId?: string }>,
) {
  const { kernelUrl, connectedId } = props;

  // Show the confirmation banner only when an actual return signal is present
  // (connectedId matches a known connector). Never display for unknown IDs.
  const connectedConnector =
    connectedId !== undefined
      ? CONNECTORS.find((c) => c.id === connectedId)
      : undefined;

  function handleConnect(connectorId: string): void {
    globalThis.location.assign(buildConnectUrl(kernelUrl, connectorId));
  }

  return (
    <section className="space-y-4" aria-label="Connections">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
        Connections
      </p>

      {connectedConnector !== undefined && (
        <div
          role="status"
          className="rounded-xl border border-green-800 bg-green-950/30 p-4"
        >
          <p className="text-sm font-medium text-green-400">
            Connected ✓ — {connectedConnector.name} is linked; invoices now flow to
            settlement.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {CONNECTORS.map((connector) => {
          const isConnected = connectedId === connector.id;

          return (
            <li
              key={connector.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-medium text-white">
                    {connector.icon} {connector.name}
                  </p>
                  <p className="text-xs text-zinc-400">{connector.description}</p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {connector.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 border border-zinc-700 bg-zinc-800"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleConnect(connector.id)}
                  className={[
                    'shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                    isConnected
                      ? 'border border-green-700 text-green-400 bg-green-950/40 hover:bg-green-900/40'
                      : 'border border-zinc-700 text-zinc-300 bg-zinc-800 hover:bg-zinc-700',
                  ].join(' ')}
                >
                  {isConnected ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
