import './platform';
import '@semi-css';
import './global.css';
import './stores/bridgeActivity';

if (document.documentElement.dataset.appearance === 'dark') {
  document.body.setAttribute('theme-mode', 'dark');
}

if ((window as any).__TAURI__) {
  document.addEventListener('click', (e) => {
    const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.href;
    if (!href || href.startsWith('javascript:')) return;
    const url = new URL(href, location.href);
    if (url.origin === location.origin) return;
    e.preventDefault();
    (window as any).__TAURI__.opener.openUrl(href);
  });
}

setTimeout(() => {
  document.body.classList.remove('no-transition');
}, 0);

import React from 'react';
import { Button, Collapse, Empty, Typography } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { IllustrationFailure, IllustrationFailureDark } from '@douyinfe/semi-illustrations';
import { createRoot } from 'react-dom/client';
import { App } from './App';

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[RootErrorBoundary] React crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const isZh = (navigator.language || '').toLowerCase().startsWith('zh');
      const error = this.state.error;
      return (
        <main className="ga-root-error" role="alert">
          <Empty
            className="ga-root-error-result"
            image={<IllustrationFailure />}
            darkModeImage={<IllustrationFailureDark />}
            title={isZh ? '界面遇到问题' : 'Something went wrong'}
            description={isZh
              ? 'GenericAgent 的界面未能继续运行。你的会话和记忆不会受到影响。'
              : 'The GenericAgent interface could not continue. Your sessions and memory are safe.'}
          >
            <Button
              type="primary"
              theme="solid"
              icon={<IconRefresh />}
              onClick={() => window.location.reload()}
            >
              {isZh ? '重新加载' : 'Reload'}
            </Button>
          </Empty>
          <Collapse className="ga-root-error-details" accordion>
            <Collapse.Panel itemKey="technical-details" header={isZh ? '技术详情' : 'Technical details'}>
              <Typography.Paragraph type="tertiary">
                {isZh ? '复制以下信息可帮助排查问题。' : 'Copy the information below to help troubleshoot the issue.'}
              </Typography.Paragraph>
              <pre tabIndex={0}>{[error.message, error.stack].filter(Boolean).join('\n\n')}</pre>
            </Collapse.Panel>
          </Collapse>
        </main>
      );
    }
    return this.props.children;
  }
}

async function renderApp() {
  if (import.meta.env.VITE_GA_E2E === '1') {
    await import('@wdio/tauri-plugin');
  }
  const appRoot = document.getElementById('app')!;
  createRoot(appRoot).render(
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>,
  );
}

void renderApp();
