import { IconAlertCircle, IconLoading, IconTickCircle } from '@douyinfe/semi-icons';
import { Collapse, Progress, Typography } from '@douyinfe/semi-ui';
import type { Stage } from './store';
import { t, tOr } from './i18n';

interface Props {
  stages: Stage[];
  overallPct: number;
  logs: string[];
}

function StageIcon({ state }: { state: Stage['state'] }) {
  if (state === 'done') return <IconTickCircle aria-hidden="true" />;
  if (state === 'failed') return <IconAlertCircle aria-hidden="true" />;
  if (state === 'running') return <IconLoading spin aria-hidden="true" />;
  return <span className="ga-bootstrap-stage-dot" aria-hidden="true" />;
}

export function ProgressScreen({ stages, overallPct, logs }: Props) {
  return (
    <section className="ga-bootstrap-screen ga-bootstrap-progress" aria-live="polite">
      <Typography.Title heading={5} className="ga-bootstrap-title">{t('preparing')}</Typography.Title>
      <Typography.Paragraph type="tertiary" className="ga-bootstrap-description">
        {t('preparingDetail')}
      </Typography.Paragraph>
      <Progress
        aria-label={t('preparing')}
        percent={Math.max(0, Math.min(100, overallPct))}
        showInfo
        stroke="var(--semi-color-primary)"
        className="ga-bootstrap-progress-bar"
      />
      <ul className="ga-bootstrap-stages" aria-label={t('stagesLabel')}>
        {stages.map((stage) => (
          <li key={stage.key} data-state={stage.state}>
            <StageIcon state={stage.state} />
            <Typography.Text type={stage.state === 'pending' ? 'tertiary' : undefined}>
              {tOr(`stage_${stage.key}`, stage.key)}
            </Typography.Text>
          </li>
        ))}
      </ul>
      {logs.length > 0 && (
        <Collapse className="ga-bootstrap-log" accordion>
          <Collapse.Panel itemKey="startup-log" header={t('logTitle')}>
            <pre>{logs.slice(-20).join('\n')}</pre>
          </Collapse.Panel>
        </Collapse>
      )}
    </section>
  );
}
