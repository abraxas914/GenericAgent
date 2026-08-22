import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const openSettings = vi.fn();
const setPage = vi.fn();

vi.mock('@douyinfe/semi-ui', () => ({
  Input: () => null,
  Tooltip: ({ content, children, clickToHide, visible, onVisibleChange }: {
    content: string;
    children: ReactNode;
    clickToHide?: boolean;
    visible?: boolean;
    onVisibleChange?: (visible: boolean) => void;
  }) => (
    <span
      data-tooltip={content}
      data-click-to-hide={clickToHide}
      data-tooltip-visible={visible}
      onMouseEnter={() => onVisibleChange?.(true)}
      onMouseLeave={() => onVisibleChange?.(false)}
    >
      {children}
    </span>
  ),
}));

vi.mock('@douyinfe/semi-icons', () => ({
  IconSearchStroked: () => null,
}));

vi.mock('../stores/app', () => ({
  useAppStore: () => ({ activePage: 'chat', setPage }),
}));

vi.mock('../stores/settings', () => ({
  useSettingsStore: (selector: (state: { open: () => void }) => unknown) => selector({ open: openSettings }),
}));

vi.mock('../stores/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    newSession: vi.fn(),
    sessions: [],
    activeSessionId: null,
    setActiveSession: vi.fn(),
    runningSessions: new Set<string>(),
  }),
}));

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'foot.settings': '配置',
      'foot.runtimeManagement': '运行时管理',
    }[key] ?? key),
  }),
}));

vi.mock('../components/layout/SessionSectionHeader', () => ({
  SessionSectionHeader: () => null,
}));

vi.mock('../components/layout/SessionRow', () => ({
  SessionRow: () => null,
}));

vi.mock('../components/layout/BridgeMenuPanel', () => ({
  BridgeMenuPanel: () => <div role="dialog" aria-label="运行时管理面板" />,
}));

import { LeftSidebar } from '../components/layout/LeftSidebar';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Sidebar footer actions', () => {
  it('keeps settings first and runtime management second with tooltips', () => {
    const { container } = render(<LeftSidebar />);
    const footer = container.querySelector('.ga-sidebar-footer');

    expect(footer).not.toBeNull();
    const buttons = within(footer as HTMLElement).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      '配置',
      '运行时管理',
    ]);
    expect(
      Array.from((footer as HTMLElement).querySelectorAll('[data-tooltip]'))
        .map((node) => node.getAttribute('data-tooltip')),
    ).toEqual(['配置', '运行时管理']);
    expect(
      Array.from((footer as HTMLElement).querySelectorAll('[data-tooltip]'))
        .map((node) => node.getAttribute('data-click-to-hide')),
    ).toEqual(['true', null]);
  });

  it('opens settings and toggles the existing runtime panel independently', () => {
    const { container } = render(<LeftSidebar />);

    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    expect(openSettings).toHaveBeenCalledOnce();

    const runtimeButton = screen.getByRole('button', { name: '运行时管理' });
    const runtimeTooltip = container.querySelector('[data-tooltip="运行时管理"]');
    expect(runtimeButton.getAttribute('aria-expanded')).toBe('false');
    expect(runtimeTooltip).not.toBeNull();

    fireEvent.mouseEnter(runtimeTooltip as HTMLElement);
    expect(runtimeTooltip?.getAttribute('data-tooltip-visible')).toBe('true');

    fireEvent.click(runtimeButton);
    expect(screen.getByRole('dialog', { name: '运行时管理面板' })).toBeTruthy();
    expect(runtimeButton.getAttribute('aria-expanded')).toBe('true');
    expect(runtimeTooltip?.getAttribute('data-tooltip-visible')).toBe('false');

    fireEvent.click(runtimeButton);
    expect(screen.queryByRole('dialog', { name: '运行时管理面板' })).toBeNull();
  });

  it('removes the global statusbar and its hard-coded version from the shell', () => {
    const appLayout = fs.readFileSync(
      path.join(desktopRoot, 'src/components/layout/AppLayout.tsx'),
      'utf8',
    );
    const statusbar = fs.readFileSync(
      path.join(desktopRoot, 'src/components/layout/Statusbar.tsx'),
      'utf8',
    );

    expect(appLayout).not.toContain('<Statusbar');
    expect(statusbar).not.toContain('v0.1.0');
  });

  it('keeps every Semi tooltip compact and opaque', () => {
    const globalStyles = fs.readFileSync(path.join(desktopRoot, 'src/global.css'), 'utf8');

    expect(globalStyles).toContain('--ui-tooltip-surface: #17181b');
    expect(globalStyles).toMatch(/\.semi-tooltip-wrapper\s*\{[^}]*padding: 5px 8px/s);
    expect(globalStyles).toMatch(/\.semi-tooltip-wrapper\s*\{[^}]*font-size: 12px/s);
    expect(globalStyles).toMatch(/\.semi-tooltip-wrapper\s*\{[^}]*line-height: 18px/s);
    expect(globalStyles).toMatch(
      /\.semi-tooltip-wrapper \.semi-tooltip-icon-arrow\s*\{[^}]*color: var\(--ui-tooltip-surface\)/s,
    );
  });
});
