import { useState, useCallback } from 'react';
import { t } from './i18n';

interface Props {
  error: string | null;
  logs: string[];
  onRetry: () => void;
}

export function SetupScreen({ error, logs, onRetry }: Props) {
  const [pythonPath, setPythonPath] = useState('');
  const [projectDir, setProjectDir] = useState('');
  const [starting, setStarting] = useState(false);

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      const invoke = (window as any).__TAURI__?.core?.invoke;
      if (invoke) {
        await invoke('start_bridge_with_config', {
          pythonPath: pythonPath || 'python3',
          projectDir: projectDir || '',
        });
      }
      onRetry();
    } catch {
      setStarting(false);
    }
  }, [pythonPath, projectDir, onRetry]);

  return (
    <div className="bs-screen bs-setup">
      {error && <div className="bs-error" role="alert">{error}</div>}

      <div className="bs-form">
        <label className="bs-field">
          <span>{t('pythonPath')}</span>
          <input
            type="text"
            value={pythonPath}
            onChange={(e) => setPythonPath(e.target.value)}
            placeholder="python3"
          />
        </label>
        <label className="bs-field">
          <span>{t('projectDir')}</span>
          <input
            type="text"
            value={projectDir}
            onChange={(e) => setProjectDir(e.target.value)}
            placeholder={t('projectDirHint')}
          />
        </label>
        <div className="bs-actions">
          <button type="button" className="bs-btn bs-btn-primary" onClick={handleStart} disabled={starting}>
            {starting ? t('startingBridge') : t('start')}
          </button>
          <button type="button" className="bs-btn" onClick={onRetry}>
            {t('retry')}
          </button>
        </div>
      </div>

      {logs.length > 0 && (
        <details className="bs-log" open>
          <summary>{t('logTitle')}</summary>
          <pre>{logs.slice(-30).join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
