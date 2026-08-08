import { describe, it, expect } from 'vitest';
import { REQUIRED_CONNECTORS, buildAppConnectHref } from './connectorRegistry';

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
// buildAppConnectHref
// ---------------------------------------------------------------------------

describe('buildAppConnectHref', () => {
  it('builds an in-app connect route href with a returnTo param', () => {
    const href = buildAppConnectHref('quickbooks', 'https://integrity.imajin.ai/dashboard');
    const parsed = new URL(href, 'https://integrity.imajin.ai');
    expect(parsed.pathname).toBe('/api/connectors/quickbooks/connect');
    expect(parsed.searchParams.get('returnTo')).toBe('https://integrity.imajin.ai/dashboard');
  });

  it('never points at the kernel directly — only this app\u2019s own route', () => {
    const href = buildAppConnectHref('quickbooks', 'https://app/dashboard');
    expect(href.startsWith('/api/connectors/')).toBe(true);
  });

  it('works for future connector ids without code changes', () => {
    const href = buildAppConnectHref('xero', 'https://app/dashboard');
    const parsed = new URL(href, 'https://app');
    expect(parsed.pathname).toBe('/api/connectors/xero/connect');
  });
});
