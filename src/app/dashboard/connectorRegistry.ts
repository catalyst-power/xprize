/**
 * Connected Services registry — the connectors AgriFortress needs, declared
 * once (a data change, not a component-logic change, to add a future
 * connector).
 *
 * The app never manages connector lifecycle beyond initiating the OAuth
 * redirect on behalf of the acting user (AGENTS.md §2). Client credentials
 * (clientId/clientSecret/redirectUri) are the app's own, sealed in the app
 * DID's vault by the kernel (ima-jin/imajin-ai#1705) — never entered or held
 * by AgriFortress. See ConnectedServicesPanel.tsx for the render logic.
 */

export type ConnectorLevel = 'user' | 'org';

export interface RequiredConnector {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly description: string;
  /** The scope this app needs granted on the connector's connection. */
  readonly requiredScope: string;
  /**
   * 'user' — the acting supplier's own connection (e.g. QuickBooks). The app
   *          initiates the OAuth redirect in-app, app-auth `onBehalfOf` them.
   * 'org'  — an org admin configures this once on AgriFortress's own
   *          profile; individual suppliers cannot self-serve it.
   */
  readonly level: ConnectorLevel;
}

export const REQUIRED_CONNECTORS: readonly RequiredConnector[] = [
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    icon: '📒',
    description: 'Writes the settlement invoice when a delivery is confirmed.',
    requiredScope: 'quickbooks:write',
    level: 'user',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    icon: '✨',
    description: 'Powers photo/voice → intent inference for the delivery gesture.',
    requiredScope: 'gemini:infer',
    level: 'org',
  },
] as const;

/**
 * Build the href for the "Connect {name}" button on a user-level connector.
 * This points at AgriFortress's OWN API route, never directly at the kernel —
 * a plain browser navigation can't carry the app's Bearer token, so this
 * app's server-side route performs the app-auth'd kernel call and forwards
 * the resulting OAuth redirect (see src/app/api/connectors/[id]/connect).
 */
export function buildAppConnectHref(connectorId: string, returnTo: string): string {
  const params = new URLSearchParams({ returnTo });
  return `/api/connectors/${connectorId}/connect?${params.toString()}`;
}
