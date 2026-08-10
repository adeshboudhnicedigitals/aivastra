import { useMediaQuery } from './use-media-query';

export type Tier = 'mobile' | 'tablet' | 'small-laptop' | 'laptop' | 'desktop';

const QUERIES: Record<Tier, string> = {
  mobile: '(max-width: 639px)',
  tablet: '(min-width: 640px) and (max-width: 1023px)',
  'small-laptop': '(min-width: 1024px) and (max-width: 1279px)',
  laptop: '(min-width: 1280px) and (max-width: 1535px)',
  desktop: '(min-width: 1536px)',
};

/**
 * Resolves the current viewport tier. Internally five independent
 * useMediaQuery() calls — one per tier — since exactly one of these five
 * ranges is ever true at a time (they're contiguous and non-overlapping).
 * Returns null until the first one resolves (see useMediaQuery's SSR/
 * hydration note).
 */
export function useBreakpoint(): Tier | null {
  const isMobile = useMediaQuery(QUERIES.mobile);
  const isTablet = useMediaQuery(QUERIES.tablet);
  const isSmallLaptop = useMediaQuery(QUERIES['small-laptop']);
  const isLaptop = useMediaQuery(QUERIES.laptop);
  const isDesktop = useMediaQuery(QUERIES.desktop);

  if (
    isMobile === null ||
    isTablet === null ||
    isSmallLaptop === null ||
    isLaptop === null ||
    isDesktop === null
  ) {
    return null;
  }
  if (isMobile) return 'mobile';
  if (isTablet) return 'tablet';
  if (isSmallLaptop) return 'small-laptop';
  if (isLaptop) return 'laptop';
  if (isDesktop) return 'desktop';
  return 'desktop';
}
