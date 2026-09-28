-- Custom SQL migration file, put your code below! --

-- GET /v1/dev/catalog/options?gender=women&garmentType=<slug> returns shoeItems
-- via catalog_item_subcategories rows, not the pose/workflow mechanism the Studio
-- wizard and admin panel use to decide footwear is "enabled" for a pose (that's
-- pose_garment_configs + workflow_templates.shoeNodeId, a completely separate
-- table). These 24 women's garment types had zero catalog_item_subcategories
-- rows, so the two systems disagreed: the wizard showed footwear as available
-- (gender-wide pool of 161 items) while the dev API returned []. Reported by a
-- peer session bulk-trying-on against the dev API.
--
-- `saree` and `saree-on-mannequin` are deliberately excluded — footwear rarely
-- renders in saree poses, and the peer's own saree body+pallu upload / mannequin
-- pipeline is explicitly out of scope for this fix. Nothing here touches saree
-- code or data; the WHERE clause below never matches either slug regardless.
--
-- Plain INSERT ... SELECT with ON CONFLICT DO NOTHING onto the table's own
-- (catalog_item_id, subcategory_id) primary key, not a delete-then-replace —
-- unlike PATCH /admin/catalog/items/:id (which replaces an item's
-- subcategoryIds wholesale), this only adds rows, so it can't touch the
-- associations that already make chudidar/kurti/mini-frock/co-ord-set work.
-- Idempotent: safe to apply more than once, and safe on an environment where
-- some of these 24 garment-type rows don't exist yet (they simply won't
-- match any garment_subcategories row and contribute no insert).
INSERT INTO "catalog_item_subcategories" ("catalog_item_id", "subcategory_id")
SELECT ci."id", gs."id"
FROM "catalog_items" ci
CROSS JOIN "garment_subcategories" gs
WHERE ci."type" = 'shoe'
  AND ci."gender_slug" = 'women'
  AND gs."gender_slug" = 'women'
  AND gs."public_api_slug" IN (
    'suit-women',
    'blazer-women',
    'knee-length-frock',
    'cocktail',
    'jumpsuit',
    'kurti-pyjama',
    'anarkali',
    'jean-women',
    'baggy-jean-women',
    'trouser-women',
    'track-women',
    'long-skirt',
    'mini-skirt',
    'short-women',
    'inner-wear',
    'mini-frock-mannequin',
    'long-frock-mannequin-women',
    'cocktail-mannequin',
    'kurti-on-mannequin',
    'lehenga-mannequin',
    'half-saree-mannequin',
    'one-piece-suit-women',
    'chudidar-on-mannequin',
    'knee-length-frock-on-mannequin'
  )
  AND gs."public_api_slug" NOT IN ('saree', 'saree-on-mannequin')
ON CONFLICT ("catalog_item_id", "subcategory_id") DO NOTHING;
