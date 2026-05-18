import { z } from 'zod';
export const CatalogTypeSlug = z.enum(['models', 'poses', 'backgrounds', 'lower']);
export const CategoryNode = z.object({
  id: z.number().int(),
  slug: z.string(),
  label: z.string(),
  children: z.array(z.lazy((): z.ZodTypeAny => CategoryNode)),
  items: z.array(z.object({
    id: z.string().uuid(),
    label: z.string(),
    thumbnailUrl: z.string().url(),
  })),
});
export const CatalogResponse = z.object({
  type: CatalogTypeSlug,
  tree: z.array(CategoryNode),
});
