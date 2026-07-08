import type { BootstrapAction } from './store';

type Dispatch = (action: BootstrapAction) => void;

interface BootstrapPayload {
  type: 'start' | 'stage' | 'log' | 'ready' | 'failed';
  mode?: 'hot_start' | 'cold_start' | 'prepare';
  key?: string;
  state?: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  pct?: number;
  line?: string;
  error?: string;
}

let unlisten: (() => void) | null = null;

function handlePayload(dispatch: Dispatch, p: BootstrapPayload) {
  switch (p.type) {
    case 'start':
      dispatch({ type: 'start', mode: p.mode ?? 'cold_start' });
      break;
    case 'stage':
      dispatch({ type: 'stage', key: p.key ?? '', state: p.state ?? 'running', pct: p.pct ?? 0 });
      break;
    case 'log':
      dispatch({ type: 'log', line: p.line ?? '' });
      break;
    case 'ready':
      dispatch({ type: 'ready' });
      break;
    case 'failed':
      dispatch({ type: 'failed', error: p.error ?? 'Unknown error' });
      break;
  }
}

function runDevMock(dispatch: Dispatch) {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('mock') || 'success';

  const success: Array<[number, BootstrapPayload]> = [
    [500, { type: 'start', mode: 'prepare' }],
    [1200, { type: 'stage', key: 'start', state: 'running', pct: 5 }],
    [1800, { type: 'log', line: 'Checking embedded python...' }],
    [2200, { type: 'stage', key: 'start', state: 'done', pct: 10 }],
    [2400, { type: 'stage', key: 'venv', state: 'running', pct: 15 }],
    [2800, { type: 'log', line: 'Creating virtual environment...' }],
    [3500, { type: 'stage', key: 'venv', state: 'done', pct: 30 }],
    [3700, { type: 'stage', key: 'deps', state: 'running', pct: 35 }],
    [4200, { type: 'log', line: 'Installing fastapi uvicorn websockets...' }],
    [5000, { type: 'log', line: 'Processing dependencies...' }],
    [6000, { type: 'stage', key: 'deps', state: 'done', pct: 75 }],
    [6200, { type: 'stage', key: 'done', state: 'done', pct: 90 }],
    [6500, { type: 'stage', key: 'starting', state: 'running', pct: 95 }],
    [7500, { type: 'stage', key: 'starting', state: 'done', pct: 100 }],
    [8000, { type: 'ready' }],
  ];

  const fail: Array<[number, BootstrapPayload]> = [
    [500, { type: 'start', mode: 'prepare' }],
    [1200, { type: 'stage', key: 'start', state: 'running', pct: 5 }],
    [1800, { type: 'log', line: 'Checking embedded python...' }],
    [2200, { type: 'stage', key: 'start', state: 'done', pct: 10 }],
    [2400, { type: 'stage', key: 'venv', state: 'running', pct: 15 }],
    [2800, { type: 'log', line: 'Creating virtual environment...' }],
    [3500, { type: 'stage', key: 'venv', state: 'done', pct: 30 }],
    [3700, { type: 'stage', key: 'deps', state: 'running', pct: 35 }],
    [4200, { type: 'log', line: 'pip install --no-index --find-links wheels/ fastapi' }],
    [4800, { type: 'log', line: 'ERROR: Could not find a version that satisfies the requirement uvicorn' }],
    [5200, { type: 'stage', key: 'deps', state: 'failed', pct: 40 }],
    [5500, { type: 'log', line: 'prepare exited with status 1' }],
    [6000, { type: 'failed', error: 'prepare exited with status 1: pip install failed — missing wheel for uvicorn. 请检查 wheels/ 目录完整性或手动配置 Python 路径。' }],
  ];

  const hot: Array<[number, BootstrapPayload]> = [
    [300, { type: 'start', mode: 'hot_start' }],
    [1200, { type: 'ready' }],
  ];

  const sequences: Record<string, Array<[number, BootstrapPayload]>> = { success, fail, hot };
  const seq = sequences[scenario] || success;

  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const [delay, payload] of seq) {
    timers.push(setTimeout(() => handlePayload(dispatch, payload), delay));
  }

  unlisten = () => timers.forEach(clearTimeout);
}

/**
 * Legacy compatibility shim: the Rust side still calls `w.eval("window.gaProgress(pct, key)")`
 * until Phase 4 migrates to `app.emit("bootstrap", ...)`. This shim translates those calls
 * into BootstrapActions so the React state machine works with both the old eval path and the
 * new event path. Once the Rust emit migration is complete, this shim can be removed.
 */
function installGaProgressShim(dispatch: Dispatch) {
  let started = false;
  (window as any).gaProgress = (pct: number, key: string) => {
    if (!started) {
      started = true;
      handlePayload(dispatch, { type: 'start', mode: 'prepare' });
    }
    if (key === 'starting' && pct >= 95) {
      handlePayload(dispatch, { type: 'stage', key, state: 'done', pct: 100 });
      // The old code path navigates via Rust after port check; emit ready so the React
      // Ready screen renders the brief "done" flash before Rust navigates away.
      setTimeout(() => handlePayload(dispatch, { type: 'ready' }), 300);
    } else {
      handlePayload(dispatch, { type: 'stage', key, state: pct >= 90 ? 'done' : 'running', pct });
    }
  };
}

export async function subscribe(dispatch: Dispatch): Promise<void> {
  const tauri = (window as any).__TAURI__;

  if (!tauri?.event?.listen) {
    runDevMock(dispatch);
    return;
  }

  // Install legacy shim for the old w.eval("window.gaProgress(...)") path.
  // This ensures the loading UI works before the Rust emit migration (Phase 4).
  installGaProgressShim(dispatch);

  unlisten = await tauri.event.listen('bootstrap', (event: { payload: BootstrapPayload }) => {
    handlePayload(dispatch, event.payload);
  });
}

export function unsubscribe(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}
