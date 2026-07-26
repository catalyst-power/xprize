import { describe, it, expect } from 'vitest';
import { CONNECTORS, buildConnectUrl } from './ConnectorPicker';

// ---------------------------------------------------------------------------
// CONNECTORS registry
// ---------------------------------------------------------------------------

describe('CONNECTORS registry', () => {
  it('includes QuickBooks as a selectable connector', () => {
    const qb = CONNECTORS.find((c) => c.id === 'quickbooks');
    expect(qb).toBeDefined();
  });

  it('QuickBooks has the correct icon and name', () => {
    const qb = CONNECTORS.find((c) => c.id === 'quickbooks');
    expect(qb?.icon).toBe('📒');
    expect(qb?.name).toBe('QuickBooks');
  });

  it('QuickBooks carries both read and write scope labels', () => {
    const qb = CONNECTORS.find((c) => c.id === 'quickbooks');
    expect(qb?.scopes).toContain('quickbooks:read');
    expect(qb?.scopes).toContain('quickbooks:write');
  });

  it('QuickBooks points to the kernel connector DID', () => {
    const qb = CONNECTORS.find((c) => c.id === 'quickbooks');
    expect(qb?.connectorDid).toBe('did:imajin:quickbooks-connector');
  });

  it('QuickBooks uses the oauth ingestion pattern', () => {
    const qb = CONNECTORS.find((c) => c.id === 'quickbooks');
    expect(qb?.ingestionPattern).toBe('oauth');
  });

  it('each connector has a unique id (list key invariant)', () => {
    const ids = CONNECTORS.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('is a typed array so adding a connector is a data change only', () => {
    expect(Array.isArray(CONNECTORS)).toBe(true);
    expect(CONNECTORS.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// buildConnectUrl
// ---------------------------------------------------------------------------

describe('buildConnectUrl', () => {
  it('builds the correct kernel connect URL for quickbooks', () => {
    const url = buildConnectUrl('https://imajin.ai', 'quickbooks');
    expect(url).toBe('https://imajin.ai/quickbooks/api/connect');
  });

  it('strips a trailing slash from kernelUrl', () => {
    const url = buildConnectUrl('https://imajin.ai/', 'quickbooks');
    expect(url).toBe('https://imajin.ai/quickbooks/api/connect');
  });

  it('works for future connector IDs without code changes', () => {
    const url = buildConnectUrl('https://imajin.ai', 'xero');
    expect(url).toBe('https://imajin.ai/xero/api/connect');
  });

  it('Connect navigates to the correct URL (QuickBooks kernel connect route)', () => {
    // The connect button calls globalThis.location.assign(buildConnectUrl(kernelUrl, 'quickbooks')).
    // Verify the URL it would navigate to matches the kernel contract from #1210.
    const kernelUrl = 'https://imajin.ai';
    const navigateTo = buildConnectUrl(kernelUrl, 'quickbooks');
    expect(navigateTo).toBe(`${kernelUrl}/quickbooks/api/connect`);
  });
});

// ---------------------------------------------------------------------------
// Connected state discipline
// ---------------------------------------------------------------------------

describe('connected state discipline', () => {
  it('connectedId must match a known connector id to be meaningful', () => {
    // A fabricated / unknown connectedId should NOT match any connector.
    // The component resolves connectedConnector = CONNECTORS.find(c => c.id === connectedId).
    const unknown = CONNECTORS.find((c) => c.id === 'fabricated');
    expect(unknown).toBeUndefined();
  });

  it('real return signal (connected=quickbooks) resolves to QuickBooks connector', () => {
    const connectedId = 'quickbooks'; // as returned by ?connected=quickbooks
    const resolved = CONNECTORS.find((c) => c.id === connectedId);
    expect(resolved?.name).toBe('QuickBooks');
  });
});
