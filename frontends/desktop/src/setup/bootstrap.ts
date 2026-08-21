import type { BootstrapFailureCode, BootstrapSnapshot } from '../loading/types';
import { isMissingTauriCommand, tauriErrorText } from '../services/tauri-compat';

export interface SetupTauriApi {
  core: {
    invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  };
  event?: {
    listen?: (name: string, handler: (event: { payload: BootstrapSnapshot }) => void) => Promise<() => void>;
  };
}

export type SetupBootstrapMode = 'snapshot' | 'legacy';

type Invoke = SetupTauriApi['core']['invoke'];

export interface SetupBootstrapState {
  config: [string, string];
  mode: SetupBootstrapMode;
  snapshot: BootstrapSnapshot;
}

export function getSetupTauri(): SetupTauriApi | undefined {
  return (window as Window & { __TAURI__?: SetupTauriApi }).__TAURI__;
}

export function isNewerSnapshot(currentSeq: number, snapshot: BootstrapSnapshot): boolean {
  return Number.isFinite(snapshot.seq) ? snapshot.seq > currentSeq : true;
}

export function legacyFailureSnapshot(
  config: [string, string],
  error: unknown,
  seq: number,
  failureCode: BootstrapFailureCode = 'prepare_failed',
): BootstrapSnapshot {
  const detail = error == null ? '' : tauriErrorText(error);
  return {
    seq,
    mode: 'cold_start',
    phase: 'failed',
    stage: null,
    progress: 0,
    failure: { code: detail ? failureCode : 'unknown', detail },
    diagnostics: {
      buildId: '',
      platform: navigator.platform || '',
      projectDir: config[1] || '',
      pythonPath: config[0] || '',
      portState: 'unknown',
      bridgeIdentity: null,
      recentLogs: [],
    },
  };
}

export async function loadSetupBootstrap(invoke: Invoke, seq = 0): Promise<SetupBootstrapState> {
  const config = await invoke<[string, string]>('get_config').catch(() => ['', ''] as [string, string]);
  try {
    return {
      config,
      mode: 'snapshot',
      snapshot: await invoke<BootstrapSnapshot>('get_bootstrap_snapshot'),
    };
  } catch (error) {
    if (!isMissingTauriCommand(error, 'get_bootstrap_snapshot')) throw error;
    const prepareError = await invoke<string | null>('get_prepare_error').catch(() => null);
    return {
      config,
      mode: 'legacy',
      snapshot: legacyFailureSnapshot(config, prepareError, seq),
    };
  }
}

export async function retrySetupBootstrap(
  invoke: Invoke,
  args: { pythonPath: string; projectDir: string },
  preferredMode: SetupBootstrapMode,
): Promise<{ mode: SetupBootstrapMode; error?: unknown }> {
  if (preferredMode === 'snapshot') {
    try {
      await invoke('retry_bootstrap', args);
      return { mode: 'snapshot' };
    } catch (error) {
      if (!isMissingTauriCommand(error, 'retry_bootstrap')) {
        return { mode: 'snapshot', error };
      }
    }
  }

  try {
    await invoke('start_bridge_with_config', args);
    return { mode: 'legacy' };
  } catch (error) {
    return { mode: 'legacy', error };
  }
}
