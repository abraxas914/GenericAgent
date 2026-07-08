import { useEffect } from 'react';
import { t } from './i18n';

export function ReadyScreen() {
  useEffect(() => {
    // In the current flow, the Rust setup thread navigates the window to index.html
    // once the bridge port is ready. This timeout is a safety net: if the Rust navigate
    // doesn't fire (e.g., after Phase 4 moves navigation to the frontend), we do it here.
    const timer = setTimeout(() => {
      window.location.href = '/index.html';
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="bs-screen bs-ready">
      <div className="bs-check" aria-hidden="true">&#10003;</div>
      <p className="bs-text">{t('ready')}</p>
      <p className="bs-subtext">{t('readyDetail')}</p>
    </div>
  );
}
