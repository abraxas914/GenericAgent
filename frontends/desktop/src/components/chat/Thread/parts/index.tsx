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
  segments: ParsedSegment[];
  isStreaming: boolean;
  messageId?: string;
}

export const MessageParts = memo(function MessageParts({ segments, isStreaming, messageId = '' }: Props) {
  if (segments.length === 0 && isStreaming) {
    return (
      <div data-slot="aui_assistant-message-content">
        <ResponseLoadingIndicator />
      </div>
    );
  }

  if (segments.length === 0) return null;

  // Stale part fallback: when message is settled, force inFlight to false
  const resolvedSegments = isStreaming ? segments : segments.map(seg =>
    seg.inFlight ? { ...seg, inFlight: false } : seg
  );

  const totalContentLength = resolvedSegments.reduce((acc, s) => acc + s.content.length, 0);
  const hasActiveApproval = resolvedSegments.some(s => s.type === 'approval');

  return (
    <div data-slot="aui_assistant-message-content">
      {resolvedSegments.map((seg, i) => {
        const segKey = `${messageId}-${i}`;
        switch (seg.type) {
          case 'prose':
            return (
              <Suspense key={i} fallback={<span data-slot="aui_markdown-loading" aria-busy="true" />}>
                <MarkdownPart content={seg.content} isStreaming={isStreaming && i === resolvedSegments.length - 1} />
              </Suspense>
            );
          case 'thinking':
            return <ThinkingPart key={i} content={seg.content} isStreaming={!!seg.inFlight || isStreaming} />;
          case 'tool':
            return <ToolPart key={i} name={seg.label || 'tool'} content={seg.content} inFlight={!!seg.inFlight} segmentKey={segKey} isStreaming={isStreaming} />;
          case 'result':
            return <ResultPart key={i} content={seg.content} inFlight={!!seg.inFlight} segmentKey={segKey} isStreaming={isStreaming} />;
          case 'summary':
            return (
              <Suspense key={i} fallback={<span data-slot="aui_summary-loading" aria-busy="true" />}>
                <SummaryPart content={seg.content} />
              </Suspense>
            );
          case 'approval':
            return <ApprovalPart key={i} question={seg.content} candidates={seg.candidates || []} />;
          default:
            return null;
        }
      })}
      {isStreaming && !hasActiveApproval && <StreamStallIndicator contentLength={totalContentLength} />}
    </div>
  );
});
