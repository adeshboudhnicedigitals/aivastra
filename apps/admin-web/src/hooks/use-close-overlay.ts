import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { hasInAppNavigation } from './use-in-app-navigation';

/**
 * "Close" for any URL-tracked overlay (modal, drawer, sub-view, confirm
 * dialog, or a toggle's "collapsed" direction). Calls real browser back so
 * the physical Back button and the overlay's own X/Cancel/collapse control
 * produce the identical result — pushing a "closed" state instead would
 * leave a dead-end forward entry that reopens the overlay on the next Back
 * press.
 *
 * `ownParamKeys` are the query params this overlay owns (e.g. `['modal',
 * 'editId']`) — only read on the fallback path below; the normal path is a
 * pure `navigate(-1)` and never touches them.
 *
 * Falls back to replacing to the current URL with just `ownParamKeys`
 * removed — preserving every sibling param — when this tab has no prior
 * in-app push to go back to (a fresh load or refresh landing directly on a
 * URL that already has the overlay open). A fixed parent URL would work for
 * the "no in-app history" case too, but would also discard any *other*
 * overlay's params that happened to be open at the same time.
 */
export function useCloseOverlay(ownParamKeys: readonly string[]): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  return useCallback(() => {
    if (hasInAppNavigation()) {
      navigate(-1);
      return;
    }
    const params = new URLSearchParams(searchParams);
    for (const key of ownParamKeys) params.delete(key);
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true });
  }, [navigate, location.pathname, searchParams, ownParamKeys]);
}
