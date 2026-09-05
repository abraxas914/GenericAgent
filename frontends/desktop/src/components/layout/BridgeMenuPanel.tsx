import { useRef, useEffect, useState } from 'react';
import { useBridgeStatus } from '../../hooks/useBridgeStatus';
import { useConductorStore } from '../../stores/conductor';
import { useAppStore } from '../../stores/app';
import { useI18n } from '../../i18n';
import { fetchServiceLogs } from '../../services/services-api';
import { useLogPolling } from '../../hooks/useLogPolling';
import { LogView } from '../log';

type StatusTone = 'good' | 'warn' | 'bad' | 'muted';

function StatusDot({ tone }: { tone: StatusTone }) {
  const colors: Record<StatusTone, string> = {
    good: 'var(--ui-accent, #0053fd)',
    warn: '#f59e0b',
    bad: '#cf2d56',
    muted: 'color-mix(in srgb, var(--ui-text-tertiary) 40%, transparent)',
  };
  return (
    <span
      aria-hidden="true"
      className={tone === 'warn' ? 'ga-statusbar-dot--pulse' : undefined}
      style={{
        display: 'inline-block',
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: colors[tone],
        flexShrink: 0,
      }}
    />
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M13.5 2.5v4h-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.5 8a5.5 5.5 0 0 1 9.3-3.95L13.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.5 13.5v-4h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13.5 8a5.5 5.5 0 0 1-9.3 3.95L2.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="9" y="2" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="2" y="9" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="9" y="9" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  );
}

const LOG_TABS = [
  { id: '__bridge__', labelKey: 'proc.bridge' },
  { id: 'frontends/conductor.py', labelKey: 'proc.conductor' },
  { id: 'reflect/scheduler.py', labelKey: 'proc.scheduler' },
] as const;

const LOG_PREVIEW_LINES = 12;
const readLogs = (id: string) => fetchServiceLogs(id, 200);

interface Props {
  onClose: () => void;
}

export function BridgeMenuPanel({ onClose }: Props) {
  const { t } = useI18n();
  const bridgeStatus = useBridgeStatus();
  const conductorStatus = useConductorStore((s) => s.connectionStatus);
  const setPage = useAppStore((s) => s.setPage);
  const panelRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<string>(LOG_TABS[0].id);
  const allLines = useLogPolling(activeTab, readLogs);
  const totalLines = allLines?.length ?? 0;
  const lines = allLines?.slice(-LOG_PREVIEW_LINES) ?? null;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const anchor = panelRef.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) {
        onClose();
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const bridgeTone: StatusTone = bridgeStatus === 'ready' ? 'good' : bridgeStatus === 'connecting' ? 'warn' : 'bad';
  const conductorTone: StatusTone = conductorStatus === 'ready' ? 'good'
    : conductorStatus === 'connecting' ? 'warn'
    : conductorStatus === 'error' ? 'bad' : 'muted';

  const bridgeLabel = bridgeStatus === 'ready' ? t('bridge.connected')
    : bridgeStatus === 'connecting' ? t('bridge.connecting') : t('bridge.offline');
  const conductorLabel = conductorStatus === 'ready' ? t('bridge.inferenceReady')
    : conductorStatus === 'connecting' ? t('bridge.inferenceConnecting')
    : conductorStatus === 'error' ? t('bridge.inferenceError') : t('bridge.inferenceOffline');

  const handleOpenServices = () => {
    onClose();
    useAppStore.getState().setServicesTab('status');
    setPage('services');
  };

  const truncated = totalLines > LOG_PREVIEW_LINES;

  return (
    <div
      ref={panelRef}
      id="ga-runtime-management-panel"
      className="ga-bridge-panel"
      data-slot="bridge-panel"
      role="dialog"
      aria-label={t('foot.runtimeManagement')}
    >
      {/* Header */}
      <div className="ga-bridge-panel-header">
        <div className="ga-bridge-panel-status-rows">
          <span className="ga-bridge-panel-row ga-bridge-panel-row--primary">
            <StatusDot tone={bridgeTone} />
            {bridgeLabel}
          </span>
          <span className="ga-bridge-panel-row ga-bridge-panel-row--secondary">
            <StatusDot tone={conductorTone} />
            {conductorLabel}
          </span>
        </div>
        <div className="ga-bridge-panel-actions">
          <button
            className="ga-bridge-panel-action-btn"
            onClick={() => { onClose(); window.location.reload(); }}
            title={t('bridge.refresh')}
          >
            <RefreshIcon />
          </button>
          <button
            className="ga-bridge-panel-action-btn"
            onClick={handleOpenServices}
            title={t('bridge.openServices')}
          >
            <GridIcon />
          </button>
        </div>
      </div>

      {/* Log tabs + preview */}
      <div className="ga-bridge-panel-section">
        <div className="ga-bridge-panel-tabs">
          {LOG_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`ga-bridge-panel-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
        {lines === null ? (
          <div className="ga-bridge-panel-log-empty">…</div>
        ) : lines.length === 0 ? (
          <div className="ga-bridge-panel-log-empty">{t('bridge.noActivity')}</div>
        ) : (
          <LogView className="ga-bridge-panel-log">
            {lines.join('\n')}
          </LogView>
        )}
        <div className="ga-bridge-panel-section-foot">
          {truncated && (
            <span className="ga-bridge-panel-truncated">
              {t('bridge.logLineCount', { count: totalLines })}
            </span>
          )}
          <button className="ga-bridge-panel-link-btn" onClick={handleOpenServices}>
            {t('bridge.viewAllLogs')} →
          </button>
        </div>
      </div>
    </div>
  );
}
