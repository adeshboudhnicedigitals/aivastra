'use client';

import { useBreakpoint } from '@/hooks/use-breakpoint';
import { DesktopLayout } from './layouts/Desktop';
import { MobileLayout } from './layouts/Mobile';
import { TabletLayout } from './layouts/Tablet';
import { useTryOnData } from './use-tryon-data';

export default function TryOnPage() {
  const data = useTryOnData();
  const tier = useBreakpoint();

  // null until useBreakpoint resolves post-hydration — render nothing rather
  // than falling through to Desktop, which would flash the wrong layout on
  // mobile/tablet for one frame.
  if (tier === null) {
    return null;
  }

  if (tier === 'mobile') {
    return <MobileLayout {...data} />;
  }

  if (tier === 'tablet' || tier === 'small-laptop') {
    return <TabletLayout {...data} />;
  }

  return <DesktopLayout {...data} />;
}
