import { Slider } from '@douyinfe/semi-ui';
import { useI18n } from '../../i18n';
import { useSettingsStore } from '../../stores/settings';
import { SettingsSectionTitle } from './SettingsSectionTitle';

export function FontSizeSection() {
  const { t } = useI18n();
  const chatFontSize = useSettingsStore((s) => s.chatFontSize);
  const setChatFontSize = useSettingsStore((s) => s.setChatFontSize);

  return (
    <div className="ga-set-block">
      <SettingsSectionTitle>{t('set.fontSize')}</SettingsSectionTitle>
      <div className="ga-font-slider-row">
        <Slider
          min={10}
          max={20}
          step={1}
          value={chatFontSize}
          onChange={(val) => setChatFontSize(val as number)}
          style={{ flex: 1 }}
        />
        <span className="ga-font-value">{chatFontSize}px</span>
      </div>
    </div>
  );
}
