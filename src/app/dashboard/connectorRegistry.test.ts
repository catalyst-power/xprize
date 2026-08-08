import { describe, it, expect } from 'vitest';
import { REQUIRED_CONNECTORS, buildProfileConnectUrl } from './connectorRegistry';

// ---------------------------------------------------------------------------
// REQUIRED_CONNECTORS registry
// ---------------------------------------------------------------------------

describe('REQUIRED_CONNECTORS registry', () => {
  it('declares QuickBooks as a user-level connector requiring quickbooks:write', () => {
    const qb = REQUIRED_CONNECTORS.find((c) => c.id === 'quickbooks');
    expect(qb?.requiredScope).toBe('quickbooks:write');
    expect(qb?.level).toBe('user');
  });

  it('declares Gemini as an org-level connector requiring gemini:infer', () => {
    const gemini = REQUIRED_CONNECTORS.find((c) => c.id === 'gemini');
    expect(gemini?.requiredScope).toBe('gemini:infer');
    expect(gemini?.level).toBe('org');
  });

  it('each connector has a unique id', () => {
    const ids = REQUIRED_CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is a typed array so adding a connector is a data change only', () => {
    expect(Array.isArray(REQUIRED_CONNECTORS)).toBe(true);
    expect(REQUIRED_CONNECTORS.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// buildProfileConnectUrl
// ---------------------------------------------------------------------------

describe('buildProfileConnectUrl', () => {
  it('builds the kernel profile-connect URL with connect and returnTo params', () => {
    const url = buildProfileConnectUrl(
      'https://imajin.ai',
      'quickbooks',
      'https://integrity.imajin.ai/dashboard',
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://imajin.ai/auth/connectors');
    expect(parsed.searchParams.get('connect')).toBe('quickbooks');
    expect(parsed.searchParams.get('returnTo')).toBe('https://integrity.imajin.ai/dashboard');
  });

  it('strips a trailing slash from kernelUrl', () => {
    const url = buildProfileConnectUrl('https://imajin.ai/', 'quickbooks', 'https://app/dashboard');
    expect(url.startsWith('https://imajin.ai/auth/connectors')).toBe(true);
  });

  it('works for future connector ids without code changes', () => {
    const url = buildProfileConnectUrl('https://imajin.ai', 'xero', 'https://app/dashboard');
    expect(new URL(url).searchParams.get('connect')).toBe('xero');
  });
});
