import { Button, Collapse, Toast } from '@douyinfe/semi-ui';
import { useCallback } from 'react';
import { useI18n } from '../../i18n';

import { HELP_FEEDBACK_WECHAT_IDS, copyHelpFeedbackWechatId } from './helpFeedback';

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
    <Collapse className="ga-set-block ga-help-feedback-collapse">
      <Collapse.Panel itemKey="help-feedback" header={t('helpFeedback.title')}>
        <div className="ga-help-feedback-description">{t('helpFeedback.description')}</div>
        <div className="ga-help-feedback-list">
          {HELP_FEEDBACK_WECHAT_IDS.map((wechatId) => (
            <div className="ga-help-feedback-row" key={wechatId}>
              <code className="ga-help-feedback-id">{wechatId}</code>
              <Button size="small" type="tertiary" onClick={() => handleCopy(wechatId)}>
                {t('helpFeedback.copy')}
              </Button>
            </div>
          ))}
        </div>
      </Collapse.Panel>
    </Collapse>
  );
}

