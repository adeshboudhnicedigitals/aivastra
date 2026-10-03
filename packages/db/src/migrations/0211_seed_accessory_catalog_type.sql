-- seed catalog type for accessories (necklaces, watches, belts, etc.)
INSERT INTO catalog_types (slug, label)
VALUES
  ('accessory', 'Accessories')
ON CONFLICT (slug) DO NOTHING;
