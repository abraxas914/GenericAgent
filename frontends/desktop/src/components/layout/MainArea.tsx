import { lazy, Suspense } from 'react';
import { useAppStore } from '../../stores/app';
import { ChatView } from '../chat/ChatView';

const ServicesPage = lazy(async () => {
  const module = await import('../services/ServicesPage');
  return { default: module.ServicesPage };
});
const TokenPage = lazy(async () => {
  const module = await import('../token/TokenPage');
  return { default: module.TokenPage };
});
const CollabPage = lazy(async () => {
  const module = await import('../collab/CollabPage');
  return { default: module.CollabPage };
});

function DeferredPage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<span data-slot="deferred-page-loading" aria-busy="true" />}>
      {children}
    </Suspense>
  );
}

export function MainArea() {
  const activePage = useAppStore((s) => s.activePage);

  if (activePage === 'chat') {
    return (
      <div className="ga-main-area ga-main-chat">
        <ChatView />
      </div>
    );
  }

  if (activePage === 'services') {
    return (
      <div className="ga-main-area ga-main-full">
        <DeferredPage><ServicesPage /></DeferredPage>
      </div>
    );
  }

  if (activePage === 'token') {
    return (
      <div className="ga-main-area ga-main-full">
        <DeferredPage><TokenPage /></DeferredPage>
      </div>
    );
  }

  if (activePage === 'collab') {
    return (
      <div className="ga-main-area ga-main-chat">
        <DeferredPage><CollabPage /></DeferredPage>
      </div>
    );
  }

  return <div className="ga-main-area" />;
}
