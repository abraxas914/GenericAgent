// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../services/bridge';

const mocks = vi.hoisted(() => ({ getConfig: vi.fn(), getModelProfiles: vi.fn(), saveConfig: vi.fn(), error: vi.fn() }));
vi.mock('../services/bridge', () => mocks);
vi.mock('../stores/notifications', () => ({ notifyError: mocks.error }));
import { useSettingsStore } from '../stores/settings';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const config = { appearance: 'light', fontSize: 14, lang: 'zh', llmNo: 0 } as AppConfig;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConfig.mockResolvedValue(config);
  mocks.getModelProfiles.mockResolvedValue([]);
  mocks.saveConfig.mockResolvedValue(undefined);
  useSettingsStore.setState({ appearance: 'light', lang: 'zh', chatFontSize: 14 });
});

describe('settings persistence ordering', () => {
  it('does not let an older bridge read overwrite an edit', async () => {
    const read = deferred<AppConfig>();
    mocks.getConfig.mockReturnValueOnce(read.promise);
    const loading = useSettingsStore.getState().loadFromBridge();
    await tick();
    useSettingsStore.getState().setAppearance('dark');
    read.resolve(config);
    await loading;
    await tick();
    expect(useSettingsStore.getState().appearance).toBe('dark');
    expect(document.documentElement.dataset.appearance).toBe('dark');
    expect(mocks.saveConfig).toHaveBeenCalledWith({ appearance: 'dark' });
  });

  it('serializes partial writes and reads after all preceding writes', async () => {
    const write = deferred<void>();
    mocks.saveConfig.mockReturnValueOnce(write.promise);
    useSettingsStore.getState().setLang('en');
    useSettingsStore.getState().setChatFontSize(18);
    const loading = useSettingsStore.getState().loadFromBridge();
    await tick();
    expect(mocks.saveConfig.mock.calls).toEqual([[{ lang: 'en' }]]);
    expect(mocks.getConfig).not.toHaveBeenCalled();
    mocks.getConfig.mockResolvedValue({ ...config, lang: 'en', fontSize: 18 });
    write.resolve();
    await loading;
    expect(mocks.saveConfig.mock.calls).toEqual([[{ lang: 'en' }], [{ fontSize: 18 }]]);
    expect(useSettingsStore.getState().lang).toBe('en');
    expect(useSettingsStore.getState().chatFontSize).toBe(18);
  });

  it('reports a rejected save without poisoning subsequent saves', async () => {
    mocks.saveConfig.mockRejectedValueOnce(new Error('conflict'));
    await useSettingsStore.getState().persist({ lang: 'en' });
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('conflict'));
    await useSettingsStore.getState().persist({ fontSize: 16 });
    expect(mocks.saveConfig).toHaveBeenLastCalledWith({ fontSize: 16 });
  });
});
