import { requireMerchant } from '../../lib';
import { DashboardContent } from './DashboardContent';

export default async function MerchantDashboardPage() {
  const { data } = await requireMerchant();
  return <DashboardContent data={data} />;
}
