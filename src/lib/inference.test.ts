import { describe, it, expect, vi, afterEach } from 'vitest';
import { captureInference, confirmInference } from './inference';

vi.mock('./kernel/client', () => ({ fetchKernel: vi.fn() }));

import { fetchKernel } from './kernel/client';

const mockFetch = vi.mocked(fetchKernel);

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okResponse(body: object) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response);
}

function errorResponse(status: number, body: object) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(body),
  } as Response);
}

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

const CONFIRM_RESPONSE = {
  sessionId: 'sess_abc',
  status: 'resolved',
  attestationId: 'att_signed_123',
  intentType: 'supply.received',
  primitiveType: 'supply',
  externalId: 'ext_001',
  resolvedAt: '2026-07-25T12:00:00Z',
};

// ---------------------------------------------------------------------------
// captureInference
// ---------------------------------------------------------------------------

describe('captureInference', () => {
  it('POSTs to /api/inference/capture', async () => {
    mockFetch.mockReturnValue(okResponse(CAPTURE_RESPONSE));

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await captureInference(blob, 'voice.webm');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [path] = mockFetch.mock.calls[0];
    expect(path).toBe('/api/inference/capture');
  });

  it('sends method POST', async () => {
    mockFetch.mockReturnValue(okResponse(CAPTURE_RESPONSE));

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await captureInference(blob, 'voice.webm');

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts?.method).toBe('POST');
  });

  it('sends a FormData body', async () => {
    mockFetch.mockReturnValue(okResponse(CAPTURE_RESPONSE));

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await captureInference(blob, 'voice.webm');

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts?.body).toBeInstanceOf(FormData);
  });

  it('sets vocabulary=agrifortress in the FormData', async () => {
    mockFetch.mockReturnValue(okResponse(CAPTURE_RESPONSE));

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await captureInference(blob, 'voice.webm');

    const [, opts] = mockFetch.mock.calls[0];
    const form = opts?.body as FormData;
    expect(form.get('vocabulary')).toBe('agrifortress');
  });

  it('includes the file in the FormData', async () => {
    mockFetch.mockReturnValue(okResponse(CAPTURE_RESPONSE));

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await captureInference(blob, 'voice.webm');

    const [, opts] = mockFetch.mock.calls[0];
    const form = opts?.body as FormData;
    expect(form.get('file')).not.toBeNull();
  });

  it('includes the filename field when provided', async () => {
    mockFetch.mockReturnValue(okResponse(CAPTURE_RESPONSE));

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await captureInference(blob, 'voice.webm');

    const [, opts] = mockFetch.mock.calls[0];
    const form = opts?.body as FormData;
    expect(form.get('filename')).toBe('voice.webm');
  });

  it('omits the filename field when not provided', async () => {
    mockFetch.mockReturnValue(okResponse(CAPTURE_RESPONSE));

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await captureInference(blob);

    const [, opts] = mockFetch.mock.calls[0];
    const form = opts?.body as FormData;
    expect(form.get('filename')).toBeNull();
  });

  it('uses File.name as the effective filename when no filename arg provided', async () => {
    mockFetch.mockReturnValue(okResponse(CAPTURE_RESPONSE));

    const file = new File(['audio'], 'recording.webm', { type: 'audio/webm' });
    await captureInference(file);

    // Should not throw and should still send the file
    const [, opts] = mockFetch.mock.calls[0];
    const form = opts?.body as FormData;
    expect(form.get('file')).not.toBeNull();
  });

  it('returns the parsed InferenceCaptureResponse on success', async () => {
    mockFetch.mockReturnValue(okResponse(CAPTURE_RESPONSE));

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const result = await captureInference(blob, 'voice.webm');

    expect(result.sessionId).toBe('sess_abc');
    expect(result.status).toBe('pending_confirm');
    expect(result.candidateIntents).toHaveLength(1);
    expect(result.candidateIntents?.at(0)?.metadata.product).toBe('eggs');
  });

  it('throws with status + error message on kernel error response', async () => {
    mockFetch.mockReturnValue(errorResponse(400, { error: 'file is required' }));

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(captureInference(blob, 'voice.webm')).rejects.toThrow(
      'inference.capture failed: 400',
    );
  });
});

// ---------------------------------------------------------------------------
// confirmInference
// ---------------------------------------------------------------------------

describe('confirmInference', () => {
  it('POSTs to /api/inference/confirm/{sessionId}', async () => {
    mockFetch.mockReturnValue(okResponse(CONFIRM_RESPONSE));

    await confirmInference('sess_abc');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [path] = mockFetch.mock.calls[0];
    expect(path).toBe('/api/inference/confirm/sess_abc');
  });

  it('URL-encodes the sessionId', async () => {
    mockFetch.mockReturnValue(okResponse(CONFIRM_RESPONSE));

    await confirmInference('sess abc/x');

    const [path] = mockFetch.mock.calls[0];
    expect(path).toBe('/api/inference/confirm/sess%20abc%2Fx');
  });

  it('sends method POST', async () => {
    mockFetch.mockReturnValue(okResponse(CONFIRM_RESPONSE));

    await confirmInference('sess_abc');

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts?.method).toBe('POST');
  });

  it('returns the parsed InferenceConfirmResponse on success', async () => {
    mockFetch.mockReturnValue(okResponse(CONFIRM_RESPONSE));

    const result = await confirmInference('sess_abc');

    expect(result.sessionId).toBe('sess_abc');
    expect(result.status).toBe('resolved');
    expect(result.attestationId).toBe('att_signed_123');
  });

  it('throws with status + error message on kernel error response', async () => {
    mockFetch.mockReturnValue(errorResponse(404, { error: 'session not found' }));

    await expect(confirmInference('sess_abc')).rejects.toThrow(
      'inference.confirm failed: 404',
    );
  });
});
