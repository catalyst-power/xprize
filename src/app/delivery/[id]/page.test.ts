import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import DeliveryPage from './page';
import { DeliveryReceipt } from '@/app/dashboard/DeliveryReceipt';

const mockGetSession = vi.mocked(getSession);
const mockRedirect = vi.mocked(redirect);

const SESSION_USER = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-123',
};

/** Walk a React element tree looking for an element of the given component type. */
function findElementOfType(node: unknown, type: unknown): { props?: Record<string, unknown> } | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementOfType(child, type);
      if (found) return found;
    }
    return undefined;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type) return element;
  return findElementOfType(element.props?.['children'], type);
}

// ---------------------------------------------------------------------------
// DeliveryPage — auth-gated the same way /dashboard is (xprize#76)
// ---------------------------------------------------------------------------

describe('DeliveryPage', () => {
  it('redirects to / when no session exists (auth-gated like /dashboard)', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(
      DeliveryPage({ params: Promise.resolve({ id: 'lot_abc123' }) }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  it('renders DeliveryReceipt with the route id as correlationId and the session attestationId', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);

    const element = await DeliveryPage({ params: Promise.resolve({ id: 'lot_abc123' }) });

    expect(mockRedirect).not.toHaveBeenCalled();
    const receipt = findElementOfType(element, DeliveryReceipt);
    expect(receipt).toBeDefined();
    expect(receipt?.props?.['correlationId']).toBe('lot_abc123');
    expect(receipt?.props?.['attestationId']).toBe(SESSION_USER.attestationId);
  });

  it('threads a different route id through verbatim as correlationId', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);

    const element = await DeliveryPage({ params: Promise.resolve({ id: 'lot_xyz789' }) });

    const receipt = findElementOfType(element, DeliveryReceipt);
    expect(receipt?.props?.['correlationId']).toBe('lot_xyz789');
  });
});
