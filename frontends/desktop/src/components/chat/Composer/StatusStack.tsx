import { useChatStore } from '../../../stores/chat';
import { useSettingsStore } from '../../../stores/settings';

const LABELS = {
  thinking: { zh: '思考中…', en: 'Thinking…' },
  queued: { zh: '排队中', en: 'Queued' },
};

export function StatusStack() {
  const isGenerating = useChatStore((s) => s.status === 'running');
  const queue = useChatStore((s) => s.pendingQueue);
  const cancelQueued = useChatStore((s) => s.cancelQueued);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const failedSends = useChatStore((s) => s.failedSends);
  const retryFailed = useChatStore((s) => s.retryFailed);
  const failures = failedSends.filter((item) => item.sessionId === activeSessionId);
  const lang = useSettingsStore((s) => s.lang);

  if (!isGenerating && queue.length === 0 && failures.length === 0) return null;

  const t = (key: keyof typeof LABELS) => LABELS[key][lang] || LABELS[key].en;

  return (
    <div data-slot="composer-status-stack">
      {failures.map((item) => (
        <div key={item.id} role="alert" data-slot="send-failed">
          <span>{lang === 'zh' ? '发送未确认，请检查会话：' : 'Send unconfirmed; check the conversation: '}{item.error}</span>
          <button onClick={() => void retryFailed(item.id)}>{lang === 'zh' ? '重试' : 'Retry'}</button>
        </div>
      ))}
      {isGenerating && (
        <div data-slot="status-running">
          <span data-slot="status-dot" />
          <span data-slot="status-label">{t('thinking')}</span>
        </div>
      )}
      {queue.map((item, i) => (
        <div key={i} data-slot="status-queued">
          <span data-slot="status-queue-num">#{i + 1}</span>
          <span data-slot="status-queue-text">{item.text.slice(0, 40)}{item.text.length > 40 ? '…' : ''}</span>
          <button data-slot="status-queue-cancel" onClick={() => cancelQueued(i)} aria-label="Cancel">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
