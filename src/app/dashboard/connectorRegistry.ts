/**
 * Connected Services registry — the connectors AgriFortress needs, declared
 * once (data change, not component-logic change, to add a future connector —
 * mirrors the registry-generic design of kernel #1540).
 *
 * Profile owns connector lifecycle (select / connect / OAuth / token
 * custody); this app only ever witnesses status and deep-links out
 * (AGENTS.md §2). See ConnectedServicesPanel.tsx for the render logic.
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
   * 'user'  — the acting supplier connects this on their own Imajin profile.
   * 'org'   — an org admin configures this once on AgriFortress's own
   *           profile; individual suppliers cannot self-serve it.
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
 * Build the deep-link that sends the supplier to their Imajin profile to
 * connect a missing connector, with a `returnTo` back to this app.
 * The profile owns connect/OAuth; this app only links out (AGENTS.md §2,
 * ima-jin/imajin-ai#1540 "Deep-link / returnTo").
 */
export function buildProfileConnectUrl(
  kernelUrl: string,
  connectorId: string,
  returnTo: string,
): string {
  const url = new URL(`${kernelUrl.replace(/\/$/, '')}/auth/connectors`);
  url.searchParams.set('connect', connectorId);
  url.searchParams.set('returnTo', returnTo);
  return url.toString();
}
