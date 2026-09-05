import { create } from 'zustand';
import { notifyError } from './notifications';
import { serialTask } from '../lib/serial-task';
import {
  createSession,
  sendPrompt,
  pollMessages,
  cancelGeneration,
  listSessions,
  deleteSession as apiDeleteSession,
  renameSession as apiRenameSession,
  pinSession as apiPinSession,
  setSessionModel as apiSetSessionModel,
  type Message,
  type PollResult,
  type SessionInfo,
} from '../services/chat';
import { subscribe, onBridgeStatusChange } from '../services/ws';
import { useSettingsStore } from './settings';
import { useThreadViewStore } from './thread-view';

import { PARTIAL_MSG_ID, isPartialMessage, mergeMessages, replacePartialMessage } from '../lib/chat-messages';
export { PARTIAL_MSG_ID, mergeMessages } from '../lib/chat-messages';
const POLL_INTERVAL_MS = 1000;

type ChatStatus = 'idle' | 'running';
type LiveModel = NonNullable<PollResult['model']>;

export interface SendOptions {
  files?: { name: string; path: string; size?: number }[];
  images?: { name: string; path: string; base64?: string }[];
}

export interface QueuedMessage {
  text: string;
  opts?: SendOptions;
}

export interface FailedSend extends QueuedMessage {
  id: string;
  sessionId: string | null;
  error: string;
  localMessageId?: string;
}

export interface SessionRuntimeState {
  messages: Message[];
  status: ChatStatus;
  partial: Message | null;
  pendingQueue: QueuedMessage[];
  turnStartedAt: number | null;
  sessionModelNo: number | null;
  model: LiveModel | null;
  loadGeneration: number;
  submitting: boolean;
  cursor: string | null;
  hasEarlier: boolean;
  loadingEarlier: boolean;
}

interface ChatState {
  activeSessionId: string | null;
  sessionsById: Record<string, SessionRuntimeState>;

  // Active-session projection kept for existing consumers.
  messages: Message[];
  status: ChatStatus;
  pendingQueue: QueuedMessage[];
  turnStartedAt: number | null;
  sessionModelNo: number | null;

  failedSends: FailedSend[];
  retryFailed: (id: string) => Promise<void>;
  loadEarlier: (sessionId: string) => Promise<void>;
  sessions: SessionInfo[];
  runningSessions: Set<string>;

  newSession: () => Promise<void>;
  sendMessage: (text: string, opts?: SendOptions) => Promise<void>;
  cancel: () => Promise<void>;
  cancelQueued: (index: number) => void;
  setActiveSession: (id: string | null) => void;
  loadSessions: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  pinSession: (id: string, pinned: boolean) => Promise<void>;
  selectSessionModel: (llmNo: number) => Promise<void>;
}

interface PartialFrameState {
  pending: Message | null;
  rafId: number | null;
}

let navigationGeneration = 0;
let sendSequence = 0;
let creatingSession: { generation: number; promise: Promise<string> } | null = null;
const modelWrites = new Map<string, ReturnType<typeof serialTask>>();
const submissions = new Map<string, AbortController>();
let listGeneration = 0;

function sessionOperations(sessionId: string) {
  const enqueue = modelWrites.get(sessionId) ?? serialTask();
  modelWrites.set(sessionId, enqueue);
  return enqueue;
}

function bindModel(sessionId: string, no: number) {
  return sessionOperations(sessionId)(() => apiSetSessionModel(sessionId, no));
}

const deletedSessions = new Set<string>();
const pendingPolls = new Map<string, { again: boolean }>();
const partialFrames = new Map<string, PartialFrameState>();
const pollTimers = new Map<string, ReturnType<typeof setInterval>>();

function createRuntime(overrides: Partial<SessionRuntimeState> = {}): SessionRuntimeState {
  return {
    messages: [],
    status: 'idle',
    partial: null,
    pendingQueue: [],
    turnStartedAt: null,
    sessionModelNo: null,
    model: null,
    loadGeneration: 0,
    submitting: false,
    cursor: null,
    hasEarlier: false,
    loadingEarlier: false,
    ...overrides,
  };
}

function partialMessageId(sessionId: string): string {
  return `${PARTIAL_MSG_ID}:${sessionId}`;
}

