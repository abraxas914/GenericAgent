import { Spin, Typography } from '@douyinfe/semi-ui';
import { t } from './i18n';
import type { BootstrapMode } from './types';

export function LoadingScreen({ mode }: { mode: BootstrapMode }) {
  return (
    <section className="ga-bootstrap-screen ga-bootstrap-loading" aria-live="polite">
      <Spin size="large" />
      <Typography.Title heading={5} className="ga-bootstrap-title">
        {mode === 'hot_start' ? t('resuming') : t('starting')}
      </Typography.Title>
    </section>
  );
}
