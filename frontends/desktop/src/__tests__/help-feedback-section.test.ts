// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@douyinfe/semi-ui', () => ({
  Button: () => null,
  Toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
import {
  HELP_FEEDBACK_WECHAT_IDS,
  copyHelpFeedbackWechatId,
} from '../components/settings/helpFeedback';
import { en } from '../i18n/en';
import { zh } from '../i18n/zh';

describe('HelpFeedbackSection logic', () => {
  it('exposes both WeChat IDs and localized display copy', () => {
    expect(HELP_FEEDBACK_WECHAT_IDS).toEqual([
      'RoundSquisheen',
      '_Ashes_in_the_Snow_',
    ]);
    expect(zh['helpFeedback.title']).toBe('帮助与反馈');
    expect(zh['helpFeedback.description']).toContain('可添加微信联系');
    expect(en['helpFeedback.title']).toBe('Help & Feedback');
    expect(en['helpFeedback.description']).toContain('contact us on WeChat');
  });

  it('copies the selected WeChat ID through the provided clipboard writer', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await copyHelpFeedbackWechatId(HELP_FEEDBACK_WECHAT_IDS[1], writeText);

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('_Ashes_in_the_Snow_');
  });

  it('propagates clipboard failures for the UI to show an error toast', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));

    await expect(copyHelpFeedbackWechatId(HELP_FEEDBACK_WECHAT_IDS[0], writeText))
      .rejects.toThrow('clipboard unavailable');
  });
});

