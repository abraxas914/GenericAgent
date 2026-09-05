import './platform';
import '@douyinfe/semi-ui/lib/es/_base/base.css';
import './loading/bootstrap.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from '@douyinfe/semi-ui';
import zh_CN from '@douyinfe/semi-ui/lib/es/locale/source/zh_CN';
import en_US from '@douyinfe/semi-ui/lib/es/locale/source/en_US';
import { LoadingApp } from './loading/App';
import { isZh } from './loading/i18n';

function syncSystemTheme(media: MediaQueryList) {
  if (media.matches) {
    document.documentElement.dataset.appearance = 'dark';
    document.body.setAttribute('theme-mode', 'dark');
  } else {
    document.documentElement.dataset.appearance = 'light';
    document.body.removeAttribute('theme-mode');
  }
}

const darkMode = window.matchMedia('(prefers-color-scheme: dark)');
syncSystemTheme(darkMode);
darkMode.addEventListener?.('change', () => syncSystemTheme(darkMode));

const container = document.getElementById('loading-root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <LocaleProvider locale={isZh ? zh_CN : en_US}>
        <LoadingApp />
      </LocaleProvider>
    </StrictMode>,
  );
}
