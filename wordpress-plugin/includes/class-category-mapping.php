<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Maps a WooCommerce product's category (term ID) to an aivastra dev-API
 * category slug, so the storefront widget can pick the right try-on workflow
 * per product. Pure functions only — no wp_options access here, that's
 * Aivastra_Connection_Settings's job (see its class comment: it's the ONLY
 * class that touches the options row).
 */
class Aivastra_Category_Mapping
{
    /**
     * Used to fall back to a hardcoded 'general' slug for an unmapped
     * product. That isn't a real category on a live account (confirmed
     * against a connected merchant — their active dev-API slugs are
     * upper/lower/suits/dress/saree/dress-with-duppatta, no 'general'), so
     * sending it made create-job.ts's category lookup fail BAD_CATEGORY —
     * the shopper only found out after uploading a photo. Returning null
     * instead lets class-widget-loader.php hide the button entirely for a
     * product with no explicit mapping.
     *
     * @param int[] $productCategoryTermIds The product's WooCommerce product_cat term IDs.
     * @param array<int, string> $map term_id => aivastra category slug.
     * @return string|null The mapped slug, or null if none of the product's categories are mapped.
     */
    public static function resolve(array $productCategoryTermIds, array $map): ?string
    {
        foreach ($productCategoryTermIds as $termId) {
            if (isset($map[$termId]) && $map[$termId] !== '') {
                return $map[$termId];
            }
        }
        return null;
    }

    /**
     * Drops anything that doesn't point at a real WooCommerce category or a
     * real, currently-active aivastra category — a stale mapping (a deleted
     * WooCommerce category, or an aivastra category since deactivated) must
     * not silently keep routing shoppers to a workflow that no longer exists,
     * nor let arbitrary POST data set an unvalidated slug.
     *
     * @param array<int|string, string> $rawMap
     * @param int[] $validTermIds
     * @param string[] $validSlugs
     * @return array<int, string>
     */
    public static function sanitize(array $rawMap, array $validTermIds, array $validSlugs): array
    {
        $clean = [];
        foreach ($rawMap as $termId => $slug) {
            $termId = (int) $termId;
            $slug = trim((string) $slug);
            if ($slug === '') {
                continue;
            }
            if (!in_array($termId, $validTermIds, true)) {
                continue;
            }
            if (!in_array($slug, $validSlugs, true)) {
                continue;
            }
            $clean[$termId] = $slug;
        }
        return $clean;
    }
}
