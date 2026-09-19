import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasInAppNavigation } from './use-in-app-navigation';

/**
 * "Close" for any URL-tracked overlay (modal, drawer, sub-view, confirm
 * dialog). Calls real browser back so the physical Back button and the
 * overlay's own X/Cancel button produce the identical result — pushing a
 * "closed" state instead would leave a dead-end forward entry that reopens
 * the overlay on the next Back press.
 *
 * Falls back to replacing to `toParentUrl` when this tab has no prior in-app
 * push to go back to (a fresh load or refresh landing directly on a URL that
 * already has the overlay open) — otherwise browser back could exit the app.
 */
export function useCloseOverlay(toParentUrl: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    if (hasInAppNavigation()) {
      navigate(-1);
    } else {
      navigate(toParentUrl, { replace: true });
    }
  }, [navigate, toParentUrl]);
}
