import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/inference', () => ({ captureInference: vi.fn() }));

import { getSession } from '@/lib/session';
import { captureInference } from '@/lib/inference';

const mockGetSession = vi.mocked(getSession);
const mockCapture = vi.mocked(captureInference);

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_USER = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-1',
};

const CAPTURE_RESPONSE = {
  sessionId: 'sess_abc',
  assetId: 'asset_xyz',
  status: 'pending_confirm',
  candidateIntents: [
    {
      intentType: 'supply.received',
      metadata: { product: 'eggs', qty: 6, unit: 'dozen', recipient: 'Dave' },
    },
  ],
};

function makeRequestWithFile(filename?: string) {
  const form = new FormData();
  form.append('file', new File(['audio'], 'voice.webm', { type: 'audio/webm' }), 'voice.webm');
  if (filename !== undefined) {
    form.append('filename', filename);
  }
  return new NextRequest('http://localhost/api/inference/capture', {
    method: 'POST',
    body: form,
  });
}

function makeRequestWithoutFile() {
  const form = new FormData();
  // omit the file field
  return new NextRequest('http://localhost/api/inference/capture', {
    method: 'POST',
    body: form,
  });
}

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

describe('POST /api/inference/capture — auth', () => {
  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(makeRequestWithFile());

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('POST /api/inference/capture — validation', () => {
  it('returns 400 when file field is absent', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);

    const res = await POST(makeRequestWithoutFile());

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('file');
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /api/inference/capture — success', () => {
  it('returns 200 with the capture response', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCapture.mockResolvedValue(CAPTURE_RESPONSE);

    const res = await POST(makeRequestWithFile());

    expect(res.status).toBe(200);
    const body = await res.json() as typeof CAPTURE_RESPONSE;
    expect(body.sessionId).toBe('sess_abc');
    expect(body.status).toBe('pending_confirm');
    expect(body.candidateIntents).toHaveLength(1);
  });

  it('forwards the optional filename to captureInference', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCapture.mockResolvedValue(CAPTURE_RESPONSE);

    await POST(makeRequestWithFile('my-photo.jpg'));

    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(File),
      'my-photo.jpg',
    );
  });

  it('passes undefined filename to captureInference when not provided', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCapture.mockResolvedValue(CAPTURE_RESPONSE);

    await POST(makeRequestWithFile());

    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(File),
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// Kernel failure
// ---------------------------------------------------------------------------

describe('POST /api/inference/capture — kernel failure', () => {
  it('returns 502 when captureInference throws', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCapture.mockRejectedValue(
      new Error('inference.capture failed: 503 Service Unavailable'),
    );

    const res = await POST(makeRequestWithFile());

    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('inference.capture failed');
  });
});
