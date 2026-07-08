import { t } from './i18n';

export function LoadingScreen() {
  return (
    <div className="bs-screen bs-loading">
      <div className="bs-spinner" />
      <p className="bs-text">{t('starting')}</p>
    </div>
  );
}
