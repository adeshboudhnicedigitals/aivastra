import { requireMerchant } from '../../lib';
import { KioskDevicesContent } from './KioskDevicesContent';

export default async function MerchantKioskDevicesPage() {
  const { data } = await requireMerchant();
  return <KioskDevicesContent data={data} />;
}
