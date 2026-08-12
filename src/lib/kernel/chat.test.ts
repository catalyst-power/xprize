import { describe, it, expect, vi, afterEach } from 'vitest';
import { getOrCreateDirectConversation, sendChatMessage, sendDirectMessage } from './chat';

vi.mock('./client', () => ({ fetchKernel: vi.fn() }));

import { fetchKernel } from './client';

const mockFetchKernel = vi.mocked(fetchKernel);

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

function errorResponse(status: number, statusText: string, body?: object) {
  return Promise.resolve({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve(body ?? { error: statusText }),
  } as Response);
}

const CONVERSATION = { conversation: { did: 'did:imajin:conv:1' } };

// ---------------------------------------------------------------------------
// getOrCreateDirectConversation
// ---------------------------------------------------------------------------

describe('getOrCreateDirectConversation', () => {
  it('POSTs a direct conversation request to /chat/api/conversations via fetchKernel', async () => {
    mockFetchKernel.mockReturnValue(okResponse(CONVERSATION));

    await getOrCreateDirectConversation('did:imajin:david', 'att-scott-123');

    expect(mockFetchKernel).toHaveBeenCalledOnce();
    const [path, opts, attestationId] = mockFetchKernel.mock.calls[0];
    expect(path).toBe('/chat/api/conversations');
    expect(opts?.method).toBe('POST');
    expect(attestationId).toBe('att-scott-123');
    expect(JSON.parse(opts?.body as string)).toEqual({
      type: 'direct',
      participantDids: ['did:imajin:david'],
    });
  });

  it('returns the conversation DID on success', async () => {
    mockFetchKernel.mockReturnValue(okResponse(CONVERSATION));

    const result = await getOrCreateDirectConversation('did:imajin:david', 'att-scott-123');

    expect(result).toBe('did:imajin:conv:1');
  });

  it('throws with status + error message on a kernel error response', async () => {
    mockFetchKernel.mockReturnValue(errorResponse(403, 'Forbidden', { error: 'not connected' }));

    await expect(
      getOrCreateDirectConversation('did:imajin:david', 'att-scott-123'),
    ).rejects.toThrow('chat.conversations.create failed: 403 not connected');
  });
});

// ---------------------------------------------------------------------------
// sendChatMessage
// ---------------------------------------------------------------------------

describe('sendChatMessage', () => {
  it('POSTs a text message to /chat/api/conversations/{id}/messages via fetchKernel', async () => {
    mockFetchKernel.mockReturnValue(okResponse({ message: { id: 'msg_1' } }));

    await sendChatMessage('did:imajin:conv:1', 'hello', 'att-scott-123');

    expect(mockFetchKernel).toHaveBeenCalledOnce();
    const [path, opts, attestationId] = mockFetchKernel.mock.calls[0];
    expect(path).toBe('/chat/api/conversations/did%3Aimajin%3Aconv%3A1/messages');
    expect(opts?.method).toBe('POST');
    expect(attestationId).toBe('att-scott-123');
    expect(JSON.parse(opts?.body as string)).toEqual({
      content: { type: 'text', text: 'hello' },
      contentType: 'text',
    });
  });

  it('throws with status + error message on a kernel error response', async () => {
    mockFetchKernel.mockReturnValue(errorResponse(403, 'Forbidden', { error: 'Soft DID' }));

    await expect(
      sendChatMessage('did:imajin:conv:1', 'hello', 'att-scott-123'),
    ).rejects.toThrow('chat.messages.send failed: 403 Soft DID');
  });
});

// ---------------------------------------------------------------------------
// sendDirectMessage
// ---------------------------------------------------------------------------

describe('sendDirectMessage', () => {
  it('creates the direct conversation, then sends the message into it', async () => {
    mockFetchKernel
      .mockReturnValueOnce(okResponse(CONVERSATION))
      .mockReturnValueOnce(okResponse({ message: { id: 'msg_1' } }));

    await sendDirectMessage('did:imajin:david', 'hello', 'att-scott-123');

    expect(mockFetchKernel).toHaveBeenCalledTimes(2);
    const [firstPath] = mockFetchKernel.mock.calls[0];
    const [secondPath, secondOpts] = mockFetchKernel.mock.calls[1];
    expect(firstPath).toBe('/chat/api/conversations');
    expect(secondPath).toBe('/chat/api/conversations/did%3Aimajin%3Aconv%3A1/messages');
    expect(JSON.parse(secondOpts?.body as string).content).toEqual({ type: 'text', text: 'hello' });
  });

  it('propagates a failure to create the conversation without sending a message', async () => {
    mockFetchKernel.mockReturnValue(errorResponse(401, 'Unauthorized'));

    await expect(sendDirectMessage('did:imajin:david', 'hello', 'att-scott-123')).rejects.toThrow(
      'chat.conversations.create failed',
    );
    expect(mockFetchKernel).toHaveBeenCalledOnce();
  });

  it('propagates a failure to send the message once the conversation exists', async () => {
    mockFetchKernel
      .mockReturnValueOnce(okResponse(CONVERSATION))
      .mockReturnValueOnce(errorResponse(403, 'Forbidden', { error: 'Soft DID' }));

    await expect(sendDirectMessage('did:imajin:david', 'hello', 'att-scott-123')).rejects.toThrow(
      'chat.messages.send failed',
    );
  });
});
