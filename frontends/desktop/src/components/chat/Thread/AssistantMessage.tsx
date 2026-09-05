import { memo, useCallback, useMemo, useRef } from 'react';
import type { Message } from '../../../services/chat';
import { messageTurns } from '../../../lib/thread-grouping';
import { MessageParts, type RenderSegment } from './parts';
import { AssistantActionBar } from './AssistantActionBar';

interface Props {
  sessionId: string;
  message: Message;
  isStreaming: boolean;
}

export const AssistantMessage = memo(function AssistantMessage({ sessionId, message, isStreaming }: Props) {
  const segments = useMemo(() => messageTurns(message).flatMap((turn) =>
    turn.segments.map((segment, segmentIndex) => ({
      segment,
      turnIndex: turn.index,
      segmentIndex,
    })),
  ), [message]);

  const segmentsRef = useRef<RenderSegment[]>(segments);
  segmentsRef.current = segments;

  const getMessageText = useCallback(() => {
    const segs = segmentsRef.current;
    const texts: string[] = [];
    for (const { segment: seg } of segs) {
      if (seg.type === 'prose' || seg.type === 'summary') {
        texts.push(seg.content);
      }
    }
    return texts.join('\n\n');
  }, []);

  return (
    <div
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      data-streaming={isStreaming || undefined}
    >
      <MessageParts
        sessionId={sessionId}
        segments={segments}
        isStreaming={isStreaming}
        messageId={String(message.id)}
      />
      <AssistantActionBar getMessageText={getMessageText} executionMs={message.executionMs} />
    </div>
  );
});
