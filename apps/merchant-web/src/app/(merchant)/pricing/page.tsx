import { requireMerchant } from '../../lib';
import { PricingContent } from './PricingContent';

export default async function PricingPage() {
  const { data } = await requireMerchant();
  return <PricingContent data={data} />;
}
