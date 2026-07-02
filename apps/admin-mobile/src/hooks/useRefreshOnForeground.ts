import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function useRefreshOnForeground(refresh: () => Promise<unknown> | void) {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        void refresh();
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [refresh]);
}
