import { memo, useRef, useCallback, useEffect } from 'react';
import { useSegmentDisclosure } from '../../../../stores/thread-view';

interface Props {
  sessionId: string;
  segmentKey: string;
  content: string;
  isStreaming: boolean;
}

export const ThinkingPart = memo(function ThinkingPart({ sessionId, segmentKey, content, isStreaming }: Props) {
  const { expanded, setExpanded } = useSegmentDisclosure(sessionId, segmentKey, isStreaming);
  const bodyRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setExpanded(!expanded);
  }, [expanded, setExpanded]);

  useEffect(() => {
    if (isStreaming && expanded && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [content, expanded, isStreaming]);

  if (!content.trim()) return null;

  return (
    <details
      data-slot="aui_thinking-disclosure"
      open={expanded}
    >
      <summary data-slot="thinking-summary" onClick={handleToggle}>
        <span className={isStreaming ? 'thinking-shimmer' : ''}>Thinking</span>
      </summary>
      <div
        ref={bodyRef}
        data-slot="thinking-body"
        data-streaming={isStreaming || undefined}
      >
        {content}
      </div>
    </details>
  );
});
