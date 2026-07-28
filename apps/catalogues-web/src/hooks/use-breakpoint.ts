import { useLayoutEffect, useState } from 'react';

export type Tier = 'mobile' | 'tablet' | 'small-laptop' | 'laptop' | 'desktop';

const QUERIES: Record<Tier, string> = {
  mobile: '(max-width: 639px)',
  tablet: '(min-width: 640px) and (max-width: 1023px)',
  'small-laptop': '(min-width: 1024px) and (max-width: 1279px)',
  laptop: '(min-width: 1280px) and (max-width: 1535px)',
  desktop: '(min-width: 1536px)',
};

/**
 * Resolves the current viewport tier via matchMedia. Returns null on the
 * server and on the client's first render (so SSR and initial hydration
 * match exactly), then resolves synchronously in useLayoutEffect before
 * paint. Listeners stay attached so resizing/rotating live-updates the tier.
 */
export function useBreakpoint(): Tier | null {
  const [tier, setTier] = useState<Tier | null>(null);

  useLayoutEffect(() => {
    const entries = (Object.entries(QUERIES) as [Tier, string][]).map(
      ([t, q]) => [t, window.matchMedia(q)] as const,
    );
    const resolve = () => {
      const match = entries.find(([, mql]) => mql.matches);
      setTier(match ? match[0] : 'desktop');
    };
    resolve();
    for (const [, mql] of entries) mql.addEventListener('change', resolve);
    return () => {
      for (const [, mql] of entries) mql.removeEventListener('change', resolve);
    };
  }, []);

  return tier;
}
