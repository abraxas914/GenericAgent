import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Toast, Tooltip } from '@douyinfe/semi-ui';
import { useI18n } from '../../i18n';
import * as bridge from '../../services/bridge';
import {
  backupFilename,
  exportData,
  importData,
  inspectDataImport,
  supportsDataBackupApi,
  DataBackupError,
  type BackupInspection,
  type DataBackupAvailability,
  type DataImportResult,
} from '../../services/dataBackup';
import { useChatStore } from '../../stores/chat';
import { useServicesStore } from '../../stores/services';
import { useSettingsStore } from '../../stores/settings';
import { isTauri } from '../../utils/tauri';
import { SettingsSectionTitle } from './SettingsSectionTitle';

const tauriAvailable = isTauri();

interface OpRowProps {
  label: string;
  tip: string;
  btnText: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}

function OpRow({ label, tip, btnText, onClick, disabled, testId }: OpRowProps) {
  return (
    <div className="ga-data-row" data-testid={testId}>
      <div className="ga-data-row-info">
        <Tooltip content={tip}>
          <span className="ga-data-row-label" tabIndex={0}>{label}</span>
        </Tooltip>
      </div>
      <Button
        className="ga-data-action"
        size="small"
        type="tertiary"
        onClick={onClick}
        disabled={disabled}
      >
        {btnText}
      </Button>
    </div>
  );
}

