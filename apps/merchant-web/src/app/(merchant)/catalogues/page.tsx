import { requireMerchant } from '../../lib';
import { CataloguesContent } from './CataloguesContent';

export default async function MerchantCataloguesPage() {
  await requireMerchant();
  return <CataloguesContent />;
}
