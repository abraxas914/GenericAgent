import type { Message } from '../services/chat';

export const PARTIAL_MSG_ID = '__partial__';

export function isPartialMessage(message: Message): boolean {
  return String(message.id) === PARTIAL_MSG_ID || String(message.id).startsWith(`${PARTIAL_MSG_ID}:`);
}

export function mergeMessages(
  current: Message[],
  incoming: Message[],
  partial?: Message,
  partialId: string = PARTIAL_MSG_ID,
): Message[] {
  const withoutPartial = current.filter((message) => !isPartialMessage(message));
  const localMessages = withoutPartial.filter((message) => String(message.id).startsWith('local-'));
  let merged = withoutPartial.filter((message) => !String(message.id).startsWith('local-'));

  const indices = new Map(merged.map((message, index) => [message.id, index]));
  for (const incomingMessage of incoming) {
    const existing = indices.get(incomingMessage.id);
    if (existing != null) {
      merged[existing] = incomingMessage;
      continue;
    }
    indices.set(incomingMessage.id, merged.length);
    const localIndex = localMessages.findIndex(
      (message) => message.status !== 'failed' && message.role === incomingMessage.role && message.content === incomingMessage.content,
    );
    if (localIndex >= 0) localMessages.splice(localIndex, 1);
    merged.push(incomingMessage);
  }

  merged = [...merged, ...localMessages];
  merged.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)
    || (/^\d+$/.test(a.id) && /^\d+$/.test(b.id) ? Number(a.id) - Number(b.id) : 0));

  if (partial) {
    merged.push({ ...partial, id: partialId, status: 'in_progress' });
  }
  return merged;
}

// Streaming updates only replace the tail; confirmed message order and identities stay stable.
export function replacePartialMessage(current: Message[], partial: Message, id: string): Message[] {
  return [...current.filter((message) => !isPartialMessage(message)), {
    ...partial, id, status: 'in_progress',
  }];
}
