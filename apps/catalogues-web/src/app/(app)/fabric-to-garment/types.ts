// Shared by page.tsx, fabric-to-garment-section.tsx and
// fabric-to-garment-preview-panel.tsx.
export interface FabricGarmentTypeOption {
  id: string;
  slug: string;
  genderSlug: 'men' | 'women' | null;
  label: string;
  thumbnailUrl: string | null;
}