function inferTurnStart(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'user' && messages[index].createdAt) {
      return messages[index].createdAt!;
    }
  }
  return Date.now();
}

function activeProjection(runtime?: SessionRuntimeState) {
  return {
    messages: runtime?.messages ?? [],
    status: runtime?.status ?? 'idle' as ChatStatus,
    pendingQueue: runtime?.pendingQueue ?? [],
    turnStartedAt: runtime?.turnStartedAt ?? null,
    sessionModelNo: runtime?.sessionModelNo ?? null,
  };
}

export const useChatStore = create<ChatState>((set, get) => {
  function ensureSession(sessionId: string, overrides: Partial<SessionRuntimeState> = {}): SessionRuntimeState {
    const existing = get().sessionsById[sessionId];
    if (existing) return existing;

    const runtime = createRuntime(overrides);
    set((state) => ({
      sessionsById: { ...state.sessionsById, [sessionId]: runtime },
      runningSessions: runtime.status === 'running'
        ? new Set(state.runningSessions).add(sessionId)
        : state.runningSessions,
      ...(state.activeSessionId === sessionId ? activeProjection(runtime) : {}),
    }));
    return runtime;
  }

  function updateSession(
    sessionId: string,
    updater: (runtime: SessionRuntimeState) => SessionRuntimeState,
  ): boolean {
    let updated = false;
    set((state) => {
      const current = state.sessionsById[sessionId];
      if (!current) return state;
      const next = updater(current);
      if (next === current) return state;
      updated = true;

      const membershipChanged = state.runningSessions.has(sessionId) !== (next.status === 'running');
      const runningSessions = membershipChanged ? new Set(state.runningSessions) : state.runningSessions;
      if (next.status === 'running') runningSessions.add(sessionId);
      else runningSessions.delete(sessionId);

      return {
        sessionsById: { ...state.sessionsById, [sessionId]: next },
        runningSessions,
        ...(state.activeSessionId === sessionId ? activeProjection(next) : {}),
      };
    });
    return updated;
  }

  function beginLoad(sessionId: string): number | null {
    let generation: number | null = null;
    updateSession(sessionId, (runtime) => {
      generation = runtime.loadGeneration + 1;
      return { ...runtime, loadGeneration: generation };
    });
    return generation;
  }

  function isCurrentLoad(sessionId: string, generation: number): boolean {
    return get().sessionsById[sessionId]?.loadGeneration === generation;
  }

  function syncActiveModel(sessionId: string, model: LiveModel | null) {
    if (get().activeSessionId === sessionId) {
      useSettingsStore.getState().setLiveModel(model);
    }
  }

  function cancelPartialFrame(sessionId: string) {
    const frame = partialFrames.get(sessionId);
    if (frame?.rafId != null) cancelAnimationFrame(frame.rafId);
    partialFrames.delete(sessionId);
  }

  function flushPartial(sessionId: string) {
    const frame = partialFrames.get(sessionId);
    if (!frame) return;
    frame.rafId = null;
    const partial = frame.pending;
    frame.pending = null;
    if (!partial) return;

    updateSession(sessionId, (runtime) => ({
      ...runtime,
      partial,
      messages: replacePartialMessage(runtime.messages, partial, partialMessageId(sessionId)),
    }));
  }

  function stopPolling(sessionId: string) {
    const timer = pollTimers.get(sessionId);
    if (timer != null) clearInterval(timer);
    pollTimers.delete(sessionId);
  }

  async function sendMessageToSession(sessionId: string, text: string, opts?: SendOptions) {
    const runtime = get().sessionsById[sessionId];
    if (!runtime) return;
    if (runtime.status === 'running') {
      updateSession(sessionId, (current) => ({
        ...current,
        pendingQueue: [...current.pendingQueue, { text, opts }],
      }));
      return;
    }

    const now = Date.now();
    const localId = `local-${sessionId}-${++sendSequence}`;
    const localImages = opts?.images?.map((file) => ({
      name: file.name,
      path: file.base64 || file.path || file.name,
    }));
    const userMessage: Message = {
      id: localId,
      role: 'user',
      content: text,
      status: 'in_progress',
      createdAt: now,
      images: localImages,
      files: opts?.files,
    };

    updateSession(sessionId, (current) => ({
      ...current,
      messages: [...current.messages, userMessage],
      status: 'running',
      submitting: true,
      loadGeneration: current.loadGeneration + 1,
      turnStartedAt: now,
    }));

    const controller = new AbortController();
    submissions.set(sessionId, controller);
    try {
      const serverId = await sessionOperations(sessionId)(async () => {
        if (controller.signal.aborted) throw new Error('Send cancelled');
        if (runtime.sessionModelNo != null) await apiSetSessionModel(sessionId, runtime.sessionModelNo);
        if (controller.signal.aborted) throw new Error('Send cancelled');
        return sendPrompt(sessionId, text, opts?.files, opts?.images, controller.signal);
      });
      if (!get().sessionsById[sessionId]) return;
      updateSession(sessionId, (current) => ({
        ...current,
        submitting: false,
        messages: current.messages.map((message) => message.id === localId
          ? { ...message, id: serverId, status: 'completed' } : message),
      }));
      startPolling(sessionId);
      void requestPoll(sessionId);
    } catch (error) {
      if (deletedSessions.has(sessionId)) return;
      stopPolling(sessionId);
      updateSession(sessionId, (current) => ({
        ...current,
        submitting: false,
        status: 'idle',
        turnStartedAt: null,
        messages: current.messages.map((message) => message.id === localId
          ? { ...message, status: 'failed' } : message),
      }));
      recordFailed(sessionId, text, opts, error, localId);
    } finally {
      if (submissions.get(sessionId) === controller) submissions.delete(sessionId);
    }
  }

  function recordFailed(sessionId: string | null, text: string, opts: SendOptions | undefined, error: unknown, localMessageId?: string) {
    set((state) => ({ failedSends: [...state.failedSends, {
      id: `failed-${++sendSequence}`, sessionId, text, opts,
      error: error instanceof Error ? error.message : String(error), localMessageId,
    }] }));
  }

  function drainQueue(sessionId: string) {
    const runtime = get().sessionsById[sessionId];
    if (!runtime || runtime.status !== 'idle' || runtime.pendingQueue.length === 0) return;
    const [next, ...rest] = runtime.pendingQueue;
    updateSession(sessionId, (current) => ({ ...current, pendingQueue: rest }));
    void sendMessageToSession(sessionId, next.text, next.opts);
  }

  function applyPollResult(sessionId: string, generation: number, result: PollResult): boolean {
    if (!isCurrentLoad(sessionId, generation) || get().sessionsById[sessionId]?.submitting) return false;

    const applied = updateSession(sessionId, (runtime) => ({
      ...runtime,
      messages: mergeMessages(
        runtime.messages,
        result.messages,
        result.partial,
        partialMessageId(sessionId),
      ),
      cursor: result.messages.reduce((cursor, message) => /^\d+$/.test(message.id)
        && Number(message.id) > Number(cursor ?? 0) ? message.id : cursor, runtime.cursor),
      hasEarlier: runtime.cursor == null ? (result.hasEarlier ?? false) : runtime.hasEarlier,
      partial: result.partial ?? null,
      status: result.status,
      turnStartedAt:
        result.status === 'running'
          ? runtime.turnStartedAt ?? inferTurnStart(result.messages)
          : null,
      sessionModelNo: result.model?.llmNo ?? runtime.sessionModelNo,
      model: result.model ?? runtime.model,
    }));
    if (!applied) return false;

    if (result.model) syncActiveModel(sessionId, result.model);
    if (result.status === 'running') {
      startPolling(sessionId);
    } else {
      stopPolling(sessionId);
      cancelPartialFrame(sessionId);
      if (!result.hasMore) drainQueue(sessionId);
    }
    return true;
  }

  async function requestPoll(sessionId: string) {
    if (get().sessionsById[sessionId]?.submitting || deletedSessions.has(sessionId)) return;
    const active = pendingPolls.get(sessionId);
    if (active) {
      // Explicit refreshes supersede the old response, then run once it settles.
      active.again = true;
      beginLoad(sessionId);
      return;
    }
    const generation = beginLoad(sessionId);
    if (generation == null) return;
    const pending = { again: false };
    pendingPolls.set(sessionId, pending);
    try {
      const cursor = get().sessionsById[sessionId]?.cursor ?? undefined;
      const result = await pollMessages(sessionId, cursor);
      if (pendingPolls.get(sessionId) === pending) {
        const applied = applyPollResult(sessionId, generation, result);
        if (applied && result.hasMore) pending.again = true;
      }
    } catch {
      // Polling is a fallback path. The next tick or websocket event can recover.
    } finally {
      if (pendingPolls.get(sessionId) === pending) {
        pendingPolls.delete(sessionId);
        if (pending.again && get().sessionsById[sessionId]) void requestPoll(sessionId);
      }
    }
  }

  function startPolling(sessionId: string) {
    if (pollTimers.has(sessionId)) return;
    const timer = setInterval(() => {
      const runtime = get().sessionsById[sessionId];
      if (!runtime || runtime.status !== 'running') {
        stopPolling(sessionId);
        return;
      }
      if (!pendingPolls.has(sessionId)) void requestPoll(sessionId);
    }, POLL_INTERVAL_MS);
    pollTimers.set(sessionId, timer);
  }

  subscribe('partial-update', (data: unknown) => {
    const event = data as {
      sessionId?: string;
      content?: string;
      turn_segs?: string[];
      curr_turn?: number;
    };
    if (!event.sessionId || deletedSessions.has(event.sessionId)) return;

    const sessionId = event.sessionId;
    ensureSession(sessionId, { status: 'running', turnStartedAt: Date.now() });
    updateSession(sessionId, (runtime) => runtime.status === 'running' && runtime.turnStartedAt != null
      ? runtime : {
        ...runtime, status: 'running',
        loadGeneration: runtime.loadGeneration + 1,
        turnStartedAt: runtime.turnStartedAt ?? Date.now(),
      });
    startPolling(sessionId);

    const frame = partialFrames.get(sessionId) ?? { pending: null, rafId: null };
    frame.pending = {
      id: partialMessageId(sessionId),
      role: 'assistant',
      content: event.content || '',
      status: 'in_progress',
      turn_segs: event.turn_segs,
    };
    if (frame.rafId == null) {
      frame.rafId = requestAnimationFrame(() => flushPartial(sessionId));
    }
    partialFrames.set(sessionId, frame);
  });

  subscribe('session-state', (data: unknown) => {
    const event = data as { sessionId?: string; status?: string };
    if (!event.sessionId || !event.status || deletedSessions.has(event.sessionId)) return;
    if (get().sessionsById[event.sessionId]?.submitting) return;

    const sessionId = event.sessionId;
    const running = event.status === 'running';
    ensureSession(sessionId, {
      status: running ? 'running' : 'idle',
      turnStartedAt: running ? Date.now() : null,
    });

    if (running) {
      updateSession(sessionId, (runtime) => ({
        ...runtime,
        status: 'running',
        loadGeneration: runtime.status === 'running' ? runtime.loadGeneration : runtime.loadGeneration + 1,
        turnStartedAt: runtime.turnStartedAt ?? Date.now(),
      }));
      startPolling(sessionId);
      return;
    }

    if (event.status === 'idle' || event.status === 'error' || event.status === 'cancelled') {
      stopPolling(sessionId);
      cancelPartialFrame(sessionId);
      updateSession(sessionId, (runtime) => ({
        ...runtime,
        status: 'idle',
        partial: null,
        messages: runtime.messages.filter((message) => !isPartialMessage(message)),
        turnStartedAt: null,
      }));
      void requestPoll(sessionId);
      void get().loadSessions();
    }
  });

  return {
    activeSessionId: null,
    sessionsById: {},
    messages: [],
    status: 'idle',
    pendingQueue: [],
    turnStartedAt: null,
    sessionModelNo: null,
    sessions: [],
    failedSends: [],
    runningSessions: new Set(),

    async newSession() {
      navigationGeneration++;
      useThreadViewStore.getState().resetSession(null);
      useSettingsStore.getState().setLiveModel(null);
      set({ activeSessionId: null, ...activeProjection() });
    },

    async sendMessage(text: string, opts?: SendOptions) {
      let sessionId = get().activeSessionId;
      try {
        if (!sessionId) {
          const generation = navigationGeneration;
          if (!creatingSession || creatingSession.generation !== generation) {
            const pendingModel = get().sessionModelNo;
            const promise = createSession().then((id) => {
              const runtime = ensureSession(id, { sessionModelNo: pendingModel });
              if (navigationGeneration === generation) {
                set({ activeSessionId: id, ...activeProjection(runtime) });
              }
              void get().loadSessions();
              return id;
            });
            creatingSession = { generation, promise };
          }
          const creation = creatingSession;
          try { sessionId = await creation.promise; }
          finally { if (creatingSession === creation) creatingSession = null; }
        }
        await sendMessageToSession(sessionId, text, opts);
      } catch (error) {
        recordFailed(sessionId, text, opts, error);
      }
    },

    async retryFailed(id: string) {
      const failed = get().failedSends.find((item) => item.id === id);
      if (!failed) return;
      set((state) => ({ failedSends: state.failedSends.filter((item) => item.id !== id) }));
      if (failed.sessionId) {
        updateSession(failed.sessionId, (runtime) => ({ ...runtime,
          messages: runtime.messages.filter((message) => message.id !== failed.localMessageId),
        }));
        await sendMessageToSession(failed.sessionId, failed.text, failed.opts);
      } else {
        await get().sendMessage(failed.text, failed.opts);
      }
    },

    async loadEarlier(sessionId: string) {
      const runtime = get().sessionsById[sessionId];
      if (!runtime || runtime.loadingEarlier || !runtime.hasEarlier) return;
      const before = runtime.messages.find((message) => /^\d+$/.test(message.id))?.id;
      if (!before) return;
      updateSession(sessionId, (current) => ({ ...current, loadingEarlier: true }));
      try {
        const page = await pollMessages(sessionId, undefined, 50, before);
        updateSession(sessionId, (current) => ({ ...current,
          messages: mergeMessages(current.messages, page.messages, current.partial ?? undefined, partialMessageId(sessionId)),
          hasEarlier: page.hasEarlier ?? false,
        }));
      } catch (error) { notifyError(error); }
      finally { updateSession(sessionId, (current) => ({ ...current, loadingEarlier: false })); }
    },

    async cancel() {
      const sessionId = get().activeSessionId;
      if (!sessionId) return;
      submissions.get(sessionId)?.abort();
      try { await cancelGeneration(sessionId); }
      catch (error) { notifyError(error); }
    },

    cancelQueued(index: number) {
      const sessionId = get().activeSessionId;
      if (!sessionId) return;
      updateSession(sessionId, (runtime) => ({
        ...runtime,
        pendingQueue: runtime.pendingQueue.filter((_, queueIndex) => queueIndex !== index),
      }));
    },

    setActiveSession(id: string | null) {
      navigationGeneration++;
      if (!id) {
        useSettingsStore.getState().setLiveModel(null);
        set({ activeSessionId: null, ...activeProjection() });
        return;
      }

      const runtime = ensureSession(id);
      set({ activeSessionId: id, ...activeProjection(runtime) });
      syncActiveModel(id, runtime.model);
      if (runtime.status === 'running') startPolling(id);
      void requestPoll(id);
    },

    async loadSessions() {
      const request = ++listGeneration;
      const observed = get().sessionsById;
      try {
        const snapshot = await listSessions();
        if (request !== listGeneration) return;
        const sessions = snapshot.filter((session) => !deletedSessions.has(session.id));
        const refresh = new Set<string>();
        set((state) => {
          const runningSessions = new Set(sessions.filter((session) => session.status === 'running').map((session) => session.id));
          const sessionsById = { ...state.sessionsById };
          for (const id of runningSessions) {
            sessionsById[id] ??= createRuntime();
          }
          for (const [id, runtime] of Object.entries(sessionsById)) {
            if (runtime.submitting || (state.sessionsById[id] && runtime !== observed[id])) {
              if (runtime.status === 'running') runningSessions.add(id);
              else runningSessions.delete(id);
              continue;
            }
            const status = runningSessions.has(id) ? 'running' : 'idle';
            if (runtime.status !== status) {
              sessionsById[id] = { ...runtime, status, loadGeneration: runtime.loadGeneration + 1,
                turnStartedAt: status === 'running' ? runtime.turnStartedAt ?? Date.now() : null };
              refresh.add(id);
            }
          }
          return { sessions, sessionsById, runningSessions,
            ...(state.activeSessionId ? activeProjection(sessionsById[state.activeSessionId]) : {}) };
        });
        for (const [id, runtime] of Object.entries(get().sessionsById)) {
          if (runtime.status === 'running') startPolling(id);
          else stopPolling(id);
        }
        const active = get().activeSessionId;
        if (active) refresh.add(active);
        for (const id of refresh) void requestPoll(id);
      } catch {
        // Bridge reconnect will retry.
      }
    },

    async deleteSession(id: string) {
      try { await apiDeleteSession(id); }
      catch (error) { notifyError(error); return; }
      deletedSessions.add(id);
      listGeneration++;
      submissions.get(id)?.abort();
      modelWrites.delete(id);
      pendingPolls.delete(id);
      stopPolling(id);
      cancelPartialFrame(id);
      useThreadViewStore.getState().deleteSession(id);
      set((state) => {
        const sessionsById = { ...state.sessionsById };
        delete sessionsById[id];
        const runningSessions = new Set(state.runningSessions);
        runningSessions.delete(id);
        const deletingActive = state.activeSessionId === id;
        return {
          activeSessionId: deletingActive ? null : state.activeSessionId,
          sessionsById,
          runningSessions,
          sessions: state.sessions.filter((session) => session.id !== id),
          failedSends: state.failedSends.filter((item) => item.sessionId !== id),
          ...(deletingActive ? activeProjection() : {}),
        };
      });
      if (get().activeSessionId == null) useSettingsStore.getState().setLiveModel(null);

    },

    async renameSession(id: string, title: string) {
      try {
        await apiRenameSession(id, title);
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === id ? { ...session, title, untitled: false } : session,
        ),
      }));
      } catch (error) { notifyError(error); }
    },

    async pinSession(id: string, pinned: boolean) {
      try {
        await apiPinSession(id, pinned);
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === id ? { ...session, pinned } : session,
        ),
      }));
      } catch (error) { notifyError(error); }
    },

    async selectSessionModel(llmNo: number) {
      const sessionId = get().activeSessionId;
      if (!sessionId) {
        set({ sessionModelNo: llmNo });
        return;
      }

      const previous = get().sessionsById[sessionId]?.sessionModelNo ?? null;
      updateSession(sessionId, (runtime) => ({ ...runtime, sessionModelNo: llmNo }));
      try {
        const result = await bindModel(sessionId, llmNo);
        const current = get().sessionsById[sessionId];
        if (!current || current.sessionModelNo !== llmNo) return;
        updateSession(sessionId, (runtime) => ({
          ...runtime,
          sessionModelNo: result.model?.llmNo ?? runtime.sessionModelNo,
          model: result.model ?? runtime.model,
        }));
        if (result.model) syncActiveModel(sessionId, result.model);
      } catch (error) {
        notifyError(error);
        updateSession(sessionId, (runtime) => runtime.sessionModelNo === llmNo
          ? { ...runtime, sessionModelNo: previous }
          : runtime);
      }
    },
  };
});

export function __resetChatStoreForTests() {
  navigationGeneration++;
  listGeneration++;
  modelWrites.clear();
  for (const controller of submissions.values()) controller.abort();
  submissions.clear();
  creatingSession = null;
  deletedSessions.clear();
  pendingPolls.clear();
  for (const sessionId of pollTimers.keys()) stopTimerForTests(sessionId);
  for (const [sessionId, frame] of partialFrames) {
    if (frame.rafId != null) cancelAnimationFrame(frame.rafId);
    partialFrames.delete(sessionId);
  }
  useChatStore.setState({
    activeSessionId: null,
    sessionsById: {},
    messages: [],
    status: 'idle',
    pendingQueue: [],
    turnStartedAt: null,
    sessionModelNo: null,
    sessions: [],
    failedSends: [],
    runningSessions: new Set(),
  });
}

function stopTimerForTests(sessionId: string) {
  const timer = pollTimers.get(sessionId);
  if (timer != null) clearInterval(timer);
  pollTimers.delete(sessionId);
}

void useChatStore.getState().loadSessions();

onBridgeStatusChange((status) => {
  if (status === 'ready') {
    void useChatStore.getState().loadSessions();
  }
});
