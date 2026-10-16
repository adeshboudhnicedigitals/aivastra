import { useReducer } from 'react';
import { fixtureSnapshot } from './fixtures';
import { seedWorkspace, workspaceReducer } from './workspace-demo';

export function useWorkspaceDemo() {
  const [state, dispatch] = useReducer(workspaceReducer, fixtureSnapshot, seedWorkspace);
  return { state, dispatch };
}
export type WorkspaceManager = ReturnType<typeof useWorkspaceDemo>;
