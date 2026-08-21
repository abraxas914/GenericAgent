// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GaSourceBlock } from '../components/settings/GaSourceBlock';

const mockTauriInvoke = vi.fn();

vi.mock('../services/bridge', () => ({
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}));

vi.mock('../stores/chat', () => ({
  useChatStore: {
    getState: () => ({ loadSessions: vi.fn() }),
  },
}));

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@douyinfe/semi-ui', () => ({
  Button: ({ children, onClick, disabled }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => <button type="button" onClick={onClick} disabled={disabled}>{children}</button>,
  Toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('GaSourceBlock source refresh', () => {
  beforeEach(() => {
    mockTauriInvoke.mockReset();
  });

  it('re-reads and displays the persisted source when refreshKey changes', async () => {
    mockTauriInvoke
      .mockResolvedValueOnce('/Users/test/OldAgent')
      .mockResolvedValueOnce('/Users/test/NewAgent');

    const { rerender } = render(<GaSourceBlock refreshKey={0} />);
    expect(await screen.findByText('/Users/test/OldAgent')).toBeTruthy();

    rerender(<GaSourceBlock refreshKey={1} />);

    expect(await screen.findByText('/Users/test/NewAgent')).toBeTruthy();
    expect(screen.queryByText('/Users/test/OldAgent')).toBeNull();
    expect(mockTauriInvoke).toHaveBeenNthCalledWith(1, 'get_ga_source', {});
    expect(mockTauriInvoke).toHaveBeenNthCalledWith(2, 'get_ga_source', {});
  });

  it('returns to the idle state when the persisted source is cleared', async () => {
    mockTauriInvoke
      .mockResolvedValueOnce('/Users/test/OldAgent')
      .mockResolvedValueOnce('');

    const { rerender } = render(<GaSourceBlock refreshKey={0} />);
    expect(await screen.findByText('/Users/test/OldAgent')).toBeTruthy();

    rerender(<GaSourceBlock refreshKey={1} />);

    await waitFor(() => {
      expect(screen.queryByText('/Users/test/OldAgent')).toBeNull();
    });
    expect(screen.getByText('data.localRepoPick')).toBeTruthy();
  });
});
