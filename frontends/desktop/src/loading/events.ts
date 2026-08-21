import type { BootstrapAction } from './store';
import type { BootstrapSnapshot } from './types';
import { isMissingTauriCommand } from '../services/tauri-compat';

type Dispatch = (action: BootstrapAction) => void;
type LegacyProgress = { pct: number; key: string };
type LegacyProgressWindow = Window & {
  gaProgress?: (pct: number, key: string) => void;
  __GA_LEGACY_PROGRESS__?: LegacyProgress[];
};

let unlisten: (() => void) | null = null;
let stopLegacyProgress: (() => void) | null = null;
let subscriptionGeneration = 0;
let legacyProgressSeq = 0;

const LEGACY_STAGE: Record<string, string> = {
  start: 'validate',
  venv: 'python',
  deps: 'dependencies',
  done: 'service',
  starting: 'service',
};

function legacySnapshot(seq: number, pct: number, key: string): BootstrapSnapshot {
  const progress = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return {
    seq,
    mode: 'prepare',
    phase: progress >= 100 ? 'ready' : 'preparing',
    stage: LEGACY_STAGE[key] ?? 'dependencies',
    progress,
    failure: null,
    diagnostics: {
      buildId: '',
      platform: navigator.platform || '',
      projectDir: '',
      pythonPath: '',
      portState: 'unknown',
      bridgeIdentity: null,
      recentLogs: [],
    },
  };
}

function installLegacyProgress(dispatch: Dispatch, generation: number): () => void {
  const host = window as LegacyProgressWindow;
  const queued = host.__GA_LEGACY_PROGRESS__ ?? [];
  host.__GA_LEGACY_PROGRESS__ = queued;
  const previous = host.gaProgress;
  const handle = (pct: number, key: string) => {
    if (generation !== subscriptionGeneration) return;
    dispatch({
      type: 'snapshot',
      snapshot: legacySnapshot(++legacyProgressSeq, pct, String(key || '')),
    });
  };

  const pending = queued.splice(0, queued.length);
  host.gaProgress = handle;
  pending.forEach(({ pct, key }) => handle(pct, key));

  return () => {
    if (host.gaProgress === handle) {
      if (previous) host.gaProgress = previous;
      else delete host.gaProgress;
    }
  };
}

function mockSnapshot(seq: number, phase: BootstrapSnapshot['phase']): BootstrapSnapshot {
  const preparing = phase === 'preparing';
  return {
    seq,
    mode: preparing ? 'prepare' : 'cold_start',
    phase,
    stage: preparing ? 'dependencies' : phase === 'starting_service' ? 'service' : null,
    progress: phase === 'ready' ? 100 : preparing ? 55 : 15,
    failure: null,
    diagnostics: {
      buildId: 'development',
      platform: navigator.platform || 'web',
      projectDir: '',
      pythonPath: '',
      portState: 'unknown',
      bridgeIdentity: null,
      recentLogs: preparing ? ['Installing runtime components…'] : [],
    },
  };
}

function runDevMock(dispatch: Dispatch) {
  const timers = [
    setTimeout(() => dispatch({ type: 'snapshot', snapshot: mockSnapshot(1, 'resolving') }), 300),
    setTimeout(() => dispatch({ type: 'snapshot', snapshot: mockSnapshot(2, 'preparing') }), 900),
    setTimeout(() => dispatch({ type: 'snapshot', snapshot: mockSnapshot(3, 'starting_service') }), 1800),
    setTimeout(() => dispatch({ type: 'snapshot', snapshot: mockSnapshot(4, 'ready') }), 2600),
  ];
  unlisten = () => timers.forEach(clearTimeout);
}

export async function subscribe(dispatch: Dispatch): Promise<void> {
  const generation = ++subscriptionGeneration;
  stopLegacyProgress?.();
  stopLegacyProgress = installLegacyProgress(dispatch, generation);
  const tauri = (window as Window & {
    __TAURI__?: {
      event?: { listen?: (name: string, handler: (event: { payload: BootstrapSnapshot }) => void) => Promise<() => void> };
      core?: { invoke?: <T>(command: string) => Promise<T> };
    };
  }).__TAURI__;

  if (!tauri?.core?.invoke) {
    runDevMock(dispatch);
    return;
  }

  let stopListening: (() => void) | undefined;
  if (tauri.event?.listen) {
    try {
      stopListening = await tauri.event.listen('bootstrap', (event) => {
        if (generation === subscriptionGeneration) {
          dispatch({ type: 'snapshot', snapshot: event.payload as BootstrapSnapshot });
        }
      });
    } catch (error) {
      console.warn('[bootstrap] event subscription unavailable; using legacy progress updates', error);
    }
  }
  if (generation !== subscriptionGeneration) {
    stopListening?.();
    return;
  }
  if (stopListening) {
    unlisten?.();
    unlisten = stopListening;
  }

  try {
    const snapshot = await tauri.core.invoke<BootstrapSnapshot>('get_bootstrap_snapshot') as BootstrapSnapshot;
    if (generation === subscriptionGeneration) {
      dispatch({ type: 'snapshot', snapshot });
    }
  } catch (error) {
    if (!isMissingTauriCommand(error, 'get_bootstrap_snapshot')) throw error;
  }
}

export function unsubscribe(): void {
  subscriptionGeneration += 1;
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  stopLegacyProgress?.();
  stopLegacyProgress = null;
}
