import { requireMerchant } from '../../lib';
import { CatalogContent } from './CatalogContent';

export default async function MerchantCatalogPage() {
  await requireMerchant();
  return <CatalogContent />;
}
