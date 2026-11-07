import { C } from '@/components/tokens';
import { CatalogueManagerContent } from './CatalogueManagerContent';

export const metadata = {
  title: 'Catalogue | Ai Vastra',
};

export default function CataloguePage() {
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>
        Catalogue
      </h1>
      <CatalogueManagerContent />
    </div>
  );
}
