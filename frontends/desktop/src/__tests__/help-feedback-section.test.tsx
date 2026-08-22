// @vitest-environment happy-dom
// JSX is used here to verify the three-panel interaction contract.
import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@douyinfe/semi-icons', () => ({
  IconExternalOpenStroked: () => <span aria-hidden="true" />,
}));

vi.mock('@douyinfe/semi-ui', async () => {
  const React = await import('react');
  const CollapseContext = React.createContext<{
    activeKeys: string[];
    toggle: (key: string) => void;
  }>({ activeKeys: [], toggle: () => undefined });

  function Collapse({ children, defaultActiveKey = [] }: {
    children: ReactNode;
    defaultActiveKey?: string | string[];
  }) {
    const initialKeys = Array.isArray(defaultActiveKey) ? defaultActiveKey : [defaultActiveKey];
    const [activeKeys, setActiveKeys] = React.useState(initialKeys);
    const toggle = (key: string) => setActiveKeys((current) => (
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    ));
    return (
      <CollapseContext.Provider value={{ activeKeys, toggle }}>
        <div data-default-active-keys={initialKeys.join(',')}>{children}</div>
      </CollapseContext.Provider>
    );
  }

  Collapse.Panel = function CollapsePanel({ children, header, itemKey }: {
    children: ReactNode;
    header: ReactNode;
    itemKey: string;
  }) {
    const { activeKeys, toggle } = React.useContext(CollapseContext);
    const expanded = activeKeys.includes(itemKey);
    return (
      <div data-panel-key={itemKey}>
        <button type="button" aria-expanded={expanded} onClick={() => toggle(itemKey)}>{header}</button>
        {expanded ? <div>{children}</div> : null}
      </div>
    );
  };

  return {
    Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>{children}</button>
    ),
    Collapse,
    Toast: {
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});
import {
  HELP_FEEDBACK_COMMUNITY_URL,
  HELP_FEEDBACK_TUTORIAL_URL,
  HELP_FEEDBACK_WECHAT_IDS,
  copyHelpFeedbackWechatId,
} from '../components/settings/helpFeedback';
import { HelpFeedbackSection } from '../components/settings/HelpFeedbackSectionView';
import { en } from '../i18n/en';
import { zh } from '../i18n/zh';

describe('HelpFeedbackSection', () => {
  it('keeps the section title aligned outside three initially collapsed panels', () => {
    const { container } = render(<HelpFeedbackSection />);
    const section = screen.getByTestId('help-feedback-section');

    const title = section.querySelector('.ga-set-sec-t');
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent).toBe('helpFeedback.title');
    expect(container.querySelector('[data-default-active-keys]')?.getAttribute('data-default-active-keys')).toBe('');
    expect(Array.from(container.querySelectorAll('[data-panel-key]')).map((panel) => (
      panel.getAttribute('data-panel-key')
    ))).toEqual(['community', 'tutorial', 'maintainers']);
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-expanded')))
      .toEqual(['false', 'false', 'false']);
  });

  it('opens the resource panels to reveal the canonical external links', () => {
    render(<HelpFeedbackSection />);

    fireEvent.click(screen.getByRole('button', { name: 'helpFeedback.communityTitle' }));
    fireEvent.click(screen.getByRole('button', { name: 'helpFeedback.tutorialTitle' }));

    expect(screen.getByRole('link', { name: 'helpFeedback.communityAction' }).getAttribute('href'))
      .toBe(HELP_FEEDBACK_COMMUNITY_URL);
    expect(screen.getByRole('link', { name: 'helpFeedback.tutorialAction' }).getAttribute('href'))
      .toBe(HELP_FEEDBACK_TUTORIAL_URL);
  });

  it('shows all three maintainers with a WeChat icon and copy action', () => {
    const { container } = render(<HelpFeedbackSection />);

    fireEvent.click(screen.getByRole('button', { name: 'helpFeedback.maintainersTitle' }));
    const rows = container.querySelectorAll('.ga-help-feedback-row');

    expect(rows).toHaveLength(3);
    expect(Array.from(rows).map((row) => within(row as HTMLElement).getByText(
      /RoundSquisheen|_Ashes_in_the_Snow_|pax1123581321/,
    ).textContent)).toEqual(HELP_FEEDBACK_WECHAT_IDS);
    expect(container.querySelectorAll('.ga-help-feedback-wechat-icon')).toHaveLength(3);
  });

  it('exposes localized display copy and canonical destinations', () => {
    expect(HELP_FEEDBACK_WECHAT_IDS).toEqual([
      'RoundSquisheen',
      '_Ashes_in_the_Snow_',
      'pax1123581321',
    ]);
    expect(HELP_FEEDBACK_COMMUNITY_URL).toBe('https://github.com/lsdefine/GenericAgent#-社区与支持');
    expect(HELP_FEEDBACK_TUTORIAL_URL).toBe('https://datawhalechina.github.io/hello-generic-agent/');
    expect(zh['helpFeedback.title']).toBe('帮助与反馈');
    expect(zh['helpFeedback.communityTitle']).toBe('加入官方社群');
    expect(zh['helpFeedback.tutorialTitle']).toBe('阅读官方教程');
    expect(zh['helpFeedback.maintainersTitle']).toBe('联系桌面版维护者');
    expect(zh['helpFeedback.maintainersDescription']).toContain('可添加微信联系');
    expect(en['helpFeedback.title']).toBe('Help & Feedback');
    expect(en['helpFeedback.maintainersDescription']).toContain('contact us on WeChat');
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
