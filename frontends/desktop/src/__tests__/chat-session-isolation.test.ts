// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollResult, SessionInfo } from '../services/chat';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  sendPrompt: vi.fn(),
  pollMessages: vi.fn(),
  cancelGeneration: vi.fn(),
  listSessions: vi.fn(() => Promise.resolve([] as SessionInfo[])),
  deleteSession: vi.fn(),
  renameSession: vi.fn(),
  pinSession: vi.fn(),
  setSessionModel: vi.fn(),
  wsHandlers: new Map<string, (payload: unknown) => void>(),
  setLiveModel: vi.fn(),
}));

vi.mock('../services/chat', () => ({
  createSession: mocks.createSession,
  sendPrompt: mocks.sendPrompt,
  pollMessages: mocks.pollMessages,
  cancelGeneration: mocks.cancelGeneration,
  listSessions: mocks.listSessions,
  deleteSession: mocks.deleteSession,
  renameSession: mocks.renameSession,
  pinSession: mocks.pinSession,
  setSessionModel: mocks.setSessionModel,
}));

vi.mock('../services/ws', () => ({
  subscribe: (type: string, handler: (payload: unknown) => void) => {
    mocks.wsHandlers.set(type, handler);
    return () => mocks.wsHandlers.delete(type);
  },
  onBridgeStatusChange: vi.fn(),
}));

vi.mock('../stores/settings', () => ({
  useSettingsStore: {
    getState: () => ({ setLiveModel: mocks.setLiveModel }),
  },
}));

import { __resetChatStoreForTests, useChatStore } from '../stores/chat';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function result(
  sessionId: string,
  status: PollResult['status'] = 'idle',
  llmNo?: number,
): PollResult {
  return {
    messages: [{
      id: `${sessionId}-message`,
      role: 'assistant',
      content: sessionId,
      status: 'completed',
      createdAt: 1,
    }],
    status,
    model: llmNo == null ? undefined : {
      isMixin: false,
      current: `model-${llmNo}`,
      llmNo,
      runningLlmNo: status === 'running' ? llmNo : null,
      runningModel: status === 'running' ? `model-${llmNo}` : null,
    },
  };
}

