import { requireMerchant } from '../../lib';
import { ApiKeysContent } from './ApiKeysContent';

export default async function ApiKeysPage() {
  const { data } = await requireMerchant();
  return <ApiKeysContent data={data} />;
}
