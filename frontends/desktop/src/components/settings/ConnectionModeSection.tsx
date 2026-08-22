import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Radio, RadioGroup, Tag, Toast, Tooltip } from '@douyinfe/semi-ui';
import { useI18n } from '../../i18n';
import { useBridgeStatus } from '../../hooks/useBridgeStatus';
import * as bridge from '../../services/bridge';
import { tauriErrorText } from '../../services/tauri-compat';
import { useAppStore } from '../../stores/app';
import { useChatStore } from '../../stores/chat';
import { useSettingsStore } from '../../stores/settings';
import { isTauri } from '../../utils/tauri';
import { SettingsSectionTitle } from './SettingsSectionTitle';

type ConnectionMode = 'included' | 'localRepository';

const tauriAvailable = isTauri();

function mapConnectionError(message: string, t: (key: string) => string): string {
  if (message.includes('agentmain.py')) return t('connection.errorInvalid');
  if (message.includes('not compatible') || message.includes('compatibility probe')) {
    return t('connection.errorIncompatible');
  }
  if (message.includes('20s') || message.includes('ready')) return t('connection.errorTimeout');
  return t('connection.errorGeneric');
}

export function ConnectionModeSection() {
  const { t } = useI18n();
  const settingsVisible = useSettingsStore((state) => state.visible);
  const runningSessions = useChatStore((state) => state.runningSessions);
  const bridgeStatus = useBridgeStatus();
  const setPage = useAppStore((state) => state.setPage);
  const setServicesTab = useAppStore((state) => state.setServicesTab);
  const [actualMode, setActualMode] = useState<ConnectionMode>('included');
  const [actualPath, setActualPath] = useState('');
  const [pendingMode, setPendingMode] = useState<ConnectionMode>('included');
  const [pendingPath, setPendingPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadCurrentMode = useCallback(async () => {
    if (!tauriAvailable) return;
    setLoading(true);
    try {
      const path = await bridge.tauriInvoke('get_ga_source', {}) as string;
      const mode: ConnectionMode = path ? 'localRepository' : 'included';
      setActualMode(mode);
      setActualPath(path || '');
      setPendingMode(mode);
      setPendingPath(path || '');
    } catch (error) {
      console.error('[ConnectionMode] load current mode failed:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settingsVisible) void loadCurrentMode();
  }, [loadCurrentMode, settingsVisible]);

  const chooseRepository = useCallback(async () => {
    setValidating(true);
    try {
      const picked = await bridge.tauriInvoke('pick_directory', {
        title: t('connection.repositoryPickerTitle'),
      }) as string | null;
      if (!picked) return;
      const validated = await bridge.tauriInvoke('validate_ga_source', { dir: picked }) as string;
      setPendingPath(validated);
      setPendingMode('localRepository');
      Toast.success({ content: t('connection.repositoryValidated') });
    } catch (error) {
      console.error('[ConnectionMode] validate repository failed:', error);
      const message = tauriErrorText(error);
      if (!message.includes('Tauri IPC')) {
        Toast.error({ content: mapConnectionError(message, t) });
      }
    } finally {
      setValidating(false);
    }
  }, [t]);

  const handleModeSelection = useCallback((mode: ConnectionMode) => {
    if (mode === 'included') {
      setPendingMode('included');
      return;
    }
    if (pendingPath) {
      setPendingMode('localRepository');
      return;
    }
    void chooseRepository();
  }, [chooseRepository, pendingPath]);

  const dirty = actualMode !== pendingMode
    || (pendingMode === 'localRepository' && pendingPath !== actualPath);
  const pendingRepositoryChanged = pendingMode === 'localRepository'
    && (actualMode !== 'localRepository' || pendingPath !== actualPath);
  const displayedRepositoryPath = pendingMode === 'localRepository' ? pendingPath : actualPath;
  const hasRunningTasks = runningSessions.size > 0;
  const applyDisabled = loading || validating || applying || !dirty || hasRunningTasks;

  const handleApply = useCallback(async () => {
    if (applyDisabled) return;
    setApplying(true);
    try {
      if (pendingMode === 'localRepository') {
        await bridge.tauriInvoke('set_ga_source', { dir: pendingPath });
      } else {
        await bridge.tauriInvoke('clear_ga_source', {});
      }
      await Promise.allSettled([
        useChatStore.getState().loadSessions(),
        useSettingsStore.getState().loadFromBridge(),
      ]);
      const nextPath = pendingMode === 'localRepository' ? pendingPath : '';
      setActualMode(pendingMode);
      setActualPath(nextPath);
      Toast.success({
        content: pendingMode === 'localRepository'
          ? t('connection.localSuccess')
          : t('connection.includedSuccess'),
      });
    } catch (error) {
      console.error('[ConnectionMode] apply failed:', error);
      Toast.error({ content: mapConnectionError(tauriErrorText(error), t) });
    } finally {
      setApplying(false);
    }
  }, [applyDisabled, pendingMode, pendingPath, t]);

  const handleOpenStatus = useCallback(() => {
    setServicesTab('status');
    setPage('services');
    useSettingsStore.getState().close();
  }, [setPage, setServicesTab]);

  const statusKey = useMemo(() => {
    if (bridgeStatus === 'ready') return 'connection.statusReady';
    if (bridgeStatus === 'connecting') return 'connection.statusConnecting';
    return 'connection.statusUnavailable';
  }, [bridgeStatus]);

  const statusDot = bridgeStatus === 'ready'
    ? 'on'
    : bridgeStatus === 'connecting'
      ? 'switching'
      : 'unavailable';

  if (!tauriAvailable) return null;

  return (
    <div className="ga-set-block ga-connection-section" data-testid="connection-mode-section">
      <SettingsSectionTitle
        tip={t('connection.sectionTip')}
        tipLabel={t('connection.sectionHelp')}
      >
        {t('connection.title')}
      </SettingsSectionTitle>
      <p className="ga-connection-description">{t('connection.description')}</p>

      <RadioGroup
        aria-label={t('connection.title')}
        name="desktop-connection-mode"
        type="pureCard"
        value={pendingMode}
        disabled={loading || applying}
        onChange={(event) => handleModeSelection(event.target.value as ConnectionMode)}
        className="ga-connection-mode-grid"
      >
        <Radio
          value="included"
          className="ga-connection-mode-card"
          extra={t('connection.includedDescription')}
        >
          <Tooltip content={t('connection.includedTip')} position="topLeft">
            <span
              className="ga-connection-card-title"
              tabIndex={0}
              aria-label={`${t('connection.included')}：${t('connection.includedTip')}`}
            >
              {t('connection.included')}
              {actualMode === 'included' && <Tag size="small" color="green">{t('connection.current')}</Tag>}
            </span>
          </Tooltip>
        </Radio>
        <Radio
          value="localRepository"
          className="ga-connection-mode-card"
          extra={t('connection.localDescription')}
        >
          <Tooltip content={t('connection.localTip')} position="topLeft">
            <span
              className="ga-connection-card-title"
              tabIndex={0}
              aria-label={`${t('connection.local')}：${t('connection.localTip')}`}
            >
              {t('connection.local')}
              {actualMode === 'localRepository' && <Tag size="small" color="green">{t('connection.current')}</Tag>}
            </span>
          </Tooltip>
        </Radio>
      </RadioGroup>

      {(pendingMode === 'localRepository' || actualMode === 'localRepository') && (
        <div className="ga-connection-repository-detail">
          <div className="ga-connection-repository-header">
            <span>
              {pendingRepositoryChanged
                ? t('connection.pendingRepository')
                : t('connection.currentRepository')}
            </span>
            <Button
              size="small"
              type="tertiary"
              loading={validating}
              disabled={applying}
              onClick={chooseRepository}
            >
              {pendingPath ? t('connection.changeRepository') : t('connection.chooseRepository')}
            </Button>
          </div>
          {displayedRepositoryPath && (
            <code className="ga-connection-path">{displayedRepositoryPath}</code>
          )}
        </div>
      )}

      <div className="ga-connection-apply-row">
        <div className="ga-connection-apply-note" role="status">
          {hasRunningTasks ? t('connection.runningTaskBlock') : dirty ? t('connection.pendingNotice') : ''}
        </div>
        <Button
          type="primary"
          loading={applying}
          disabled={applyDisabled}
          onClick={handleApply}
        >
          {applying ? t('connection.applying') : t('connection.apply')}
        </Button>
      </div>

      <div className="ga-connection-status-row">
        <div className="ga-connection-status-copy">
          <span className={`ga-source-dot ga-source-dot--${statusDot}`} />
          <Tooltip content={t('connection.statusTip')} position="topLeft">
            <span
              className="ga-connection-status-label"
              tabIndex={0}
              aria-label={`${t('connection.status')}：${t('connection.statusTip')}`}
            >
              {t('connection.status')}
            </span>
          </Tooltip>
          <strong>{t(statusKey)}</strong>
        </div>
        <Button size="small" type="tertiary" onClick={handleOpenStatus}>
          {t('connection.viewStatus')}
        </Button>
      </div>
    </div>
  );
}
