import { memo, useCallback, useMemo, useRef } from 'react';
import type { Message } from '../../../services/chat';
import { parseAgentContent } from '../agentProtocol';
import { MessageParts, type RenderSegment } from './parts';
import { AssistantActionBar } from './AssistantActionBar';

interface Props {
  sessionId: string;
  message: Message;
  isStreaming: boolean;
}

export const AssistantMessage = memo(function AssistantMessage({ sessionId, message, isStreaming }: Props) {
  const segments = useMemo(() => {
    const turnSegs = message.turn_segs;
    if (turnSegs && turnSegs.length > 0) {
      return turnSegs.flatMap((turn, turnIndex) =>
        parseAgentContent(turn).map((segment, segmentIndex) => ({
          segment,
          turnIndex,
          segmentIndex,
        })),
      );
    }
    return parseAgentContent(message.content).map((segment, segmentIndex) => ({
      segment,
      turnIndex: 0,
      segmentIndex,
    }));
  }, [message.content, message.turn_segs]);

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
