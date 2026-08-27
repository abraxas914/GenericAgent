import { memo, useRef } from 'react';
import { useEnterAnimation } from '../../../../hooks/useEnterAnimation';
import { useToolTimer } from '../../../../hooks/useToolTimer';
import { useSegmentDisclosure } from '../../../../stores/thread-view';

interface Props {
  sessionId: string;
  name: string;
  content: string;
  inFlight: boolean;
  segmentKey?: string;
  isStreaming?: boolean;
}

export const ToolPart = memo(function ToolPart({ sessionId, name, content, inFlight, segmentKey = '', isStreaming = false }: Props) {
  const { expanded, setExpanded } = useSegmentDisclosure(
    sessionId,
    segmentKey,
    inFlight || isStreaming,
  );
  const ref = useRef<HTMLDivElement>(null);
  useEnterAnimation(ref, segmentKey, isStreaming);
  const { elapsed, duration } = useToolTimer(segmentKey, inFlight);

  return (
    <div ref={ref} data-slot="tool-block" data-tool-row data-status={inFlight ? 'running' : 'success'}>
      <div data-slot="tool-header" onClick={() => setExpanded(!expanded)}>
        {inFlight && (
          <span data-slot="tool-glyph">
            <span data-slot="tool-spinner" />
          </span>
        )}
        <span data-slot="tool-title">{name}</span>
        {inFlight && <span data-slot="tool-dots">&hellip;</span>}
        {elapsed && <span data-slot="tool-duration">{elapsed}</span>}
        {duration && <span data-slot="tool-duration">{duration}</span>}
      </div>
      {expanded && content && (
        <pre data-slot="tool-body">{content}</pre>
      )}
    </div>
  );
});