async function flushPromises() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('session-scoped chat runtime', () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = new Map();
    nextRafId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextRafId;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id);
    });

    for (const mock of [
      mocks.createSession,
      mocks.sendPrompt,
      mocks.pollMessages,
      mocks.cancelGeneration,
      mocks.deleteSession,
      mocks.renameSession,
      mocks.pinSession,
      mocks.setSessionModel,
      mocks.setLiveModel,
    ]) mock.mockReset();
    mocks.listSessions.mockReset();
    mocks.listSessions.mockResolvedValue([]);
    mocks.deleteSession.mockResolvedValue(undefined);
    mocks.sendPrompt.mockResolvedValue('message-id');
    __resetChatStoreForTests();
  });

  afterEach(() => {
    __resetChatStoreForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps A and B loads in their own buckets when responses arrive out of order', async () => {
    const loadA = deferred<PollResult>();
    const loadB = deferred<PollResult>();
    mocks.pollMessages.mockImplementation((sessionId: string) =>
      sessionId === 'A' ? loadA.promise : loadB.promise,
    );

    useChatStore.getState().setActiveSession('A');
    useChatStore.getState().setActiveSession('B');

    loadB.resolve(result('B'));
    await flushPromises();
    expect(useChatStore.getState().messages[0]?.content).toBe('B');

    loadA.resolve(result('A'));
    await flushPromises();
    const state = useChatStore.getState();
    expect(state.activeSessionId).toBe('B');
    expect(state.messages[0]?.content).toBe('B');
    expect(state.sessionsById.A.messages[0]?.content).toBe('A');
  });

  it('coalesces explicit refreshes and rejects the superseded response', async () => {
    const first = deferred<PollResult>();
    const second = deferred<PollResult>();
    mocks.pollMessages
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    useChatStore.getState().setActiveSession('A');
    useChatStore.getState().setActiveSession('A');
    useChatStore.getState().setActiveSession('A');
    expect(mocks.pollMessages).toHaveBeenCalledTimes(1);
    first.resolve(result('old'));
    await flushPromises();
    expect(useChatStore.getState().sessionsById.A.messages).toEqual([]);
    expect(mocks.pollMessages).toHaveBeenCalledTimes(2);
    second.resolve(result('new'));
    await flushPromises();
    expect(useChatStore.getState().sessionsById.A.messages[0]?.content).toBe('new');
  });

  it('accepts slow periodic responses without overlap or generation starvation', async () => {
    const slow = deferred<PollResult>();
    mocks.pollMessages.mockReturnValueOnce(slow.promise).mockResolvedValue(result('next', 'idle'));
    mocks.wsHandlers.get('session-state')?.({ sessionId: 'A', status: 'running' });
    await vi.advanceTimersByTimeAsync(6000);
    expect(mocks.pollMessages).toHaveBeenCalledTimes(1);
    slow.resolve(result('slow', 'running'));
    await flushPromises();
    expect(useChatStore.getState().sessionsById.A.messages[0]?.content).toBe('slow');
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.pollMessages).toHaveBeenCalledTimes(2);
  });

  it('keeps model projections scoped to their session', async () => {
    const loadA = deferred<PollResult>();
    const loadB = deferred<PollResult>();
    mocks.pollMessages.mockImplementation((sessionId: string) =>
      sessionId === 'A' ? loadA.promise : loadB.promise,
    );

    useChatStore.getState().setActiveSession('A');
    useChatStore.getState().setActiveSession('B');
    loadA.resolve(result('A', 'idle', 1));
    loadB.resolve(result('B', 'idle', 2));
    await flushPromises();

    expect(useChatStore.getState().sessionsById.A.sessionModelNo).toBe(1);
    expect(useChatStore.getState().sessionsById.B.sessionModelNo).toBe(2);
    expect(useChatStore.getState().sessionModelNo).toBe(2);

    useChatStore.getState().setActiveSession('A');
    expect(useChatStore.getState().sessionModelNo).toBe(1);
  });

  it('flushes a queued partial into its source session after switching away', async () => {
    mocks.pollMessages.mockImplementation(() => new Promise<PollResult>(() => {}));
    useChatStore.getState().setActiveSession('A');

    mocks.wsHandlers.get('partial-update')?.({
      sessionId: 'A',
      content: 'A partial',
      turn_segs: ['A partial'],
    });
    useChatStore.getState().setActiveSession('B');

    for (const callback of rafCallbacks.values()) callback(16);
    rafCallbacks.clear();

    const state = useChatStore.getState();
    expect(state.activeSessionId).toBe('B');
    expect(state.sessionsById.A.messages.at(-1)?.content).toBe('A partial');
    expect(state.sessionsById.B.messages).toEqual([]);
  });

  it('tracks two running sessions and polls them independently', async () => {
    const pollA = deferred<PollResult>();
    const pollB = deferred<PollResult>();
    mocks.pollMessages.mockImplementation((sessionId: string) =>
      sessionId === 'A' ? pollA.promise : pollB.promise,
    );

    mocks.wsHandlers.get('session-state')?.({ sessionId: 'A', status: 'running' });
    mocks.wsHandlers.get('session-state')?.({ sessionId: 'B', status: 'running' });
    expect([...useChatStore.getState().runningSessions].sort()).toEqual(['A', 'B']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.pollMessages).toHaveBeenCalledWith('A', undefined);
    expect(mocks.pollMessages).toHaveBeenCalledWith('B', undefined);

    pollB.resolve(result('B', 'idle'));
    await flushPromises();
    expect(useChatStore.getState().runningSessions.has('A')).toBe(true);
    expect(useChatStore.getState().runningSessions.has('B')).toBe(false);
  });

  it('never consumes A pending queue when B becomes idle', async () => {
    mocks.pollMessages.mockImplementation(() => new Promise<PollResult>(() => {}));
    mocks.wsHandlers.get('session-state')?.({ sessionId: 'A', status: 'running' });
    mocks.wsHandlers.get('session-state')?.({ sessionId: 'B', status: 'running' });
    useChatStore.getState().setActiveSession('A');

    await useChatStore.getState().sendMessage('queued for A');
    expect(useChatStore.getState().sessionsById.A.pendingQueue).toHaveLength(1);

    mocks.wsHandlers.get('session-state')?.({ sessionId: 'B', status: 'idle' });
    await flushPromises();
    expect(useChatStore.getState().sessionsById.A.pendingQueue).toHaveLength(1);
    expect(mocks.sendPrompt).not.toHaveBeenCalled();
  });

  it('does not recreate a deleted session when its load resolves late', async () => {
    const loadA = deferred<PollResult>();
    mocks.pollMessages.mockReturnValue(loadA.promise);
    useChatStore.getState().setActiveSession('A');

    await useChatStore.getState().deleteSession('A');
    loadA.resolve(result('A'));
    await flushPromises();

    expect(useChatStore.getState().sessionsById.A).toBeUndefined();
    expect(useChatStore.getState().activeSessionId).toBeNull();
  });
  it('does not complete or drain a send while its upload/submission is pending', async () => {
    mocks.pollMessages.mockResolvedValue(result('A'));
    useChatStore.getState().setActiveSession('A');
    await flushPromises();
    mocks.pollMessages.mockClear();
    const submission = deferred<string>();
    mocks.sendPrompt.mockReturnValueOnce(submission.promise);
    const sending = useChatStore.getState().sendMessage('first');
    await useChatStore.getState().sendMessage('second');
    mocks.wsHandlers.get('session-state')?.({ sessionId: 'A', status: 'idle' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.sendPrompt).toHaveBeenCalledTimes(1);
    expect(mocks.pollMessages).not.toHaveBeenCalled();
    expect(useChatStore.getState().sessionsById.A.submitting).toBe(true);
    expect(useChatStore.getState().sessionsById.A.pendingQueue).toHaveLength(1);
    submission.resolve('1');
    await sending;
    await flushPromises();
    expect(mocks.sendPrompt).toHaveBeenCalledTimes(2);
  });

  it('shares creation and waits for the selected model before the first prompt', async () => {
    mocks.createSession.mockResolvedValue('new');
    mocks.pollMessages.mockResolvedValue(result('new', 'running'));
    const binding = deferred<unknown>();
    mocks.setSessionModel.mockReturnValue(binding.promise);
    await useChatStore.getState().selectSessionModel(2);
    const first = useChatStore.getState().sendMessage('first');
    const second = useChatStore.getState().sendMessage('second');
    await flushPromises();
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.setSessionModel).toHaveBeenCalledWith('new', 2);
    expect(mocks.sendPrompt).not.toHaveBeenCalled();
    binding.resolve({ ok: true });
    await Promise.all([first, second]);
    expect(mocks.sendPrompt).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().sessionsById.new.pendingQueue).toHaveLength(1);
  });

  it('retains rejected sends and attachments for explicit retry', async () => {
    mocks.pollMessages.mockResolvedValue(result('A'));
    useChatStore.getState().setActiveSession('A');
    await flushPromises();
    mocks.sendPrompt.mockRejectedValueOnce(new Error('rejected'));
    const opts = { files: [{ name: 'notes.txt', path: '/notes.txt' }] };
    await useChatStore.getState().sendMessage('keep me', opts);
    const failed = useChatStore.getState().failedSends[0];
    expect(failed).toMatchObject({ sessionId: 'A', text: 'keep me', opts, error: 'rejected' });
    expect(useChatStore.getState().sessionsById.A.messages.slice(-1)[0]?.status).toBe('failed');
  });

  it('removes stale background running IDs when a new snapshot reports idle', async () => {
    mocks.pollMessages.mockResolvedValue(result('background', 'running'));
    mocks.listSessions.mockResolvedValueOnce([{ id: 'background', title: 'Background', untitled: false, status: 'running' }]);
    await useChatStore.getState().loadSessions();
    expect(useChatStore.getState().runningSessions.has('background')).toBe(true);
    await flushPromises();
    mocks.pollMessages.mockResolvedValue(result('background', 'idle'));
    mocks.listSessions.mockResolvedValueOnce([{ id: 'background', title: 'Background', untitled: false, status: 'idle' }]);
    await useChatStore.getState().loadSessions();
    expect(useChatStore.getState().runningSessions.has('background')).toBe(false);
  });

  it('preserves running membership identity for pure stream content changes', () => {
    mocks.wsHandlers.get('session-state')?.({ sessionId: 'A', status: 'running' });
    const membership = useChatStore.getState().runningSessions;
    for (let i = 0; i < 100; i++) {
      mocks.wsHandlers.get('partial-update')?.({ sessionId: 'A', content: String(i) });
    }
    expect(useChatStore.getState().runningSessions).toBe(membership);
    expect(rafCallbacks.size).toBe(1);
  });

});
