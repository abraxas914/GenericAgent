import { IconExternalOpenStroked } from '@douyinfe/semi-icons';
import { Button, Collapse, Toast } from '@douyinfe/semi-ui';
import { useCallback } from 'react';
import { useI18n } from '../../i18n';

import {
  HELP_FEEDBACK_COMMUNITY_URL,
  HELP_FEEDBACK_TUTORIAL_URL,
  HELP_FEEDBACK_WECHAT_IDS,
  copyHelpFeedbackWechatId,
} from './helpFeedback';
import { SettingsSectionTitle } from './SettingsSectionTitle';

function WeChatIcon() {
  return (
    <svg
      aria-hidden="true"
      className="ga-help-feedback-wechat-icon"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z" />
    </svg>
  );
}

interface ExternalResourceProps {
  description: string;
  href: string;
  label: string;
}

function ExternalResource({ description, href, label }: ExternalResourceProps) {
  return (
    <div className="ga-help-feedback-resource">
      <p>{description}</p>
      <a
        className="ga-help-feedback-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span>{label}</span>
        <IconExternalOpenStroked size="small" aria-hidden="true" />
      </a>
    </div>
  );
}

export function HelpFeedbackSection() {
  const { t } = useI18n();

  const handleCopy = useCallback(async (wechatId: string) => {
    try {
      await copyHelpFeedbackWechatId(wechatId);
      Toast.success({ content: t('helpFeedback.copySuccess') });
    } catch {
      Toast.error({ content: t('helpFeedback.copyError') });
    }
  }, [t]);

  return (
    <section className="ga-set-block ga-help-feedback-section" data-testid="help-feedback-section">
      <SettingsSectionTitle>{t('helpFeedback.title')}</SettingsSectionTitle>
      <Collapse className="ga-help-feedback-collapse" defaultActiveKey={[]}>
        <Collapse.Panel itemKey="community" header={t('helpFeedback.communityTitle')}>
          <ExternalResource
            description={t('helpFeedback.communityDescription')}
            href={HELP_FEEDBACK_COMMUNITY_URL}
            label={t('helpFeedback.communityAction')}
          />
        </Collapse.Panel>
        <Collapse.Panel itemKey="tutorial" header={t('helpFeedback.tutorialTitle')}>
          <ExternalResource
            description={t('helpFeedback.tutorialDescription')}
            href={HELP_FEEDBACK_TUTORIAL_URL}
            label={t('helpFeedback.tutorialAction')}
          />
        </Collapse.Panel>
        <Collapse.Panel itemKey="maintainers" header={t('helpFeedback.maintainersTitle')}>
          <p className="ga-help-feedback-description">{t('helpFeedback.maintainersDescription')}</p>
          <div className="ga-help-feedback-list">
            {HELP_FEEDBACK_WECHAT_IDS.map((wechatId) => (
              <div className="ga-help-feedback-row" key={wechatId}>
                <div className="ga-help-feedback-contact">
                  <WeChatIcon />
                  <code className="ga-help-feedback-id">{wechatId}</code>
                </div>
                <Button size="small" type="tertiary" onClick={() => handleCopy(wechatId)}>
                  {t('helpFeedback.copy')}
                </Button>
              </div>
            ))}
          </div>
        </Collapse.Panel>
      </Collapse>
    </section>
  );
}
