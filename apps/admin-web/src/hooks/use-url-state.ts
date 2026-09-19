import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { markInAppNavigation } from './use-in-app-navigation';

/**
 * Multiple query-param-backed values, read together and written atomically in
 * one push. Use this whenever two or more params represent one logical piece
 * of state (e.g. `view` + `gtId` for "which sub-view, of which record") so
 * entering/leaving that state is a single history entry, not two.
 *
 * Always pushes (never `{ replace: true }`) so every change is a browser Back
 * stop. Params not named in `next` are left untouched.
 */
export function useUrlStateMulti(
  keys: readonly string[],
): [Record<string, string | null>, (next: Record<string, string | null>) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const values: Record<string, string | null> = {};
  for (const k of keys) values[k] = searchParams.get(k);

  const setValues = useCallback(
    (next: Record<string, string | null>) => {
      markInAppNavigation();
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v === null) params.delete(k);
          else params.set(k, v);
        }
        return params;
      });
    },
    [setSearchParams],
  );

  return [values, setValues];
}

/** Single-param convenience wrapper around `useUrlStateMulti`. */
export function useUrlState(key: string): [string | null, (value: string | null) => void] {
  const [values, setValues] = useUrlStateMulti([key]);
  const setValue = useCallback(
    (value: string | null) => setValues({ [key]: value }),
    [setValues, key],
  );
  return [values[key], setValue];
}
