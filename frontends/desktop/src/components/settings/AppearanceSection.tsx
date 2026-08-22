import { RadioGroup, Radio } from '@douyinfe/semi-ui';
import { useI18n } from '../../i18n';
import { useSettingsStore } from '../../stores/settings';
import { SettingsSectionTitle } from './SettingsSectionTitle';

export function AppearanceSection() {
  const { t } = useI18n();
  const appearance = useSettingsStore((s) => s.appearance);
  const setAppearance = useSettingsStore((s) => s.setAppearance);

  return (
    <div className="ga-set-block">
      <SettingsSectionTitle>{t('set.appearance')}</SettingsSectionTitle>
      <RadioGroup
        type="button"
        value={appearance}
        onChange={(e) => setAppearance(e.target.value as 'light' | 'dark')}
      >
        <Radio value="light">{t('appearance.light')}</Radio>
        <Radio value="dark">{t('appearance.dark')}</Radio>
      </RadioGroup>
    </div>
  );
}
