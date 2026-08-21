import './platform';
import '@semi-css';
import './setup/setup.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from '@douyinfe/semi-ui';
import zh_CN from '@douyinfe/semi-ui/lib/es/locale/source/zh_CN';
import en_US from '@douyinfe/semi-ui/lib/es/locale/source/en_US';
import { SetupApp } from './setup/App';
import { setupLanguage } from './setup/copy';

declare global {
  interface Window {
    __GA_SETUP_READY__?: boolean;
    __GA_SETUP_FALLBACK_STARTED__?: boolean;
    __GA_SETUP_MARK_READY__?: () => void;
    __GA_SETUP_FALLBACK__?: (reason?: string) => void;
  }
}

function syncSystemTheme(media: MediaQueryList) {
  if (media.matches) {
    document.documentElement.dataset.appearance = 'dark';
    document.body.setAttribute('theme-mode', 'dark');
  } else {
    document.documentElement.dataset.appearance = 'light';
    document.body.removeAttribute('theme-mode');
  }
}

try {
  const darkMode = window.matchMedia('(prefers-color-scheme: dark)');
  syncSystemTheme(darkMode);
  darkMode.addEventListener?.('change', () => syncSystemTheme(darkMode));

  const container = document.getElementById('setup-root');
  if (!container) throw new Error('Setup root is missing');
  createRoot(container).render(
    <StrictMode>
      <LocaleProvider locale={setupLanguage() === 'zh' ? zh_CN : en_US}>
        <SetupApp />
      </LocaleProvider>
    </StrictMode>,
  );
} catch (error) {
  console.error('[setup] failed to mount recovery UI', error);
  window.__GA_SETUP_FALLBACK__?.('setup_mount_failed');
}
