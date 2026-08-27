import { lazy, memo, Suspense } from 'react';
import type { ParsedSegment } from '../../agentProtocol';
import { ThinkingPart } from './ThinkingPart';
import { ToolPart } from './ToolPart';
import { ResultPart } from './ResultPart';
import { ApprovalPart } from './ApprovalPart';
import { ResponseLoadingIndicator, StreamStallIndicator } from '../StreamIndicators';

const MarkdownPart = lazy(async () => {
  const module = await import('./MarkdownPart');
  return { default: module.MarkdownPart };
});
const SummaryPart = lazy(async () => {
  const module = await import('./SummaryPart');
  return { default: module.SummaryPart };
});

interface Props {
  sessionId: string;
  segments: RenderSegment[];
  isStreaming: boolean;
  messageId?: string;
}

export interface RenderSegment {
  segment: ParsedSegment;
  turnIndex: number;
  segmentIndex: number;
}

export function stableSegmentId(
  sessionId: string,
  messageId: string,
  turnIndex: number,
  segmentIndex: number,
  segmentType: ParsedSegment['type'],
): string {
  return [sessionId, messageId, turnIndex, segmentIndex, segmentType]
    .map((part) => encodeURIComponent(String(part)))
    .join(':');
}

export const MessageParts = memo(function MessageParts({
  sessionId,
  segments,
  isStreaming,
  messageId = '',
}: Props) {
  if (segments.length === 0 && isStreaming) {
    return (
      <div data-slot="aui_assistant-message-content">
        <ResponseLoadingIndicator />
      </div>
    );
  }

  if (segments.length === 0) return null;

  // Stale part fallback: when message is settled, force inFlight to false
  const resolvedSegments = isStreaming ? segments : segments.map(entry =>
    entry.segment.inFlight
      ? { ...entry, segment: { ...entry.segment, inFlight: false } }
      : entry
  );

  const totalContentLength = resolvedSegments.reduce((acc, entry) => acc + entry.segment.content.length, 0);
  const hasActiveApproval = resolvedSegments.some(entry => entry.segment.type === 'approval');

  return (
    <div data-slot="aui_assistant-message-content">
      {resolvedSegments.map(({ segment: seg, turnIndex, segmentIndex }, i) => {
        const segKey = stableSegmentId(sessionId, messageId, turnIndex, segmentIndex, seg.type);
        switch (seg.type) {
          case 'prose':
            return (
              <Suspense key={segKey} fallback={<span data-slot="aui_markdown-loading" aria-busy="true" />}>
                <MarkdownPart content={seg.content} isStreaming={isStreaming && i === resolvedSegments.length - 1} />
              </Suspense>
            );
          case 'thinking':
            return <ThinkingPart key={segKey} sessionId={sessionId} segmentKey={segKey} content={seg.content} isStreaming={!!seg.inFlight || isStreaming} />;
          case 'tool':
            return <ToolPart key={segKey} sessionId={sessionId} name={seg.label || 'tool'} content={seg.content} inFlight={!!seg.inFlight} segmentKey={segKey} isStreaming={isStreaming} />;
          case 'result':
            return <ResultPart key={segKey} sessionId={sessionId} content={seg.content} inFlight={!!seg.inFlight} segmentKey={segKey} isStreaming={isStreaming} />;
          case 'summary':
            return (
              <Suspense key={segKey} fallback={<span data-slot="aui_summary-loading" aria-busy="true" />}>
                <SummaryPart content={seg.content} />
              </Suspense>
            );
          case 'approval':
            return <ApprovalPart key={segKey} question={seg.content} candidates={seg.candidates || []} />;
          default:
            return null;
        }
      })}
      {isStreaming && !hasActiveApproval && <StreamStallIndicator contentLength={totalContentLength} />}
    </div>
  );
});
