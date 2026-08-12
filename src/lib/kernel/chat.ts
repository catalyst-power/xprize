/**
 * Kernel chat client for AgriFortress — the counterparty-notification "first
 * rail" (xprize#73): a direct-message conversation between the acting
 * supplier and one of their trust-graph connections.
 *
 * Reference: https://jin.imajin.ai/chat/api/spec
 *   POST /api/conversations                 — create/get a direct conversation
 *   POST /api/conversations/{id}/messages   — send a message into it
 */

import { fetchKernel } from './client';

const CONVERSATIONS_PATH = '/chat/api/conversations';

interface ConversationV2 {
  did: string;
}

interface CreateConversationResponse {
  conversation: ConversationV2;
}

/** Get or create the direct (1:1) conversation with `recipientDid`. */
export async function getOrCreateDirectConversation(
  recipientDid: string,
  attestationId: string,
): Promise<string> {
  const res = await fetchKernel(
    CONVERSATIONS_PATH,
    {
      method: 'POST',
      body: JSON.stringify({ type: 'direct', participantDids: [recipientDid] }),
    },
    attestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(
      `chat.conversations.create failed: ${res.status} ${data.error ?? res.statusText}`,
    );
  }

  const body = await res.json() as CreateConversationResponse;
  return body.conversation.did;
}

/** Send a plain-text message into an existing conversation. */
export async function sendChatMessage(
  conversationDid: string,
  text: string,
  attestationId: string,
): Promise<void> {
  const res = await fetchKernel(
    `${CONVERSATIONS_PATH}/${encodeURIComponent(conversationDid)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ content: { type: 'text', text }, contentType: 'text' }),
    },
    attestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(
      `chat.messages.send failed: ${res.status} ${data.error ?? res.statusText}`,
    );
  }
}

/** Send a direct-message text to `recipientDid`, creating the 1:1 conversation if needed. */
export async function sendDirectMessage(
  recipientDid: string,
  text: string,
  attestationId: string,
): Promise<void> {
  const conversationDid = await getOrCreateDirectConversation(recipientDid, attestationId);
  await sendChatMessage(conversationDid, text, attestationId);
}
