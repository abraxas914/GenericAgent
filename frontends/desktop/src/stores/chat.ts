import { create } from 'zustand';
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

export const PARTIAL_MSG_ID = '__partial__';
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

export interface SessionRuntimeState {
  messages: Message[];
  status: ChatStatus;
  partial: Message | null;
  pendingQueue: QueuedMessage[];
  turnStartedAt: number | null;
  sessionModelNo: number | null;
  model: LiveModel | null;
  loadGeneration: number;
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
    ...overrides,
  };
}

function partialMessageId(sessionId: string): string {
  return `${PARTIAL_MSG_ID}:${sessionId}`;
}

function isPartialMessage(message: Message): boolean {
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

  for (const incomingMessage of incoming) {
    if (merged.some((message) => message.id === incomingMessage.id)) continue;
    const localIndex = localMessages.findIndex(
      (message) => message.role === incomingMessage.role && message.content === incomingMessage.content,
    );
    if (localIndex >= 0) localMessages.splice(localIndex, 1);
    merged.push(incomingMessage);
  }

  merged = [...merged, ...localMessages];
  merged.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  if (partial) {
    merged.push({ ...partial, id: partialId, status: 'in_progress' });
  }
  return merged;
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
      if (!current) return {};
      const next = updater(current);
      if (next === current) return {};
      updated = true;

      const runningSessions = new Set(state.runningSessions);
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
      messages: mergeMessages(runtime.messages, [], partial, partialMessageId(sessionId)),
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
    const localImages = opts?.images?.map((file) => ({
      name: file.name,
      path: file.base64 || file.path || file.name,
    }));
    const userMessage: Message = {
      id: `local-${sessionId}-${now}`,
      role: 'user',
      content: text,
      status: 'completed',
      createdAt: now,
      images: localImages,
      files: opts?.files,
    };

    updateSession(sessionId, (current) => ({
      ...current,
      messages: [...current.messages, userMessage],
      status: 'running',
      turnStartedAt: now,
    }));
    startPolling(sessionId);

    try {
      await sendPrompt(sessionId, text, opts?.files, opts?.images);
    } catch {
      stopPolling(sessionId);
      updateSession(sessionId, (current) => ({
        ...current,
        status: 'idle',
        turnStartedAt: null,
      }));
    }
  }

  function drainQueue(sessionId: string) {
    const runtime = get().sessionsById[sessionId];
    if (!runtime || runtime.status !== 'idle' || runtime.pendingQueue.length === 0) return;
    const [next, ...rest] = runtime.pendingQueue;
    updateSession(sessionId, (current) => ({ ...current, pendingQueue: rest }));
    void sendMessageToSession(sessionId, next.text, next.opts);
  }

  function applyPollResult(sessionId: string, generation: number, result: PollResult): boolean {
    if (!isCurrentLoad(sessionId, generation)) return false;

    const applied = updateSession(sessionId, (runtime) => ({
      ...runtime,
      messages: mergeMessages(
        runtime.messages,
        result.messages,
        result.partial,
        partialMessageId(sessionId),
      ),
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
      drainQueue(sessionId);
    }
    return true;
  }

  async function requestPoll(sessionId: string) {
    const generation = beginLoad(sessionId);
    if (generation == null) return;
    try {
      const result = await pollMessages(sessionId);
      applyPollResult(sessionId, generation, result);
    } catch {
      // Polling is a fallback path. The next tick or websocket event can recover.
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
      void requestPoll(sessionId);
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
    if (!event.sessionId) return;

    const sessionId = event.sessionId;
    ensureSession(sessionId, { status: 'running', turnStartedAt: Date.now() });
    updateSession(sessionId, (runtime) => ({
      ...runtime,
      status: 'running',
      turnStartedAt: runtime.turnStartedAt ?? Date.now(),
    }));
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
    if (!event.sessionId || !event.status) return;

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
      void listSessions().then((sessions) => set({ sessions })).catch(() => {});
    }
  });

  void listSessions().then((sessions) => set({ sessions })).catch(() => {});

  return {
    activeSessionId: null,
    sessionsById: {},
    messages: [],
    status: 'idle',
    pendingQueue: [],
    turnStartedAt: null,
    sessionModelNo: null,
    sessions: [],
    runningSessions: new Set(),

    async newSession() {
      useThreadViewStore.getState().resetSession(null);
      useSettingsStore.getState().setLiveModel(null);
      set({ activeSessionId: null, ...activeProjection() });
    },

    async sendMessage(text: string, opts?: SendOptions) {
      let sessionId = get().activeSessionId;
      if (!sessionId) {
        const pendingModel = get().sessionModelNo;
        sessionId = await createSession();
        const runtime = createRuntime({ sessionModelNo: pendingModel });
        set((state) => ({
          activeSessionId: sessionId,
          sessionsById: { ...state.sessionsById, [sessionId!]: runtime },
          ...activeProjection(runtime),
        }));
        void get().loadSessions();
        if (pendingModel != null) {
          void apiSetSessionModel(sessionId, pendingModel).then((result) => {
            if (!get().sessionsById[sessionId!]) return;
            updateSession(sessionId!, (current) => ({
              ...current,
              sessionModelNo: result.model?.llmNo ?? current.sessionModelNo,
              model: result.model ?? current.model,
            }));
            if (result.model) syncActiveModel(sessionId!, result.model);
          }).catch(() => {});
        }
      }
      await sendMessageToSession(sessionId, text, opts);
    },

    async cancel() {
      const sessionId = get().activeSessionId;
      if (!sessionId) return;
      await cancelGeneration(sessionId);
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
      try {
        const sessions = await listSessions();
        set((state) => {
          const runningSessions = new Set(state.runningSessions);
          for (const session of sessions) {
            if (session.status === 'running') runningSessions.add(session.id);
          }
          return { sessions, runningSessions };
        });
      } catch {
        // Bridge reconnect will retry.
      }
    },

    async deleteSession(id: string) {
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
          ...(deletingActive ? activeProjection() : {}),
        };
      });
      if (get().activeSessionId == null) useSettingsStore.getState().setLiveModel(null);
      try {
        await apiDeleteSession(id);
      } catch {
        // Keep the optimistic local deletion; a later session refresh reconciles it.
      }
    },

    async renameSession(id: string, title: string) {
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === id ? { ...session, title, untitled: false } : session,
        ),
      }));
      try {
        await apiRenameSession(id, title);
      } catch {
        // Session list refresh reconciles bridge failures.
      }
    },

    async pinSession(id: string, pinned: boolean) {
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === id ? { ...session, pinned } : session,
        ),
      }));
      try {
        await apiPinSession(id, pinned);
      } catch {
        // Session list refresh reconciles bridge failures.
      }
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
        const result = await apiSetSessionModel(sessionId, llmNo);
        const current = get().sessionsById[sessionId];
        if (!current || current.sessionModelNo !== llmNo) return;
        updateSession(sessionId, (runtime) => ({
          ...runtime,
          sessionModelNo: result.model?.llmNo ?? runtime.sessionModelNo,
          model: result.model ?? runtime.model,
        }));
        if (result.model) syncActiveModel(sessionId, result.model);
      } catch {
        updateSession(sessionId, (runtime) => runtime.sessionModelNo === llmNo
          ? { ...runtime, sessionModelNo: previous }
          : runtime);
      }
    },
  };
});

export function __resetChatStoreForTests() {
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
    runningSessions: new Set(),
  });
}

function stopTimerForTests(sessionId: string) {
  const timer = pollTimers.get(sessionId);
  if (timer != null) clearInterval(timer);
  pollTimers.delete(sessionId);
}

onBridgeStatusChange((status) => {
  if (status === 'ready') {
    void useChatStore.getState().loadSessions();
  }
});
