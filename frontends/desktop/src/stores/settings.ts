import { create } from 'zustand';
import { notifyError } from './notifications';
import { serialTask } from '../lib/serial-task';
import type { ModelProfile } from '../services/bridge';
import * as bridge from '../services/bridge';

const STORE_KEYS = {
  lang: 'ga_lang',
  theme: 'ga_theme',
  appearance: 'ga_appearance',
  fontSize: 'ga_font_size',
  llmNo: 'ga_llm_no',
} as const;

function syncBootCache(state: SettingsState) {
  try {
    localStorage.setItem(STORE_KEYS.lang, state.lang);
    localStorage.setItem(STORE_KEYS.appearance, state.appearance);
    localStorage.setItem(STORE_KEYS.fontSize, String(state.chatFontSize));
    localStorage.setItem(STORE_KEYS.llmNo, String(state.defaultModelNo));
  } catch (_) { /* private browsing */ }
}

function applyToDOM(appearance: string, chatFontSize: number) {
  const root = document.documentElement;
  root.dataset.appearance = appearance;
  delete root.dataset.plain;
  root.dataset.chatFont = String(chatFontSize);
  root.style.setProperty('--chat-font', chatFontSize + 'px');
  if (appearance === 'dark') {
    document.body.setAttribute('theme-mode', 'dark');
  } else {
    document.body.removeAttribute('theme-mode');
  }
}

interface SettingsState {
  visible: boolean;
  appearance: 'light' | 'dark';
  chatFontSize: number;
  lang: 'zh' | 'en';
  modelProfiles: ModelProfile[];
  defaultModelNo: number;
  liveModel: { isMixin: boolean; current: string; llmNo?: number; runningLlmNo?: number | null; runningModel?: string | null } | null;

  open: () => void;
  close: () => void;
  setAppearance: (app: 'light' | 'dark') => void;
  setChatFontSize: (size: number) => void;
  setLang: (lang: 'zh' | 'en') => void;
  setModelProfiles: (profiles: ModelProfile[]) => void;
  setDefaultModel: (no: number) => void;
  setLiveModel: (model: { isMixin: boolean; current: string; llmNo?: number; runningLlmNo?: number | null; runningModel?: string | null } | null) => void;
  loadFromBridge: () => Promise<void>;
  persist: (patch: Partial<bridge.AppConfig>) => Promise<void>;
}

function readInitialState() {
  const root = document.documentElement;
  return {
    appearance: (root.dataset.appearance === 'dark' ? 'dark' : 'light') as 'light' | 'dark',
    chatFontSize: parseInt(root.dataset.chatFont || '14', 10) || 14,
    lang: (root.lang === 'en' ? 'en' : 'zh') as 'zh' | 'en',
    defaultModelNo: parseInt(localStorage.getItem(STORE_KEYS.llmNo) || '0', 10),
  };
}

let revision = 0;
let readSequence = 0;
const enqueueWrite = serialTask();

export const useSettingsStore = create<SettingsState>((set, get) => ({
  visible: false,
  modelProfiles: [],
  liveModel: null,
  ...readInitialState(),

  open: () => set({ visible: true }),
  close: () => set({ visible: false }),

  setAppearance: (app) => {
    set({ appearance: app });
    applyToDOM(app, get().chatFontSize);
    void get().persist({ appearance: app });
  },

  setChatFontSize: (size) => {
    const clamped = Math.max(10, Math.min(20, size));
    set({ chatFontSize: clamped });
    applyToDOM(get().appearance, clamped);
    void get().persist({ fontSize: clamped });
  },

  setLang: (lang) => {
    set({ lang });
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    void get().persist({ lang });
  },

  setModelProfiles: (profiles) => set({ modelProfiles: profiles }),

  setDefaultModel: (no) => {
    const profiles = get().modelProfiles;
    const profile = profiles[no];
    if (!profile) return;
    set({ defaultModelNo: no });
    void get().persist({ llmNo: no });
  },

  setLiveModel: (model) => set({ liveModel: model }),

  loadFromBridge: async () => {
    const version = revision;
    const request = ++readSequence;
    try {
      const [config, profiles] = await enqueueWrite(() => Promise.all([
        bridge.getConfig(),
        bridge.getModelProfiles(),
      ]));
      if (version !== revision || request !== readSequence) return;
      set({
        appearance: config.appearance === 'dark' ? 'dark' : 'light',
        chatFontSize: config.fontSize || 14,
        lang: config.lang === 'en' ? 'en' : 'zh',
        defaultModelNo: config.llmNo || 0,
        modelProfiles: profiles,
      });
      const s = get();
      applyToDOM(s.appearance, s.chatFontSize);
      document.documentElement.lang = s.lang === 'en' ? 'en' : 'zh-CN';
      syncBootCache(s);
    } catch (_) { /* bridge not ready yet */ }
  },

  persist: async (patch) => {
    revision++;
    syncBootCache(get());
    try {
      await enqueueWrite(() => bridge.saveConfig(patch));
    } catch (error) {
      notifyError(`${get().lang === 'zh' ? '设置未保存' : 'Settings not saved'}: ${String(error)}`);
    }
  },
}));
