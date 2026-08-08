import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getUserConnectorStatus,
  getOrgConnectorStatus,
  findConnectorStatus,
  hasRequiredScope,
} from './connectors';
import type { ConnectorStatus } from './connectors';

vi.mock('./client', () => ({
  fetchKernel: vi.fn(),
  fetchKernelAsOrg: vi.fn(),
}));

import { fetchKernel, fetchKernelAsOrg } from './client';

const mockFetchKernel = vi.mocked(fetchKernel);
const mockFetchKernelAsOrg = vi.mocked(fetchKernelAsOrg);

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okResponse(body: ConnectorStatus[]) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response);
}

function errorResponse(status: number, statusText: string) {
  return Promise.resolve({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({ error: statusText }),
  } as Response);
}

const STATUS_RESPONSE: ConnectorStatus[] = [
  { id: 'quickbooks', connected: true, scopes: ['quickbooks:read', 'quickbooks:write'] },
  { id: 'gemini', connected: false, scopes: [] },
];

// ---------------------------------------------------------------------------
// getUserConnectorStatus
// ---------------------------------------------------------------------------

describe('getUserConnectorStatus', () => {
  it('GETs /connections/api/connectors/status via fetchKernel, passing the caller-supplied attestationId', async () => {
    mockFetchKernel.mockReturnValue(okResponse(STATUS_RESPONSE));

    await getUserConnectorStatus('att-scott-123');

    expect(mockFetchKernel).toHaveBeenCalledOnce();
    const [path, opts, attestationId] = mockFetchKernel.mock.calls[0];
    expect(path).toBe('/connections/api/connectors/status');
    expect(opts?.method).toBe('GET');
    expect(attestationId).toBe('att-scott-123');
    expect(mockFetchKernelAsOrg).not.toHaveBeenCalled();
  });

  it('returns the parsed ConnectorStatus[] on success', async () => {
    mockFetchKernel.mockReturnValue(okResponse(STATUS_RESPONSE));

    const result = await getUserConnectorStatus('att-scott-123');

    expect(result).toEqual(STATUS_RESPONSE);
  });

  it('throws with status + statusText on a kernel error response', async () => {
    mockFetchKernel.mockReturnValue(errorResponse(403, 'Forbidden'));

    await expect(getUserConnectorStatus('att-scott-123')).rejects.toThrow(
      'connectors.status failed: 403',
    );
  });
});

// ---------------------------------------------------------------------------
// getOrgConnectorStatus
// ---------------------------------------------------------------------------

describe('getOrgConnectorStatus', () => {
  it('GETs /connections/api/connectors/status via fetchKernelAsOrg (org identity)', async () => {
    mockFetchKernelAsOrg.mockReturnValue(okResponse(STATUS_RESPONSE));

    await getOrgConnectorStatus();

    expect(mockFetchKernelAsOrg).toHaveBeenCalledOnce();
    const [path, opts] = mockFetchKernelAsOrg.mock.calls[0];
    expect(path).toBe('/connections/api/connectors/status');
    expect(opts?.method).toBe('GET');
    expect(mockFetchKernel).not.toHaveBeenCalled();
  });

  it('throws with status + statusText on a kernel error response', async () => {
    mockFetchKernelAsOrg.mockReturnValue(errorResponse(500, 'Internal Server Error'));

    await expect(getOrgConnectorStatus()).rejects.toThrow(
      'connectors.status (org) failed: 500',
    );
  });
});

// ---------------------------------------------------------------------------
// findConnectorStatus
// ---------------------------------------------------------------------------

describe('findConnectorStatus', () => {
  it('finds a connector by id', () => {
    const status = findConnectorStatus(STATUS_RESPONSE, 'quickbooks');
    expect(status?.connected).toBe(true);
  });

  it('returns undefined when the connector id is not present', () => {
    expect(findConnectorStatus(STATUS_RESPONSE, 'xero')).toBeUndefined();
  });

  it('returns undefined for an empty status list', () => {
    expect(findConnectorStatus([], 'quickbooks')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hasRequiredScope
// ---------------------------------------------------------------------------

describe('hasRequiredScope', () => {
  it('returns true when connected and the required scope is present', () => {
    const status: ConnectorStatus = { id: 'quickbooks', connected: true, scopes: ['quickbooks:write'] };
    expect(hasRequiredScope(status, 'quickbooks:write')).toBe(true);
  });

  it('returns false when connected but missing the required scope', () => {
    const status: ConnectorStatus = { id: 'quickbooks', connected: true, scopes: ['quickbooks:read'] };
    expect(hasRequiredScope(status, 'quickbooks:write')).toBe(false);
  });

  it('returns false when not connected even if scopes list is non-empty', () => {
    const status: ConnectorStatus = { id: 'quickbooks', connected: false, scopes: ['quickbooks:write'] };
    expect(hasRequiredScope(status, 'quickbooks:write')).toBe(false);
  });

  it('returns false when the status is undefined (connector missing from the kernel response)', () => {
    expect(hasRequiredScope(undefined, 'quickbooks:write')).toBe(false);
  });
});
