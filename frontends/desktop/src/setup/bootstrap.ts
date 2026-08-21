import type { BootstrapSnapshot } from '../loading/types';

export interface SetupTauriApi {
  core: {
    invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  };
  event?: {
    listen?: (name: string, handler: (event: { payload: BootstrapSnapshot }) => void) => Promise<() => void>;
  };
}

export function getSetupTauri(): SetupTauriApi | undefined {
  return (window as Window & { __TAURI__?: SetupTauriApi }).__TAURI__;
}

export function isNewerSnapshot(currentSeq: number, snapshot: BootstrapSnapshot): boolean {
  return Number.isFinite(snapshot.seq) ? snapshot.seq > currentSeq : true;
}
