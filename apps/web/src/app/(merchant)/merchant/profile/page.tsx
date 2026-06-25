import { requireMerchant } from '../../lib';
import { ProfileContent } from './ProfileContent';

export default async function ProfilePage() {
  const { data } = await requireMerchant();
  return <ProfileContent data={data} />;
}
