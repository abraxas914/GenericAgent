// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  onResized: vi.fn(),
  onScaleChanged: vi.fn(),
  resizeHandler: undefined as (() => void) | undefined,
  scaleHandler: undefined as (() => void) | undefined,
  unlistenResize: vi.fn(),
  unlistenScale: vi.fn(),
}));

vi.mock('../platform', () => ({ isMacOS: true }));
vi.mock('../services/bridge', () => ({ tauriInvoke: mocks.invoke }));
vi.mock('../lib/icons', () => ({ Codicon: () => <span /> }));
vi.mock('../stores/app', () => ({
  useAppStore: (selector: (state: { sidebarCollapsed: boolean; toggleSidebar: () => void }) => unknown) => (
    selector({ sidebarCollapsed: false, toggleSidebar: vi.fn() })
  ),
}));

import { TitlebarControls } from '../components/layout/TitlebarControls';

describe('macOS titlebar controls geometry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resizeHandler = undefined;
    mocks.scaleHandler = undefined;
    mocks.onResized.mockImplementation(async (handler: () => void) => {
      mocks.resizeHandler = handler;
      return mocks.unlistenResize;
    });
    mocks.onScaleChanged.mockImplementation(async (handler: () => void) => {
      mocks.scaleHandler = handler;
      return mocks.unlistenScale;
    });
    (window as any).__TAURI__ = {
      window: {
        getCurrentWindow: () => ({
          onResized: mocks.onResized,
          onScaleChanged: mocks.onScaleChanged,
        }),
      },
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as any).__TAURI__;
    vi.useRealTimers();
  });

  it('positions controls from native metrics and remeasures after native changes', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ trafficLightCenterY: 20, trafficLightRightX: 62 })
      .mockResolvedValueOnce({ trafficLightCenterY: 22, trafficLightRightX: 64 })
      .mockResolvedValueOnce({ trafficLightCenterY: 24, trafficLightRightX: 66 });
    const view = render(<TitlebarControls />);
    const controls = screen.getByTestId('titlebar-controls');

    await waitFor(() => expect(controls.style.getPropertyValue('--ga-titlebar-controls-top')).toBe('6px'));
    expect(controls.style.getPropertyValue('--ga-titlebar-controls-left')).toBe('72px');
    expect(controls.dataset.trafficLightCenterY).toBe('20');
    expect(controls.dataset.trafficLightRightX).toBe('62');
    await waitFor(() => expect(mocks.resizeHandler).toBeTypeOf('function'));
    await waitFor(() => expect(mocks.scaleHandler).toBeTypeOf('function'));

    mocks.resizeHandler?.();
    await waitFor(() => expect(controls.dataset.trafficLightCenterY).toBe('22'));
    expect(controls.style.getPropertyValue('--ga-titlebar-controls-left')).toBe('74px');

    mocks.scaleHandler?.();
    await waitFor(() => expect(controls.dataset.trafficLightCenterY).toBe('24'));
    expect(controls.style.getPropertyValue('--ga-titlebar-controls-left')).toBe('76px');

    view.unmount();
    expect(mocks.unlistenResize).toHaveBeenCalledOnce();
    expect(mocks.unlistenScale).toHaveBeenCalledOnce();
  });

  it('keeps CSS fallbacks when native measurement fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.invoke.mockRejectedValue(new Error('unavailable'));
    render(<TitlebarControls />);
    const controls = screen.getByTestId('titlebar-controls');

    await waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(controls.style.getPropertyValue('--ga-titlebar-controls-top')).toBe('');
    expect(controls.style.getPropertyValue('--ga-titlebar-controls-left')).toBe('');
    expect(controls.dataset.trafficLightCenterY).toBeUndefined();
    expect(controls.dataset.trafficLightRightX).toBeUndefined();
  });
});
