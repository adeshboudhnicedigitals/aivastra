import { requireMerchant } from '../../lib';
import { TryOnResultsContent } from './TryOnResultsContent';

export default async function TryOnResultsPage() {
  await requireMerchant();
  return <TryOnResultsContent />;
}
