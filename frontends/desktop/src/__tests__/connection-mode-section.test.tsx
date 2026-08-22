// @vitest-environment happy-dom
import type { ComponentType, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tauriInvoke: vi.fn(),
  loadSessions: vi.fn().mockResolvedValue(undefined),
  loadFromBridge: vi.fn().mockResolvedValue(undefined),
  closeSettings: vi.fn(),
  setPage: vi.fn(),
  setServicesTab: vi.fn(),
  runningSessions: new Set<string>(),
}));

vi.mock('../services/bridge', () => ({
  tauriInvoke: (...args: unknown[]) => mocks.tauriInvoke(...args),
}));

vi.mock('../stores/chat', () => {
  const store = (selector: (state: { runningSessions: Set<string> }) => unknown) => (
    selector({ runningSessions: mocks.runningSessions })
  );
  store.getState = () => ({ loadSessions: mocks.loadSessions });
  return { useChatStore: store };
});

vi.mock('../stores/settings', () => {
  const store = (selector: (state: { visible: boolean }) => unknown) => selector({ visible: true });
  store.getState = () => ({
    loadFromBridge: mocks.loadFromBridge,
    close: mocks.closeSettings,
  });
  return { useSettingsStore: store };
});

vi.mock('../stores/app', () => ({
  useAppStore: (selector: (state: {
    setPage: typeof mocks.setPage;
    setServicesTab: typeof mocks.setServicesTab;
  }) => unknown) => selector({
    setPage: mocks.setPage,
    setServicesTab: mocks.setServicesTab,
  }),
}));

vi.mock('../hooks/useBridgeStatus', () => ({
  useBridgeStatus: () => 'ready',
}));

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@douyinfe/semi-ui', async () => {
  const React = await import('react');
  const GroupContext = React.createContext<((value: string) => void) | null>(null);
  return {
    Button: ({ children, onClick, disabled }: {
      children: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => <button type="button" onClick={onClick} disabled={disabled}>{children}</button>,
    RadioGroup: ({ children, onChange, disabled }: {
      children: ReactNode;
      onChange: (event: { target: { value: string } }) => void;
      disabled?: boolean;
    }) => (
      <GroupContext.Provider value={(value) => onChange({ target: { value } })}>
        <fieldset disabled={disabled}>{children}</fieldset>
      </GroupContext.Provider>
    ),
    Radio: ({ children, value, extra, className }: {
      children: ReactNode;
      value: string;
      extra?: ReactNode;
      className?: string;
    }) => {
      const select = React.useContext(GroupContext);
      return (
        <label className={className}>
          <input type="radio" value={value} onChange={() => select?.(value)} />
          {children}
          <span>{extra}</span>
        </label>
      );
    },
    Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Tooltip: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
      <span data-tooltip={String(content)}>{children}</span>
    ),
    Toast: { error: vi.fn(), success: vi.fn() },
  };
});

let ConnectionModeSection: ComponentType;

beforeAll(async () => {
  (window as unknown as { __TAURI__: object }).__TAURI__ = {};
  ({ ConnectionModeSection } = await import('../components/settings/ConnectionModeSection'));
});

describe('ConnectionModeSection', () => {
  beforeEach(() => {
    mocks.tauriInvoke.mockReset();
    mocks.loadSessions.mockClear();
    mocks.loadFromBridge.mockClear();
    mocks.runningSessions.clear();
  });

  it('shows the complete repository path without character truncation', async () => {
    const fullPath = '/Users/test/workspaces/clients/example/very-deep/and-even-deeper/GenericAgent-repository';
    mocks.tauriInvoke.mockResolvedValueOnce(fullPath);

    render(<ConnectionModeSection />);

    const path = await screen.findByText(fullPath);
    expect(path.textContent).toBe(fullPath);
    expect(path.classList.contains('ga-connection-path')).toBe(true);
  });

  it('adds focused explanations for the section, both modes, and runtime status', async () => {
    mocks.tauriInvoke.mockResolvedValueOnce('');
    const { container } = render(<ConnectionModeSection />);
    await screen.findByText('connection.statusReady');

    expect(Array.from(container.querySelectorAll('[data-tooltip]')).map((node) => (
      node.getAttribute('data-tooltip')
    ))).toEqual([
      'connection.sectionTip',
      'connection.includedTip',
      'connection.localTip',
      'connection.statusTip',
    ]);
  });

  it('validates a local repository before staging it and only reconnects after Apply', async () => {
    const fullPath = '/Users/test/workspaces/client/GenericAgent';
    mocks.tauriInvoke
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(fullPath)
      .mockResolvedValueOnce(fullPath)
      .mockResolvedValueOnce(fullPath);

    render(<ConnectionModeSection />);
    await waitFor(() => expect(mocks.tauriInvoke).toHaveBeenCalledWith('get_ga_source', {}));

    fireEvent.click(screen.getByDisplayValue('localRepository'));
    await screen.findByText(fullPath);

    expect(mocks.tauriInvoke).toHaveBeenCalledWith('validate_ga_source', { dir: fullPath });
    expect(mocks.tauriInvoke).not.toHaveBeenCalledWith('set_ga_source', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'connection.apply' }));
    await waitFor(() => {
      expect(mocks.tauriInvoke).toHaveBeenCalledWith('set_ga_source', { dir: fullPath });
    });
  });

  it('defers validation to set_ga_source when connected to an older desktop shell', async () => {
    const fullPath = '/Users/test/workspaces/client/GenericAgent';
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_ga_source') return '';
      if (command === 'pick_directory') return fullPath;
      if (command === 'validate_ga_source') {
        throw new Error('Command validate_ga_source not found');
      }
      if (command === 'set_ga_source') return fullPath;
      return undefined;
    });

    render(<ConnectionModeSection />);
    await waitFor(() => expect(mocks.tauriInvoke).toHaveBeenCalledWith('get_ga_source', {}));

    fireEvent.click(screen.getByDisplayValue('localRepository'));
    await screen.findByText(fullPath);
    fireEvent.click(screen.getByRole('button', { name: 'connection.apply' }));

    await waitFor(() => {
      expect(mocks.tauriInvoke).toHaveBeenCalledWith('set_ga_source', { dir: fullPath });
    });
  });

  it('opens the retained detailed operating-status page', async () => {
    mocks.tauriInvoke.mockResolvedValueOnce('');
    render(<ConnectionModeSection />);
    await screen.findByText('connection.statusReady');

    fireEvent.click(screen.getByRole('button', { name: 'connection.viewStatus' }));

    expect(mocks.setServicesTab).toHaveBeenCalledWith('status');
    expect(mocks.setPage).toHaveBeenCalledWith('services');
    expect(mocks.closeSettings).toHaveBeenCalledOnce();
  });
});
