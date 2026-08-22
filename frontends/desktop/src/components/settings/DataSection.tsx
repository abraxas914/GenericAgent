import { useCallback, useState } from 'react';
import { Button, Modal, Toast, Tooltip } from '@douyinfe/semi-ui';
import { useI18n } from '../../i18n';
import * as bridge from '../../services/bridge';
import {
  backupFilename,
  exportData,
  importData,
  inspectDataImport,
  type BackupInspection,
} from '../../services/dataBackup';
import { useChatStore } from '../../stores/chat';
import { useSettingsStore } from '../../stores/settings';

const isTauri = !!(window as any).__TAURI__;

interface OpRowProps {
  label: string;
  tip: string;
  btnText: string;
  onClick: () => void;
  disabled?: boolean;
}

function OpRow({ label, tip, btnText, onClick, disabled }: OpRowProps) {
  return (
    <div className="ga-data-row">
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
      if (isTauri) {
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
          const copied = (result.memoryCopied || 0)
            + (result.responsesCopied || 0)
            + (result.sessionsAdded || 0);
          const skipped = (result.memorySkipped || 0)
            + (result.responsesSkipped || 0)
            + (result.sessionsSkipped || 0);
          Toast.success({ content: t('data.importDataSuccess', { copied, skipped }) });
          await useChatStore.getState().loadSessions();
        } catch (error) {
          console.error('[DataSection] import data failed:', error);
          Toast.error({ content: t('data.importDataError') });
        } finally {
          setImporting(false);
        }
      },
    });
  }, [lang, t]);

  const chooseImportSource = useCallback(async (kind: 'backup' | 'folder') => {
    setSourceModalVisible(false);
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
  }, [confirmImport, t]);

  const handleExportData = useCallback(() => {
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
          Toast.error({ content: t('data.exportDataError') });
        } finally {
          setExporting(false);
        }
      },
    });
  }, [lang, t]);

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
      <div className="ga-set-sec-t">{t('data.title')}</div>
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
      {isTauri && (
        <>
          <OpRow
            label={t('data.importData')}
            tip={t('data.importDataTip')}
            btnText={importing ? t('data.importing') : t('data.importDataBtn')}
            onClick={() => setSourceModalVisible(true)}
            disabled={importing || exporting}
          />
          <OpRow
            label={t('data.exportData')}
            tip={t('data.exportDataTip')}
            btnText={exporting ? t('data.exporting') : t('data.exportDataBtn')}
            onClick={handleExportData}
            disabled={importing || exporting}
          />
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
            <Button onClick={() => chooseImportSource('folder')}>{t('data.importFolderBtn')}</Button>
            <Button type="primary" onClick={() => chooseImportSource('backup')}>{t('data.importBackupBtn')}</Button>
          </div>
        )}
      >
        <p className="ga-data-source-description">{t('data.importSourceDescription')}</p>
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
