// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSaveConfig = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/bridge', () => ({
  getConfig: vi.fn(),
  getModelProfiles: vi.fn(),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

import { useSettingsStore } from '../stores/settings';

describe('React-only settings persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSaveConfig.mockClear();
    delete (window as Window & { gaLegacy?: unknown }).gaLegacy;
    useSettingsStore.setState({
      appearance: 'light',
      chatFontSize: 14,
      lang: 'zh',
      defaultModelNo: 0,
      modelProfiles: [
        {
          id: 0,
          name: 'Model A',
          model: 'model-a',
          apibase: 'http://localhost',
          protocol: 'oai',
          stream: true,
        },
        {
          id: 1,
          name: 'Model B',
          model: 'model-b',
          apibase: 'http://localhost',
          protocol: 'oai',
          stream: true,
        },
      ],
    });
  });

  it('applies and persists settings without a v1 gaLegacy global', async () => {
    const store = useSettingsStore.getState();

    expect(() => {
      store.setAppearance('dark');
      store.setLang('en');
      store.setDefaultModel(1);
    }).not.toThrow();

    await vi.waitFor(() => expect(mockSaveConfig).toHaveBeenCalledTimes(3));
    expect(document.documentElement.dataset.appearance).toBe('dark');
    expect(document.documentElement.lang).toBe('en');
    expect(document.body.getAttribute('theme-mode')).toBe('dark');
    expect(localStorage.getItem('ga_appearance')).toBe('dark');
    expect(localStorage.getItem('ga_lang')).toBe('en');
    expect(localStorage.getItem('ga_llm_no')).toBe('1');
    expect(useSettingsStore.getState().defaultModelNo).toBe(1);
  });
});
