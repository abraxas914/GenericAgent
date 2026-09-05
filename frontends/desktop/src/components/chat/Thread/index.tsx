import { useCallback, useRef, useEffect } from 'react';
import { useChatStore } from '../../../stores/chat';
import { sessionViewId, useThreadViewStore } from '../../../stores/thread-view';
import { useStickToBottom, useSessionScrollStability } from '../../../hooks/useStickToBottom';
import { ThreadContent } from './ThreadContent';
import { MessageList } from './MessageList';
import { UserTurnRail } from './UserTurnRail';
import { useI18n } from '../../../i18n';
import './thread.css';

export function Thread() {
  const { lang } = useI18n();
  const messages = useChatStore((state) => state.messages);
  const status = useChatStore((state) => state.status);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const hasEarlier = useChatStore((state) => activeSessionId ? state.sessionsById[activeSessionId]?.hasEarlier ?? false : false);
  const loadingEarlier = useChatStore((state) => activeSessionId ? state.sessionsById[activeSessionId]?.loadingEarlier ?? false : false);
  const loadEarlier = useChatStore((state) => state.loadEarlier);
  const viewId = sessionViewId(activeSessionId);
  const budgetMultiplier = useThreadViewStore(
    (state) => state.viewBySessionId[viewId]?.renderBudgetMultiplier ?? 1,
  );
  const followingTail = useThreadViewStore(
    (state) => state.viewBySessionId[viewId]?.followingTail ?? true,
  );
  const scrollAnchor = useThreadViewStore(
    (state) => state.viewBySessionId[viewId]?.scrollAnchor ?? null,
  );
  const setRenderBudget = useThreadViewStore((state) => state.setRenderBudget);
  const setScrollState = useThreadViewStore((state) => state.setScrollState);
  const handleScrollStateChange = useCallback((scrollTop: number, isFollowing: boolean) => {
    setScrollState(activeSessionId, { scrollTop }, isFollowing);
  }, [activeSessionId, setScrollState]);
  const { scrollRef, isAtBottom, scrollToBottom, stopScroll } = useStickToBottom({
    followingTail,
    onScrollStateChange: handleScrollStateChange,
  });
  const pendingJumpRef = useRef<string | null>(null);

  useSessionScrollStability(
    scrollRef,
    scrollToBottom,
    stopScroll,
    activeSessionId,
    followingTail,
    scrollAnchor?.scrollTop ?? null,
  );

  useEffect(() => {
    pendingJumpRef.current = null;
  }, [activeSessionId]);

  // After budget expands and DOM updates, execute pending jump
  useEffect(() => {
    if (!pendingJumpRef.current) return;
    const id = pendingJumpRef.current;

    // Wait a frame for DOM to render newly expanded messages
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${id}`);
      if (el) {
        pendingJumpRef.current = null;
        const viewport = scrollRef.current;
        if (viewport) {
          const turnPair = el.closest<HTMLElement>('[data-slot="aui_turn-pair"]');
          const scrollTarget = turnPair || el;
          viewport.scrollTop = scrollTarget.offsetTop - 12;
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [budgetMultiplier, scrollRef]);

  const expandAllMessages = useCallback(() => {
    setRenderBudget(activeSessionId, Infinity);
  }, [activeSessionId, setRenderBudget]);

  const requestJumpToCollapsed = useCallback((msgId: string) => {
    pendingJumpRef.current = msgId;
    expandAllMessages();
  }, [expandAllMessages]);

  const handleShowEarlier = useCallback(() => {
    const viewport = scrollRef.current;
    if (viewport) {
      // MessageList will restore scroll via its own layout effect
    }
    setRenderBudget(activeSessionId, budgetMultiplier + 1);
  }, [activeSessionId, budgetMultiplier, scrollRef, setRenderBudget]);

  return (
    <div data-slot="thread-root">
      <div
        ref={scrollRef}
        data-slot="aui_thread-viewport"
        data-following={isAtBottom}
      >
        <ThreadContent>
          {hasEarlier && <button data-slot="load-history" disabled={loadingEarlier}
            onClick={async () => {
              if (!activeSessionId) return;
              const viewport = scrollRef.current;
              const height = viewport?.scrollHeight ?? 0;
              const top = viewport?.scrollTop ?? 0;
              await loadEarlier(activeSessionId);
              requestAnimationFrame(() => {
                if (viewport?.isConnected && useChatStore.getState().activeSessionId === activeSessionId) viewport.scrollTop = top + viewport.scrollHeight - height;
              });
            }}>{lang === 'zh' ? '加载更早消息' : 'Load earlier messages'}</button>}
          <MessageList
            sessionId={activeSessionId ?? ''}
            messages={messages}
            isRunning={status === 'running'}
            budgetMultiplier={budgetMultiplier}
            onShowEarlier={handleShowEarlier}
            scrollRef={scrollRef}
          />
          <div data-slot="aui_composer-clearance" />
        </ThreadContent>
      </div>

      <UserTurnRail
        messages={messages}
        stopScroll={stopScroll}
        onJumpToCollapsed={requestJumpToCollapsed}
      />

      {!isAtBottom && (
        <button data-slot="scroll-to-bottom" onClick={() => scrollToBottom('smooth')}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10m0 0l-3.5-3.5M8 13l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
