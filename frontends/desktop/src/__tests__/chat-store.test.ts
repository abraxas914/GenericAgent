// @vitest-environment node
import { describe, it, expect } from 'vitest';

import type { Message } from '../services/chat';
import { mergeMessages, PARTIAL_MSG_ID, replacePartialMessage } from '../lib/chat-messages';

function msg(id: string, role: Message['role'], content: string, createdAt: number): Message {
  return { id, role, content, status: 'completed', createdAt };
}

describe('mergeMessages', () => {
  it('merges new incoming messages into empty current', () => {
    const result = mergeMessages([], [msg('1', 'user', 'hi', 100)]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('deduplicates by id', () => {
    const existing = [msg('1', 'user', 'hi', 100)];
    const incoming = [msg('1', 'user', 'hi', 100), msg('2', 'assistant', 'hello', 200)];
    const result = mergeMessages(existing, incoming);
    expect(result).toHaveLength(2);
  });

  it('replaces local messages when server message matches content', () => {
    const current = [msg('local-123', 'user', 'hello', 100)];
    const incoming = [msg('server-1', 'user', 'hello', 100)];
    const result = mergeMessages(current, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('server-1');
  });

  it('keeps local messages that have no server match', () => {
    const current = [msg('local-123', 'user', 'unique text', 100)];
    const incoming = [msg('server-1', 'user', 'different text', 50)];
    const result = mergeMessages(current, incoming);
    expect(result).toHaveLength(2);
    expect(result.some((m) => m.id === 'local-123')).toBe(true);
  });

  it('removes old partial message before appending new one', () => {
    const current = [
      msg('1', 'user', 'q', 100),
      { id: PARTIAL_MSG_ID, role: 'assistant' as const, content: 'old partial', status: 'in_progress' as const, createdAt: 200 },
    ];
    const partial = msg('x', 'assistant', 'new partial', 300);
    const result = mergeMessages(current, [], partial);
    const partials = result.filter((m) => m.id === PARTIAL_MSG_ID);
    expect(partials).toHaveLength(1);
    expect(partials[0].content).toBe('new partial');
  });

  it('sorts by createdAt', () => {
    const current: Message[] = [];
    const incoming = [
      msg('3', 'assistant', 'C', 300),
      msg('1', 'user', 'A', 100),
      msg('2', 'assistant', 'B', 200),
    ];
    const result = mergeMessages(current, incoming);
    expect(result.map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('appends partial at the end', () => {
    const incoming = [msg('1', 'user', 'q', 100)];
    const partial = msg('p', 'assistant', 'typing...', 200);
    const result = mergeMessages([], incoming, partial);
    expect(result[result.length - 1].id).toBe(PARTIAL_MSG_ID);
    expect(result[result.length - 1].status).toBe('in_progress');
  });

  it('handles no partial gracefully', () => {
    const result = mergeMessages([msg('1', 'user', 'hi', 100)], [], undefined);
    expect(result.filter((m) => m.id === PARTIAL_MSG_ID)).toHaveLength(0);
  });
});

it('replaces only the streaming tail and preserves confirmed history order and identity', () => {
  const history = [msg('2', 'user', 'second', 200), msg('1', 'assistant', 'first', 100)];
  const current = [...history, msg('__partial__:session', 'assistant', 'old', 300)];
  const result = replacePartialMessage(current, msg('new', 'assistant', 'updated', 400), '__partial__:session');
  expect(result).toHaveLength(3);
  expect(result[0]).toBe(history[0]);
  expect(result[1]).toBe(history[1]);
  expect(result[2].content).toBe('updated');
  expect(current[2].content).toBe('old');
});


it('orders older pages with equal timestamps by their server sequence', () => {
  const current = [msg('3', 'assistant', 'C', 100), msg('4', 'user', 'D', 100)];
  const older = [msg('1', 'user', 'A', 100), msg('2', 'assistant', 'B', 100)];
  expect(mergeMessages(current, older).map((item) => item.id)).toEqual(['1', '2', '3', '4']);
});

it('replaces acknowledgement metadata with the canonical server attachment path', () => {
  const local = { ...msg('1', 'user', 'image', 100), images: [{ name: 'a.png', path: 'data:image/png;base64,AA' }] };
  const server = { ...local, images: [{ name: 'a.png', path: '/desktop_uploads/a.png' }] };
  expect(mergeMessages([local], [server])).toEqual([server]);
});

it('does not erase a rejected local send when history contains the same text', () => {
  const failed = { ...msg('local-1', 'user', 'repeat', 200), status: 'failed' as const };
  expect(mergeMessages([failed], [msg('1', 'user', 'repeat', 100)])).toHaveLength(2);
});
