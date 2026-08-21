import { Button, Toast } from '@douyinfe/semi-ui';
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
    <div className="ga-set-block">
      <div className="ga-set-sec-t">{t('helpFeedback.title')}</div>
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
    </div>
  );
}

