import { requireMerchant } from '../../lib';
import { SettingsContent } from './SettingsContent';

export default async function SettingsPage() {
  const { data } = await requireMerchant();
  return <SettingsContent data={data} />;
}
