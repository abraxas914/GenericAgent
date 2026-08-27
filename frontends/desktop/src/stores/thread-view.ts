import { create } from 'zustand';

export const NEW_SESSION_VIEW_ID = '__new_session__';

export interface AttachmentFile {
  id: string;
  name: string;
  size: number;
  type: 'image' | 'file' | 'url';
  status: 'uploading' | 'ready' | 'error';
  preview?: string;
  path?: string;
  url?: string;
  errorMsg?: string;
}

export interface ScrollAnchor {
  scrollTop: number;
}

export interface SessionViewState {
  renderBudgetMultiplier: number;
  scrollAnchor: ScrollAnchor | null;
  followingTail: boolean;
  expandedSegments: Record<string, boolean>;
  composerDraft: string;
  attachments: AttachmentFile[];
}

interface ThreadViewStore {
  viewBySessionId: Record<string, SessionViewState>;
  setRenderBudget: (sessionId: string | null, multiplier: number) => void;
  setScrollState: (
    sessionId: string | null,
    scrollAnchor: ScrollAnchor | null,
    followingTail: boolean,
  ) => void;
  setSegmentExpanded: (sessionId: string | null, segmentId: string, expanded: boolean) => void;
  setComposerDraft: (sessionId: string | null, draft: string) => void;
  updateAttachments: (
    sessionId: string | null,
    updater: (attachments: AttachmentFile[]) => AttachmentFile[],
  ) => void;
  resetSession: (sessionId: string | null) => void;
  deleteSession: (sessionId: string) => void;
}

export function sessionViewId(sessionId: string | null): string {
  return sessionId ?? NEW_SESSION_VIEW_ID;
}

export function createSessionView(): SessionViewState {
  return {
    renderBudgetMultiplier: 1,
    scrollAnchor: null,
    followingTail: true,
    expandedSegments: {},
    composerDraft: '',
    attachments: [],
  };
}

export const useThreadViewStore = create<ThreadViewStore>((set) => {
  function updateSession(
    sessionId: string | null,
    updater: (view: SessionViewState) => SessionViewState,
  ) {
    const id = sessionViewId(sessionId);
    set((state) => {
      const current = state.viewBySessionId[id] ?? createSessionView();
      const next = updater(current);
      if (next === current) return {};
      return { viewBySessionId: { ...state.viewBySessionId, [id]: next } };
    });
  }

  return {
    viewBySessionId: {},

    setRenderBudget(sessionId, multiplier) {
      updateSession(sessionId, (view) => ({ ...view, renderBudgetMultiplier: multiplier }));
    },

    setScrollState(sessionId, scrollAnchor, followingTail) {
      updateSession(sessionId, (view) => ({ ...view, scrollAnchor, followingTail }));
    },

    setSegmentExpanded(sessionId, segmentId, expanded) {
      updateSession(sessionId, (view) => ({
        ...view,
        expandedSegments: { ...view.expandedSegments, [segmentId]: expanded },
      }));
    },

    setComposerDraft(sessionId, composerDraft) {
      updateSession(sessionId, (view) => ({ ...view, composerDraft }));
    },

    updateAttachments(sessionId, updater) {
      updateSession(sessionId, (view) => ({ ...view, attachments: updater(view.attachments) }));
    },

    resetSession(sessionId) {
      const id = sessionViewId(sessionId);
      set((state) => ({
        viewBySessionId: { ...state.viewBySessionId, [id]: createSessionView() },
      }));
    },

    deleteSession(sessionId) {
      set((state) => {
        if (!state.viewBySessionId[sessionId]) return {};
        const viewBySessionId = { ...state.viewBySessionId };
        delete viewBySessionId[sessionId];
        return { viewBySessionId };
      });
    },
  };
});

export function useSegmentDisclosure(
  sessionId: string | null,
  segmentId: string,
  defaultExpanded: boolean,
) {
  const explicitValue = useThreadViewStore(
    (state) => state.viewBySessionId[sessionViewId(sessionId)]?.expandedSegments[segmentId],
  );
  const setSegmentExpanded = useThreadViewStore((state) => state.setSegmentExpanded);
  return {
    expanded: explicitValue ?? defaultExpanded,
    setExpanded: (expanded: boolean) => setSegmentExpanded(sessionId, segmentId, expanded),
  };
}