function inspectionTime(value: string | null, lang: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function DataSection() {
  const { lang, t } = useI18n();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sourceModalVisible, setSourceModalVisible] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<DataImportResult | null>(null);
  const [dataBackupAvailable, setDataBackupAvailable] = useState<DataBackupAvailability>(null);
  const runningSessionCount = useChatStore((state) => {
    const runningIds = new Set(state.runningSessions);
    state.sessions.forEach((session) => {
      if (session.status === 'running') runningIds.add(session.id);
    });
    if (state.status === 'running') {
      runningIds.add(state.activeSessionId || '__active_session__');
    }
    return runningIds.size;
  });
  const serviceStates = useServicesStore((state) => state.services);
  const runningManagedServices = serviceStates.filter(
    (service) => service.managed && service.running,
  );
  const maintenanceBlocked = runningSessionCount > 0 || runningManagedServices.length > 0;

  useEffect(() => {
    if (!tauriAvailable) return;
    let active = true;
    void supportsDataBackupApi().then((available) => {
      if (active) setDataBackupAvailable(available);
    });
    void useServicesStore.getState().fetchServices();
    return () => {
      active = false;
    };
  }, []);

  const maintenanceMessage = useCallback(() => t('data.maintenanceBlocked', {
    sessions: runningSessionCount,
    services: runningManagedServices.length,
  }), [runningManagedServices.length, runningSessionCount, t]);

  const showDataError = useCallback((error: unknown, fallbackKey: string) => {
    if (error instanceof DataBackupError && error.code === 'maintenance_conflict') {
      Toast.error({
        content: t('data.maintenanceBlockedServer', {
          sessions: error.runningSessions.length,
          services: error.runningExtras.length,
        }),
      });
      return;
    }
    Toast.error({ content: t(fallbackKey) });
  }, [t]);

  const handleImportKey = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.py,text/plain';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        await bridge.saveMykeyContent(text);
        await useSettingsStore.getState().loadFromBridge();
        Toast.success({ content: t('data.importKeySuccess') });
      } catch (error) {
        console.error('[DataSection] import key config failed:', error);
        Toast.error({ content: t('data.importKeyError') });
      }
    };
    input.click();
  }, [t]);

  const handleExportKey = useCallback(async () => {
    try {
      const content = await bridge.getMykeyContent();
      if (tauriAvailable) {
        try {
          const path = await bridge.tauriInvoke('export_mykey', { content });
          if (path) Toast.success({ content: t('data.exportKeySuccess') });
        } catch {
          downloadAsFile(content, 'mykey.py');
          Toast.success({ content: t('data.exportKeySuccess') });
        }
      } else {
        downloadAsFile(content, 'mykey.py');
        Toast.success({ content: t('data.exportKeySuccess') });
      }
    } catch (error) {
      console.error('[DataSection] export key config failed:', error);
      Toast.error({ content: t('data.exportKeyError') });
    }
  }, [t]);

  const confirmImport = useCallback((sourcePath: string, inspection: BackupInspection) => {
    const sourceLabel = inspection.sourceType === 'legacyFolder'
      ? t('data.importLegacySource')
      : inspection.sourceMode === 'localRepository'
        ? t('connection.local')
        : t('connection.included');
    const { memory, responses, sessions } = inspection.content;
    Modal.confirm({
      title: t('data.importConfirmTitle'),
      content: (
        <div className="ga-data-confirm-summary">
          {inspection.sourceType === 'backupZip' && (
            <div><span>{t('data.importExportedAt')}</span><strong>{inspectionTime(inspection.exportedAt, lang)}</strong></div>
          )}
          <div><span>{t('data.importSource')}</span><strong>{sourceLabel}</strong></div>
          <div>
            <span>{t('data.importContents')}</span>
            <strong>{t('data.importContentsValue', { memory, sessions, responses })}</strong>
          </div>
          <p>{t('data.importMergeNotice')}</p>
        </div>
      ),
      okText: t('data.importConfirmBtn'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        setImporting(true);
        try {
          const result = await importData(sourcePath);
          Toast.success({
            content: t('data.importDataSuccess', {
              memory: result.memoryCopied || 0,
              responses: result.responsesCopied || 0,
              sessions: result.sessionsAdded || 0,
            }),
          });
          await useChatStore.getState().loadSessions();
          setImportResult(result);
        } catch (error) {
          console.error('[DataSection] import data failed:', error);
          showDataError(error, 'data.importDataError');
        } finally {
          setImporting(false);
        }
      },
    });
  }, [lang, showDataError, t]);

  const chooseImportSource = useCallback(async (kind: 'backup' | 'folder') => {
    setSourceModalVisible(false);
    if (maintenanceBlocked) {
      Toast.warning({ content: maintenanceMessage() });
      return;
    }
    try {
      const sourcePath = kind === 'backup'
        ? await bridge.tauriInvoke('pick_data_backup_file', { title: t('data.importBackupPickerTitle') })
        : await bridge.tauriInvoke('pick_directory', { title: t('data.importFolderPickerTitle') });
      if (!sourcePath) return;
      setImporting(true);
      const inspection = await inspectDataImport(sourcePath as string);
      setImporting(false);
      confirmImport(sourcePath as string, inspection);
    } catch (error) {
      setImporting(false);
      console.error('[DataSection] inspect import source failed:', error);
      Toast.error({ content: t('data.importDataInvalid') });
    }
  }, [confirmImport, maintenanceBlocked, maintenanceMessage, t]);

  const handleExportData = useCallback(() => {
    if (maintenanceBlocked) {
      Toast.warning({ content: maintenanceMessage() });
      return;
    }
    Modal.confirm({
      title: t('data.exportDataConfirmTitle'),
      content: t('data.exportDataConfirmMessage'),
      okText: t('data.exportDataConfirmBtn'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          const destinationPath = await bridge.tauriInvoke('pick_data_export_path', {
            defaultName: backupFilename(lang),
            title: t('data.exportDataPickerTitle'),
          }) as string | null;
          if (!destinationPath) return;
          setExporting(true);
          const currentRepository = await bridge.tauriInvoke('get_ga_source', {}) as string;
          const result = await exportData(
            destinationPath,
            currentRepository ? 'localRepository' : 'included',
          );
          window.setTimeout(() => setExportedPath(result.path), 0);
        } catch (error) {
          console.error('[DataSection] export data failed:', error);
          showDataError(error, 'data.exportDataError');
        } finally {
          setExporting(false);
        }
      },
    });
  }, [lang, maintenanceBlocked, maintenanceMessage, showDataError, t]);

  const handleRevealExport = useCallback(async () => {
    if (!exportedPath) return;
    try {
      await bridge.tauriInvoke('reveal_in_file_manager', { path: exportedPath });
      setExportedPath(null);
    } catch (error) {
      console.error('[DataSection] reveal export failed:', error);
      Toast.error({ content: t('data.exportDataRevealError') });
    }
  }, [exportedPath, t]);

  return (
    <div className="ga-set-block" data-testid="data-maintenance-section">
      <SettingsSectionTitle tip={t('data.sectionTip')} tipLabel={t('data.sectionHelp')}>
        {t('data.title')}
      </SettingsSectionTitle>
      <OpRow
        label={t('data.importKey')}
        tip={t('data.importKeyTip')}
        btnText={t('data.importKeyBtn')}
        onClick={handleImportKey}
      />
      <OpRow
        label={t('data.exportKey')}
        tip={t('data.exportKeyTip')}
        btnText={t('data.exportKeyBtn')}
        onClick={handleExportKey}
      />
      {tauriAvailable && dataBackupAvailable !== false && (
        <>
          <OpRow
            testId="data-import-row"
            label={t('data.importData')}
            tip={t('data.importDataTip')}
            btnText={importing ? t('data.importing') : t('data.importDataBtn')}
            onClick={() => setSourceModalVisible(true)}
            disabled={importing || exporting || maintenanceBlocked}
          />
          <OpRow
            testId="data-export-row"
            label={t('data.exportData')}
            tip={t('data.exportDataTip')}
            btnText={exporting ? t('data.exporting') : t('data.exportDataBtn')}
            onClick={handleExportData}
            disabled={importing || exporting || maintenanceBlocked}
          />
          {maintenanceBlocked && (
            <p className="ga-data-maintenance-note" role="status">{maintenanceMessage()}</p>
          )}
          <p className="ga-data-maintenance-note">{t('data.externalProcessWarning')}</p>
        </>
      )}

      <Modal
        visible={sourceModalVisible}
        title={t('data.importSourceTitle')}
        width={520}
        onCancel={() => setSourceModalVisible(false)}
        footer={(
          <div className="ga-data-source-actions">
            <Button onClick={() => setSourceModalVisible(false)}>{t('common.cancel')}</Button>
            <Button disabled={maintenanceBlocked} onClick={() => chooseImportSource('folder')}>{t('data.importFolderBtn')}</Button>
            <Button disabled={maintenanceBlocked} type="primary" onClick={() => chooseImportSource('backup')}>{t('data.importBackupBtn')}</Button>
          </div>
        )}
      >
        <p className="ga-data-source-description">{t('data.importSourceDescription')}</p>
      </Modal>

      <Modal
        visible={!!importResult}
        title={t('data.importResultTitle')}
        width={620}
        onCancel={() => setImportResult(null)}
        footer={<Button type="primary" onClick={() => setImportResult(null)}>{t('common.done')}</Button>}
      >
        {importResult && (
          <div className="ga-data-confirm-summary">
            <div>
              <span>{t('data.importResultMemory')}</span>
              <strong>{t('data.importResultMemoryValue', { count: importResult.memoryCopied || 0 })}</strong>
            </div>
            <div>
              <span>{t('data.importResultResponses')}</span>
              <strong>{t('data.importResultAddSkipValue', {
                added: importResult.responsesCopied || 0,
                skipped: importResult.responsesSkipped || 0,
              })}</strong>
            </div>
            <div>
              <span>{t('data.importResultSessions')}</span>
              <strong>{t('data.importResultAddSkipValue', {
                added: importResult.sessionsAdded || 0,
                skipped: importResult.sessionsSkipped || 0,
              })}</strong>
            </div>
            <div>
              <span>{t('data.importResultBackup')}</span>
              {importResult.backupDir
                ? <code className="ga-data-export-path ga-data-export-path--inline">{importResult.backupDir}</code>
                : <strong>{t('data.importResultNoBackup')}</strong>}
            </div>
            <p>{importResult.backupDir
              ? t('data.importRestoreHint')
              : t('data.importNoRestoreNeeded')}</p>
          </div>
        )}
      </Modal>

      <Modal
        visible={!!exportedPath}
        title={t('data.exportDataSuccessTitle')}
        width={560}
        onCancel={() => setExportedPath(null)}
        footer={(
          <div className="ga-data-source-actions">
            <Button onClick={() => setExportedPath(null)}>{t('common.done')}</Button>
            <Button type="primary" onClick={handleRevealExport}>{t('data.exportDataReveal')}</Button>
          </div>
        )}
      >
        <p>{t('data.exportDataSuccessMessage')}</p>
        {exportedPath && <code className="ga-data-export-path">{exportedPath}</code>}
      </Modal>
    </div>
  );
}

function downloadAsFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
