import { IconHelpCircleStroked } from '@douyinfe/semi-icons';
import { Tooltip } from '@douyinfe/semi-ui';
import type { ReactNode } from 'react';

interface SettingsSectionTitleProps {
  children: ReactNode;
  tip?: string;
  tipLabel?: string;
}

export function SettingsSectionTitle({ children, tip, tipLabel }: SettingsSectionTitleProps) {
  return (
    <div className="ga-set-sec-heading">
      <h2 className="ga-set-sec-t">{children}</h2>
      {tip && (
        <Tooltip content={tip} position="topLeft">
          <span
            className="ga-settings-section-help"
            tabIndex={0}
            aria-label={[tipLabel, tip].filter(Boolean).join('：')}
          >
            <IconHelpCircleStroked size="small" aria-hidden="true" />
          </span>
        </Tooltip>
      )}
    </div>
  );
}
