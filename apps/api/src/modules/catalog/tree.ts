import type { schema } from '@aivastra/db';
type Cat = typeof schema.catalogCategories.$inferSelect;
type Item = typeof schema.catalogItems.$inferSelect & { thumbnailUrl: string };

export function buildTree(cats: Cat[], items: Item[]) {
  const byParent = new Map<number | null, Cat[]>();
  for (const c of cats) {
    const k = c.parentId ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(c);
  }
  const itemsByCat = new Map<number, Item[]>();
  for (const i of items) {
    if (i.categoryId == null) continue;
    if (!itemsByCat.has(i.categoryId)) itemsByCat.set(i.categoryId, []);
    itemsByCat.get(i.categoryId)!.push(i);
  }
  const walk = (parentId: number | null): unknown[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({
        id: c.id, slug: c.slug, label: c.label,
        children: walk(c.id),
        items: (itemsByCat.get(c.id) ?? []).map((i) => ({
          id: i.id, label: i.label, thumbnailUrl: i.thumbnailUrl,
        })),
      }));
  return walk(null);
}
