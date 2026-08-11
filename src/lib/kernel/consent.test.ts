import { describe, it, expect } from 'vitest';
import { buildConsentUrl, AGRIFORTRESS_SCOPES } from './consent';

describe('AGRIFORTRESS_SCOPES', () => {
  it('contains the full set of scopes the app requires', () => {
    const scopes = [...AGRIFORTRESS_SCOPES];
    expect(scopes).toContain('supply:read');
    expect(scopes).toContain('supply:write');
    expect(scopes).toContain('profile:read');
    expect(scopes).toContain('media:read');
    expect(scopes).toContain('media:write');
    expect(scopes).toContain('quickbooks:read');
    expect(scopes).toContain('quickbooks:write'); // receiver confirmation writes invoice on supplier's behalf
    expect(scopes).toContain('connectors:read-status'); // Connected Services panel (#1540)
    expect(scopes).toContain('connections:read'); // Recipient DID selector (#55)
    expect(scopes).toContain('infer:provide'); // Gemini inference pipeline
    expect(scopes).toHaveLength(10);
  });
});

describe('buildConsentUrl', () => {
  it('uses the default kernel URL when not specified', () => {
    const url = buildConsentUrl({ appId: 'app_test' });
    expect(url).toContain('https://imajin.ai/auth/authorize');
  });

  it('sets app_id in the query string', () => {
    const url = buildConsentUrl({ appId: 'app_abc123' });
    expect(new URL(url).searchParams.get('app_id')).toBe('app_abc123');
  });

  it('defaults to AGRIFORTRESS_SCOPES when scopes are not provided', () => {
    const url = buildConsentUrl({ appId: 'app_abc123' });
    const scopes = new URL(url).searchParams.get('scopes');
    expect(scopes).toBe(AGRIFORTRESS_SCOPES.join(','));
  });

  it('uses a custom kernel URL', () => {
    const url = buildConsentUrl({ appId: 'app_x', kernelUrl: 'https://dev.imajin.ai' });
    expect(url).toContain('https://dev.imajin.ai/auth/authorize');
  });

  it('strips a trailing slash from the kernel URL', () => {
    const url = buildConsentUrl({ appId: 'app_x', kernelUrl: 'https://imajin.ai/' });
    expect(url).not.toContain('//auth');
  });

  it('accepts custom scopes', () => {
    const url = buildConsentUrl({ appId: 'app_x', scopes: ['supply:read'] });
    expect(new URL(url).searchParams.get('scopes')).toBe('supply:read');
  });

  it('omits the scopes param when the scopes array is empty', () => {
    const url = buildConsentUrl({ appId: 'app_x', scopes: [] });
    expect(new URL(url).searchParams.has('scopes')).toBe(false);
  });

  it('encodes scopes so the kernel can decode them correctly', () => {
    const url = buildConsentUrl({ appId: 'app_x', scopes: ['supply:read', 'supply:write'] });
    // URLSearchParams encodes : and , — verify round-trip decoding works
    const decoded = new URL(url).searchParams.get('scopes');
    expect(decoded?.split(',')).toEqual(['supply:read', 'supply:write']);
  });
});
