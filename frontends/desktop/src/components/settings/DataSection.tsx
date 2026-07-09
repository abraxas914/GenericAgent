import { useState, useCallback } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import { useI18n } from '../../i18n';
import * as bridge from '../../services/bridge';
import { useChatStore } from '../../stores/chat';
import { GaSourceBlock } from './GaSourceBlock';

const isTauri = !!(window as any).__TAURI__;

interface OpRowProps {
  label: string;
  desc: string;
  btnText: string;
  onClick: () => void;
  disabled?: boolean;
}

function OpRow({ label, desc, btnText, onClick, disabled }: OpRowProps) {
  return (
    <div className="ga-data-row">
      <div className="ga-data-row-info">
        <div className="ga-data-row-label">{label}</div>
        <div className="ga-data-row-desc">{desc}</div>
      </div>
      <Button size="small" type="tertiary" onClick={onClick} disabled={disabled}>
        {btnText}
      </Button>
    </div>
  );
}

export function DataSection() {
  const { t } = useI18n();
  const [importing, setImporting] = useState(false);

  const handleImportMykey = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.py,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        await bridge.saveMykeyContent(text);
        Toast.success({ content: t('data.importMykeySuccess') });
      } catch {
        Toast.error({ content: t('data.importMykeyError') });
      }
    };
    input.click();
  }, [t]);

  const handleExportMykey = useCallback(async () => {
    try {
      const content = await bridge.getMykeyContent();
      if (isTauri) {
        try {
          const path = await bridge.tauriInvoke('export_mykey', { content });
          if (path) Toast.success({ content: t('data.exportMykeySuccess') });
        } catch {
          downloadAsFile(content, 'mykey.py');
          Toast.success({ content: t('data.exportMykeySuccess') });
        }
      } else {
        downloadAsFile(content, 'mykey.py');
        Toast.success({ content: t('data.exportMykeySuccess') });
      }
    } catch {
      Toast.error({ content: t('data.exportMykeyError') });
    }
  }, [t]);

  const handleImportMemory = useCallback(async () => {
    try {
      const picked = await bridge.tauriInvoke('pick_directory', {}) as string | null;
      if (!picked) return;

      setImporting(true);
      try {
        const res = await fetch('http://127.0.0.1:14168/memory/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceDir: picked }),
        });
        const data = await res.json();
        if (!res.ok) {
          Toast.error({ content: data?.error || t('data.importMemoryError') });
          return;
        }
        const copied = (data.memoryCopied || 0) + (data.responsesCopied || 0) + (data.sessionsAdded || 0);
        const skipped = data.responsesSkipped || 0;
        Toast.success({ content: t('data.importMemorySuccess', { copied, skipped }) });
        useChatStore.getState().loadSessions();
      } finally {
        setImporting(false);
      }
    } catch {
      setImporting(false);
      Toast.error({ content: t('data.importMemoryError') });
    }
  }, [t]);

  return (
    <div className="ga-set-block">
      <div className="ga-set-sec-t">{t('data.title')}</div>
      <OpRow
        label={t('data.importMykey')}
        desc={t('data.importMykeyDesc')}
        btnText={t('data.importMykeyBtn')}
        onClick={handleImportMykey}
      />
      <OpRow
        label={t('data.exportMykey')}
        desc={t('data.exportMykeyDesc')}
        btnText={t('data.exportMykeyBtn')}
        onClick={handleExportMykey}
      />
      {isTauri && (
        <>
          <OpRow
            label={t('data.importMemory')}
            desc={t('data.importMemoryDesc')}
            btnText={t('data.importMemoryBtn')}
            onClick={handleImportMemory}
            disabled={importing}
          />
          <div className="ga-data-divider" />
          <GaSourceBlock />
        </>
      )}
    </div>
  );
}

function downloadAsFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
