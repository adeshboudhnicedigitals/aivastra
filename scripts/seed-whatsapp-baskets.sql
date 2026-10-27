-- Seeds WhatsApp baskets (docs/handovers/2026-10-26-whatsapp-baskets-classifier-handoff.md §7)
-- and maps garment types into them. LOCAL DEV ONLY: refuses to run on any database
-- other than tryon_dev (CLAUDE.md: no data writes against production; build the real
-- production baskets in admin → WhatsApp → Baskets).
--
--   docker exec -i aivastra-postgres psql -U tryon -d tryon_dev -v ON_ERROR_STOP=1 < scripts/seed-whatsapp-baskets.sql
--
-- Idempotent: a basket is found by (gender, name); members are (re)assigned. A member is
-- skipped (NOTICE) unless it is active and single-image (no lower/third/fourth upload, no
-- mannequin step), the same rule the bot applies; a basket left with no members is dropped.
-- Representative type is left null, so the bot uses the first ready member.
--
-- Men's upper / blazer-and-jacket baskets are PROVISIONAL: the CSV only covers women's
-- garments and men's lowers. Boys and girls have no baskets yet.
DO $$
DECLARE
  b record;
  m record;
  basket_id uuid;
  type_id uuid;
  assigned int;
BEGIN
  IF current_database() <> 'tryon_dev' THEN
    RAISE EXCEPTION 'refusing to seed baskets into database %', current_database();
  END IF;

  FOR b IN
    SELECT * FROM (VALUES
      -- gender, basket name, sort, member type slugs (within that gender)
      ('women', 'Two piece',         10, ARRAY['shirt','half-sleeve-shirt','tshirt','full-sleeve-tshirt','sweatshirt','hoodie','top','crop-top']),
      ('women', 'One piece',         20, ARRAY['knee-length-frock','knee-length-frock-on-mannequin','mini-frock','mini-frock-mannequin','kurti-on-mannequin','chudidar-on-mannequin','jumpsuit']),
      ('women', 'Cocktail',          30, ARRAY['cocktail-']),
      ('women', 'Blazer and jacket', 40, ARRAY['blazer','jacket']),
      ('women', 'Kurthi',            50, ARRAY['kurta','kurta-pyjama']),
      ('women', 'Lehenga',           60, ARRAY['lehenga-mannequin','half-saree']),
      ('women', 'Saree',             70, ARRAY['mannequin']),
      ('women', 'One piece suit',    80, ARRAY['one-piece-suit']),
      ('women', 'Two piece suit',    90, ARRAY['suit','co-ord-set']),
      ('women', 'Chudidar',         100, ARRAY['chudidar','anarkali']),
      ('women', 'Lower',            110, ARRAY['jeans','trouser','track','mini-skirt','short']),
      ('women', 'Long skirt',       120, ARRAY['long-skirt']),
      ('women', 'Baggy',            130, ARRAY['baggy-jeans']),
      ('women', 'Innerwear',        140, ARRAY['bra']),
      ('men',   'Lower',             10, ARRAY['cargo','trousers','jeans','formals','tracks']),
      ('men',   'Baggy lower',       20, ARRAY['baggy-jeans','baggyjeans']),
      ('men',   'Upper',             30, ARRAY['full-sleeve-shirt','half-sleeve-shirt','full-sleeve-t-shirt','half-sleeve-t-shirt','polo','sweatshirts','hoodie','vest','tank-top','tanktop']),
      ('men',   'Blazer and jacket', 40, ARRAY['blazers','jackets'])
    ) AS v(gender, name, sort_order, slugs)
  LOOP
    SELECT id INTO basket_id FROM whatsapp_baskets WHERE gender_slug = b.gender AND name = b.name;
    IF basket_id IS NULL THEN
      INSERT INTO whatsapp_baskets (gender_slug, name, sort_order)
      VALUES (b.gender, b.name, b.sort_order) RETURNING id INTO basket_id;
    END IF;

    assigned := 0;
    FOR m IN SELECT unnest(b.slugs) AS slug LOOP
      SELECT id INTO type_id FROM garment_subcategories s
      WHERE s.gender_slug = b.gender AND s.slug = m.slug AND s.is_active
        AND NOT (s.requires_lower_upload OR s.requires_third_upload
                 OR s.allows_fourth_upload OR s.requires_mannequin_step)
      LIMIT 1;
      IF type_id IS NULL THEN
        RAISE NOTICE 'skip %/%: not an active single-image type of % (basket %)', b.gender, m.slug, b.gender, b.name;
      ELSE
        UPDATE garment_subcategories SET whatsapp_basket_id = basket_id WHERE id = type_id;
        assigned := assigned + 1;
      END IF;
    END LOOP;
    IF assigned = 0 THEN
      DELETE FROM whatsapp_baskets WHERE id = basket_id;
      RAISE NOTICE 'basket %/% dropped: no eligible members', b.gender, b.name;
    ELSE
      RAISE NOTICE 'basket %/% : % member(s)', b.gender, b.name, assigned;
    END IF;
  END LOOP;
END $$;
