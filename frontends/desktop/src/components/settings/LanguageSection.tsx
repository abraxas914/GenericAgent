import { RadioGroup, Radio } from '@douyinfe/semi-ui';
import { useI18n } from '../../i18n';
import { useSettingsStore } from '../../stores/settings';
import { SettingsSectionTitle } from './SettingsSectionTitle';

export function LanguageSection() {
  const { t } = useI18n();
  const lang = useSettingsStore((s) => s.lang);
  const setLang = useSettingsStore((s) => s.setLang);

  return (
    <div className="ga-set-block">
      <SettingsSectionTitle>{t('set.lang')}</SettingsSectionTitle>
      <RadioGroup
        type="button"
        value={lang}
        onChange={(e) => setLang(e.target.value as 'zh' | 'en')}
      >
        <Radio value="zh">{t('lang.zh')}</Radio>
        <Radio value="en">{t('lang.en')}</Radio>
      </RadioGroup>
    </div>
  );
}
