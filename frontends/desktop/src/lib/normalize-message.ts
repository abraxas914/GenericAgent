import type { Message, MessageStatus } from '../services/chat';

export function normalizeMessage(msg: Record<string, unknown>, status: MessageStatus = 'completed'): Message {
  // Bridge timestamps (`ts`, `createdAt`) are Unix seconds (Python time.time()).
  // The UI works in milliseconds (Date.now(), LiveDuration), so scale up. Local
  // optimistic messages are already ms and never pass through here.
  const rawTs = (msg.createdAt as number) ?? (msg.ts as number);
  const m: Message = {
    id: String(msg.id),
    role: msg.role as Message['role'],
    content: (msg.content as string) || '',
    status: (msg.status as MessageStatus) ?? status,
    createdAt: typeof rawTs === 'number' ? Math.round(rawTs * 1000) : undefined,
  };
  if (Array.isArray(msg.turn_segs)) {
    m.turn_segs = msg.turn_segs as string[];
  }
  if (Array.isArray(msg.images) && msg.images.length > 0) {
    m.images = msg.images as { name: string; path: string }[];
  }
  if (Array.isArray(msg.files) && msg.files.length > 0) {
    m.files = msg.files as { name: string; path: string; size?: number }[];
  }
  // executionMs is already in milliseconds (bridge computes it at turn end).
  if (typeof msg.executionMs === 'number') {
    m.executionMs = msg.executionMs;
  }
  return m;
}
