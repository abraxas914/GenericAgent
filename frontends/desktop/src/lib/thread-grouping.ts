import type { Message } from '../services/chat';
import { parseAgentContent, type ParsedSegment } from '../components/chat/agentProtocol';

export type SegmentStatus = 'running' | 'done';

export interface Turn {
  index: number;
  segments: ParsedSegment[];
  weight: number;
}

export type ThreadGroup =
  | { kind: 'turn'; userMsg: Message; assistantMsg: Message; turns: Turn[] }
  | { kind: 'standalone'; msg: Message };

const parsedMessages = new WeakMap<Message, {
  content: string;
  turnSegs: Message['turn_segs'];
  turns: Turn[];
}>();

// Messages are immutable store records. Weak keys release cached parses when a
// session is discarded; both grouping and rendering reuse the same result.
export function messageTurns(message: Message): Turn[] {
  const cached = parsedMessages.get(message);
  if (cached?.content === message.content && cached.turnSegs === message.turn_segs) {
    return cached.turns;
  }
  const source = message.turn_segs?.length
    ? message.turn_segs
    : message.content ? [message.content] : [];
  const turns = source.map((seg, index) => {
    const segments = parseAgentContent(seg);
    const weight = segments.reduce((acc, s) => acc + s.content.length, 0);
    return { index, segments, weight };
  });
  parsedMessages.set(message, { content: message.content, turnSegs: message.turn_segs, turns });
  return turns;
}

export function buildThreadGroups(messages: Message[]): ThreadGroup[] {
  const groups: ThreadGroup[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === 'user') {
      const next = messages[i + 1];
      if (next && next.role === 'assistant') {
        const turns = messageTurns(next);
        groups.push({ kind: 'turn', userMsg: msg, assistantMsg: next, turns });
        i += 2;
      } else {
        groups.push({ kind: 'standalone', msg });
        i++;
      }
    } else {
      if (msg.role === 'assistant') {
        const turns = messageTurns(msg);
        groups.push({
          kind: 'turn',
          userMsg: { id: '__synthetic__', role: 'user', content: '', status: 'completed' },
          assistantMsg: msg,
          turns,
        });
      } else {
        groups.push({ kind: 'standalone', msg });
      }
      i++;
    }
  }
  return groups;
}
