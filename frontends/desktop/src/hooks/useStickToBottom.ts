import { useRef, useState, useCallback, useEffect } from 'react';

const BOTTOM_THRESHOLD = 24;

interface StickToBottomOptions {
  followingTail?: boolean;
  onScrollStateChange?: (scrollTop: number, followingTail: boolean) => void;
}

export function useStickToBottom({
  followingTail = true,
  onScrollStateChange,
}: StickToBottomOptions = {}) {
  const scrollRef = useRef<HTMLDivElement>(null!);
  const [isAtBottom, setIsAtBottom] = useState(followingTail);
  const stickingRef = useRef(followingTail);
  const rafRef = useRef<number>(0);
  const onScrollStateChangeRef = useRef(onScrollStateChange);
  onScrollStateChangeRef.current = onScrollStateChange;

  useEffect(() => {
    stickingRef.current = followingTail;
    setIsAtBottom(followingTail);
  }, [followingTail]);

  const checkBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    setIsAtBottom(atBottom);
    stickingRef.current = atBottom;
    onScrollStateChangeRef.current?.(el.scrollTop, atBottom);
  }, []);

  const scrollToBottom = useCallback((behavior: 'instant' | 'smooth' = 'instant') => {
    const el = scrollRef.current;
    if (!el) return;
    if (behavior === 'instant') {
      el.scrollTop = el.scrollHeight;
    } else {
      jumpScroll(el, el.scrollHeight - el.clientHeight, 170);
    }
    stickingRef.current = true;
    setIsAtBottom(true);
    onScrollStateChangeRef.current?.(el.scrollTop, true);
  }, []);

  const stopScroll = useCallback((notify = true) => {
    stickingRef.current = false;
    setIsAtBottom(false);
    const el = scrollRef.current;
    if (notify && el) onScrollStateChangeRef.current?.(el.scrollTop, false);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => checkBottom();

    const observer = new MutationObserver(() => {
      if (stickingRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    });

    el.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [checkBottom]);

  return { scrollRef, isAtBottom, scrollToBottom, stopScroll };
}

function jumpScroll(el: HTMLElement, targetTop: number, duration: number) {
  const start = el.scrollTop;
  const diff = targetTop - start;
  const startTime = performance.now();

  function step(now: number) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.scrollTop = start + diff * ease;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function useSessionScrollStability(
  scrollRef: React.RefObject<HTMLDivElement>,
  scrollToBottom: (b?: 'instant') => void,
  stopScroll: (notify?: boolean) => void,
  sessionKey: string | null,
  followingTail: boolean,
  scrollTop: number | null,
) {
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !sessionKey) return;

    stopScroll(false);
    const restore = () => {
      el.scrollTop = followingTail ? el.scrollHeight : (scrollTop ?? 0);
    };
    restore();

    let stableFrames = 0;
    let lastHeight = el.scrollHeight;
    let frame = 0;
    let rafId = 0;
    let cancelled = false;

    function check() {
      if (!el || cancelled) return;
      frame++;
      if (el.scrollHeight === lastHeight) {
        stableFrames++;
      } else {
        stableFrames = 0;
        lastHeight = el.scrollHeight;
        restore();
      }
      if (stableFrames >= 5 || frame >= 90) {
        if (followingTail) scrollToBottom('instant');
        else {
          restore();
          stopScroll(false);
        }
        return;
      }
      rafId = requestAnimationFrame(check);
    }
    rafId = requestAnimationFrame(check);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [sessionKey, scrollRef, scrollToBottom, stopScroll]);
}
