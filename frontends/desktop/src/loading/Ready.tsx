import { IconTickCircle } from '@douyinfe/semi-icons';
import { Typography } from '@douyinfe/semi-ui';
import { t } from './i18n';

export function ReadyScreen() {
  return (
    <section className="ga-bootstrap-screen ga-bootstrap-ready" aria-live="polite">
      <IconTickCircle size="extra-large" className="ga-bootstrap-ready-icon" aria-hidden="true" />
      <Typography.Title heading={5} className="ga-bootstrap-title">{t('ready')}</Typography.Title>
      <Typography.Text type="tertiary">{t('readyDetail')}</Typography.Text>
    </section>
  );
}
