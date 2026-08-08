import { describe, it, expect } from 'vitest';
import { resolveConnectorState, connectorRowVariant } from './ConnectedServicesPanel';
import { REQUIRED_CONNECTORS } from './connectorRegistry';
import type { ConnectorStatus } from '@/lib/kernel/connectors';

const QUICKBOOKS = REQUIRED_CONNECTORS.find((c) => c.id === 'quickbooks');
const GEMINI = REQUIRED_CONNECTORS.find((c) => c.id === 'gemini');

if (!QUICKBOOKS || !GEMINI) {
  throw new Error('Test fixture setup: REQUIRED_CONNECTORS is missing an expected connector');
}

// ---------------------------------------------------------------------------
// resolveConnectorState
// ---------------------------------------------------------------------------

describe('resolveConnectorState', () => {
  it('marks a connector connected when the kernel reports it with the required scope', () => {
    const statuses: ConnectorStatus[] = [
      { id: 'quickbooks', connected: true, scopes: ['quickbooks:read', 'quickbooks:write'] },
    ];

    const state = resolveConnectorState(QUICKBOOKS, statuses);

    expect(state.connected).toBe(true);
    expect(state.checkFailed).toBe(false);
  });

  it('marks a connector not connected when the kernel reports connected without the required scope', () => {
    const statuses: ConnectorStatus[] = [
      { id: 'quickbooks', connected: true, scopes: ['quickbooks:read'] },
    ];

    const state = resolveConnectorState(QUICKBOOKS, statuses);

    expect(state.connected).toBe(false);
    expect(state.checkFailed).toBe(false);
  });

  it('marks a connector not connected when absent from the kernel response', () => {
    const state = resolveConnectorState(GEMINI, []);

    expect(state.connected).toBe(false);
    expect(state.checkFailed).toBe(false);
  });

  it('marks the check failed (never "not connected") when the status fetch itself failed', () => {
    const state = resolveConnectorState(QUICKBOOKS, null);

    expect(state.connected).toBe(false);
    expect(state.checkFailed).toBe(true);
  });

  it('resolves each required connector independently from a shared status list', () => {
    const statuses: ConnectorStatus[] = [
      { id: 'quickbooks', connected: true, scopes: ['quickbooks:write'] },
      { id: 'gemini', connected: false, scopes: [] },
    ];

    const qbState = resolveConnectorState(QUICKBOOKS, statuses);
    const geminiState = resolveConnectorState(GEMINI, statuses);

    expect(qbState.connected).toBe(true);
    expect(geminiState.connected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// connectorRowVariant
// ---------------------------------------------------------------------------

describe('connectorRowVariant', () => {
  it('returns "connected" when connected, regardless of level', () => {
    expect(connectorRowVariant({ connector: QUICKBOOKS, connected: true, checkFailed: false })).toBe(
      'connected',
    );
    expect(connectorRowVariant({ connector: GEMINI, connected: true, checkFailed: false })).toBe(
      'connected',
    );
  });

  it('returns "check-failed" when the status check failed, even if not connected', () => {
    expect(connectorRowVariant({ connector: QUICKBOOKS, connected: false, checkFailed: true })).toBe(
      'check-failed',
    );
  });

  it('returns "connect-button" for a not-connected user-level connector', () => {
    expect(
      connectorRowVariant({ connector: QUICKBOOKS, connected: false, checkFailed: false }),
    ).toBe('connect-button');
  });

  it('returns "org-admin" for a not-connected org-level connector', () => {
    expect(connectorRowVariant({ connector: GEMINI, connected: false, checkFailed: false })).toBe(
      'org-admin',
    );
  });
});
