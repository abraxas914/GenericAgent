import { useReducer, useEffect, useCallback } from 'react';
import { reducer, initialState } from './store';
import { subscribe, unsubscribe } from './events';
import { LoadingScreen } from './Loading';
import { ProgressScreen } from './Progress';
import { ReadyScreen } from './Ready';
import { SetupScreen } from './Setup';

export function LoadingApp() {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    subscribe(dispatch);
    return () => unsubscribe();
  }, []);

  const handleRetry = useCallback(() => {
    dispatch({ type: 'retry' });
  }, []);

  let content: React.ReactNode;
  switch (state.route) {
    case 'loading':
      content = <LoadingScreen />;
      break;
    case 'progress':
      content = <ProgressScreen stages={state.stages} overallPct={state.overallPct} logs={state.logs} />;
      break;
    case 'ready':
      content = <ReadyScreen />;
      break;
    case 'setup':
      content = <SetupScreen error={state.error} logs={state.logs} onRetry={handleRetry} />;
      break;
  }

  return (
    <div className="bootstrap-app" data-route={state.route}>
      {content}
    </div>
  );
}
