/**
 * ConnectedServicesPanel — 'Connected Services' status panel.
 *
 * Replaces the old in-app connector configure form (xprize#36, consuming the
 * kernel's app-facing connector surface, ima-jin/imajin-ai#1540 + #1705):
 * the app never asks a user to type in their own clientId/clientSecret/
 * redirectUri — AgriFortress's own Intuit app registration is sealed in the
 * app DID's vault, and a supplier's tokens are sealed in their own DID's
 * vault once connected. This panel only ever witnesses live status and
 * (for QuickBooks) offers a "Connect QuickBooks" button that hands off to
 * the kernel's OAuth flow — the app never touches a token.
 *
 * Renders a live per-render read of the kernel's connectors/status endpoint
 * for each connector AgriFortress needs — never caches 'connected'
 * (AGENTS.md §4 claim boundary). Zero @imajin/* dependencies; the kernel is
 * reached only through app-auth HTTP calls (AGENTS.md §2).
 */

import {
  findConnectorStatus,
  getOrgConnectorStatus,
  getUserConnectorStatus,
  hasRequiredScope,
  type ConnectorStatus,
} from '@/lib/kernel/connectors';
import {
  REQUIRED_CONNECTORS,
  buildAppConnectHref,
  type ConnectorLevel,
  type RequiredConnector,
} from './connectorRegistry';

// ---------------------------------------------------------------------------
// Pure helpers — exported for testing
// ---------------------------------------------------------------------------

export interface ConnectorRenderState {
  readonly connector: RequiredConnector;
  readonly connected: boolean;
  /** True when the status check itself failed — never treated as "not connected". */
  readonly checkFailed: boolean;
}

/**
 * Pure projection from a fetched status list (or a fetch failure, `null`)
 * onto render state for one required connector. A failed check must never
 * be reported as "not connected" — that would be an app-fabricated claim
 * about a fact it couldn't actually observe (AGENTS.md §4).
 */
export function resolveConnectorState(
  connector: RequiredConnector,
  statuses: readonly ConnectorStatus[] | null,
): ConnectorRenderState {
  if (statuses === null) {
    return { connector, connected: false, checkFailed: true };
  }
  const status = findConnectorStatus(statuses, connector.id);
  return {
    connector,
    connected: hasRequiredScope(status, connector.requiredScope),
    checkFailed: false,
  };
}

export type ConnectorRowVariant = 'connected' | 'check-failed' | 'connect-button' | 'org-admin';

/** Map render state onto exactly one display variant (mutually exclusive by construction). */
export function connectorRowVariant(state: ConnectorRenderState): ConnectorRowVariant {
  if (state.connected) return 'connected';
  if (state.checkFailed) return 'check-failed';
  if (state.connector.level === 'org') return 'org-admin';
  return 'connect-button';
}

/** Fetch live status for one acting level, resolving to `null` on failure (fail-closed). */
async function fetchStatusesFor(level: ConnectorLevel): Promise<ConnectorStatus[] | null> {
  try {
    return level === 'user' ? await getUserConnectorStatus() : await getOrgConnectorStatus();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sub-render
// ---------------------------------------------------------------------------

function ConnectorStatusIndicator(
  props: Readonly<{ variant: ConnectorRowVariant; connector: RequiredConnector; connectHref: string }>,
) {
  const { variant, connector, connectHref } = props;

  if (variant === 'connected') {
    return (
      <span
        role="status"
        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-green-400 border border-green-800 bg-green-950/40"
      >
        ✅ {connector.name} connected
      </span>
    );
  }

  if (variant === 'check-failed') {
    return (
      <span className="shrink-0 text-[10px] text-amber-400 text-right max-w-[12rem]">
        Status unavailable — try again shortly.
      </span>
    );
  }

  if (variant === 'org-admin') {
    return (
      <span className="shrink-0 text-[10px] text-zinc-500 text-right max-w-[12rem]">
        Ask your org admin to configure {connector.name}.
      </span>
    );
  }

  return (
    <a
      href={connectHref}
      className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors"
    >
      Connect {connector.name}
    </a>
  );
}

function ConnectorRow(
  props: Readonly<{ state: ConnectorRenderState; returnTo: string }>,
) {
  const { state, returnTo } = props;
  const { connector } = state;
  const variant = connectorRowVariant(state);
  const connectHref = buildAppConnectHref(connector.id, returnTo);

  return (
    <li className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex items-start justify-between gap-3">
      <div className="space-y-1 min-w-0">
        <p className="text-sm font-medium text-white">
          {connector.icon} {connector.name}
        </p>
        <p className="text-xs text-zinc-400">{connector.description}</p>
      </div>

      <ConnectorStatusIndicator variant={variant} connector={connector} connectHref={connectHref} />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export async function ConnectedServicesPanel(
  props: Readonly<{ returnTo: string }>,
) {
  const { returnTo } = props;

  const levels = [...new Set(REQUIRED_CONNECTORS.map((connector) => connector.level))];
  const results = await Promise.all(levels.map((level) => fetchStatusesFor(level)));

  const statusByLevel = new Map<ConnectorLevel, ConnectorStatus[] | null>();
  for (const [index, level] of levels.entries()) {
    statusByLevel.set(level, results[index]);
  }

  const states = REQUIRED_CONNECTORS.map((connector) =>
    resolveConnectorState(connector, statusByLevel.get(connector.level) ?? null),
  );

  return (
    <section className="space-y-4" aria-label="Connected Services">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
        Connected Services
      </p>
      <ul className="space-y-3">
        {states.map((state) => (
          <ConnectorRow key={state.connector.id} state={state} returnTo={returnTo} />
        ))}
      </ul>
    </section>
  );
}
