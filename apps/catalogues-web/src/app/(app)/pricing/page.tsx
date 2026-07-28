'use client';

import { Desktop } from './layouts/Desktop';
import { usePricingData } from './use-pricing-data';

export default function PricingPage(): React.ReactElement {
  const data = usePricingData();
  return <Desktop {...data} />;
}
