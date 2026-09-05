import { create } from 'zustand';

export const useCoreSwitchStore = create<{
  applying: boolean;
  begin: () => boolean;
  finish: () => void;
}>((set, get) => ({
  applying: false,
  begin: () => {
    if (get().applying) return false;
    set({ applying: true });
    return true;
  },
  finish: () => set({ applying: false }),
}));
