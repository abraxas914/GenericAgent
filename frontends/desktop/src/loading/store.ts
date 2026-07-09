export type Route = 'loading' | 'progress' | 'ready' | 'setup';

export type StageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface Stage {
  key: string;
  state: StageState;
  pct: number;
}

export interface BootstrapState {
  route: Route;
  mode: 'hot_start' | 'cold_start' | 'prepare' | null;
  stages: Stage[];
  logs: string[];
  error: string | null;
  overallPct: number;
}

export type BootstrapAction =
  | { type: 'start'; mode: 'hot_start' | 'cold_start' | 'prepare' }
  | { type: 'stage'; key: string; state: StageState; pct: number }
  | { type: 'log'; line: string }
  | { type: 'ready' }
  | { type: 'failed'; error: string }
  | { type: 'retry' };

const KNOWN_STAGES = ['start', 'venv', 'deps', 'done', 'starting'];

const MAX_LOGS = 50;

export const initialState: BootstrapState = {
  route: 'loading',
  mode: null,
  stages: [],
  logs: [],
  error: null,
  overallPct: 0,
};

export function reducer(state: BootstrapState, action: BootstrapAction): BootstrapState {
  switch (action.type) {
    case 'start': {
      const route = action.mode === 'prepare' ? 'progress' : 'loading';
      const stages: Stage[] = action.mode === 'prepare'
        ? KNOWN_STAGES.map((key) => ({ key, state: 'pending' as StageState, pct: 0 }))
        : [];
      return { ...state, route, mode: action.mode, stages, error: null, overallPct: 0 };
    }
    case 'stage': {
      const stages = state.stages.map((s) =>
        s.key === action.key ? { ...s, state: action.state, pct: action.pct } : s,
      );
      // If stage not in known list, append it
      if (!stages.some((s) => s.key === action.key)) {
        stages.push({ key: action.key, state: action.state, pct: action.pct });
      }
      return { ...state, route: 'progress', stages, overallPct: action.pct };
    }
    case 'log': {
      const logs = [...state.logs, action.line].slice(-MAX_LOGS);
      return { ...state, logs };
    }
    case 'ready':
      return { ...state, route: 'ready', overallPct: 100, error: null };
    case 'failed':
      return { ...state, route: 'setup', error: action.error };
    case 'retry':
      return { ...initialState };
    default:
      return state;
  }
}
