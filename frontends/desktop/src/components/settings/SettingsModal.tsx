import { lazy, Suspense, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settings';

const SettingsDialog = lazy(() => import('./SettingsContent').then((module) => ({
  default: module.SettingsDialog,
})));

export function SettingsModal() {
  const visible = useSettingsStore((s) => s.visible);
  useEffect(() => {
    const open = () => {
      const settings = useSettingsStore.getState();
      void settings.loadFromBridge();
      settings.open();
    };
    const close = () => useSettingsStore.getState().close();
    window.addEventListener('ga:open-settings', open);
    window.addEventListener('ga:close-settings', close);
    return () => {
      window.removeEventListener('ga:open-settings', open);
      window.removeEventListener('ga:close-settings', close);
    };
  }, []);

  return visible ? <Suspense fallback={null}><SettingsDialog /></Suspense> : null;
}
