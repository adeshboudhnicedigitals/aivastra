// Shared by page.tsx, fabric-to-shoot-section.tsx and
// fabric-to-shoot-preview-panel.tsx.
export interface FabricGarmentTypeOption {
  id: string;
  slug: string;
  genderSlug: 'men' | 'women' | null;
  label: string;
  thumbnailUrl: string | null;
  // Links this preset to Studio's garment type (garment_subcategories). Null
  // means the preset isn't wired into the Studio-style follow-on flow yet —
  // the page falls back to stopping after the garment image is generated.
  garmentTypeId: string | null;
}
