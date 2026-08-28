import { memo, useCallback, useRef, useState } from 'react';
import './AssistantActionBar.css';

interface Props {
  getMessageText: () => string;
  executionMs?: number;
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

export const AssistantActionBar = memo(function AssistantActionBar({ getMessageText, executionMs }: Props) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleCopy = useCallback(() => {
    const text = getMessageText();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [getMessageText]);

  if (typeof navigator === 'undefined' || !navigator.clipboard) return null;

  return (
    <div data-slot="assistant-action-bar">
      <button
        data-slot="action-bar-btn"
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy'}
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="5.5" y="5.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M3.5 10.5v-7a1 1 0 011-1h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {typeof executionMs === 'number' && executionMs > 0 && (
        <span data-slot="action-bar-duration" title="本轮用时">
          {formatDuration(executionMs)}
        </span>
      )}
    </div>
  );
});
