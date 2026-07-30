import { useLayoutEffect, useState } from 'react';

/**
 * Reactive single-query matchMedia hook. Returns null on the first render
 * (so any SSR / initial hydration stays consistent), then resolves
 * synchronously in useLayoutEffect before paint.
 */
export function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null);

  useLayoutEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = () => setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
