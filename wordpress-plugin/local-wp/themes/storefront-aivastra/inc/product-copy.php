<?php
declare(strict_types=1);

/**
 * Category-templated Description + "Key Features" copy for the imported demo
 * catalog (see local-wp/import-products.php) — every product there is
 * machine-imported from a bare image with no bespoke copy of its own.
 * shopify.aivastra.com itself reuses generic (sometimes mismatched) copy
 * across products the same way — e.g. its "Men Colourblocked Polo Collar
 * T-shirt" shows a women's kurta set's description — so one description per
 * category here follows the reference's own pattern rather than faking
 * per-image bespoke copy that doesn't exist.
 */

if (!defined('ABSPATH')) {
    exit;
}

const AIVASTRA_PRODUCT_COPY = [
    'blazers' => ['noun' => 'blazer', 'fabric' => 'a wool-blend', 'fit' => 'tailored'],
    'full-sleeve-shirts' => ['noun' => 'shirt', 'fabric' => 'a breathable cotton', 'fit' => 'regular'],
    'full-sleeve-tshirts' => ['noun' => 'T-shirt', 'fabric' => 'a soft cotton-jersey', 'fit' => 'relaxed'],
    'half-sleeve-shirts' => ['noun' => 'shirt', 'fabric' => 'a lightweight cotton', 'fit' => 'regular'],
    'half-sleeve-tshirts' => ['noun' => 'T-shirt', 'fabric' => 'a soft cotton-jersey', 'fit' => 'relaxed'],
    'hoodies' => ['noun' => 'hoodie', 'fabric' => 'a brushed fleece', 'fit' => 'relaxed'],
    'jackets' => ['noun' => 'jacket', 'fabric' => 'a weather-ready shell', 'fit' => 'tailored'],
    'polo' => ['noun' => 'polo', 'fabric' => 'a breathable piqué cotton', 'fit' => 'regular'],
    'sleeveless-tshirts' => ['noun' => 'tank', 'fabric' => 'a soft cotton-jersey', 'fit' => 'relaxed'],
    'kurtas' => ['noun' => 'kurta', 'fabric' => 'a breathable cotton-blend', 'fit' => 'straight'],
    'sherwanis' => ['noun' => 'sherwani', 'fabric' => 'a richly textured silk-blend', 'fit' => 'tailored'],
    'suits' => ['noun' => 'suit', 'fabric' => 'a fine wool-blend', 'fit' => 'tailored'],
    'womens-hoodies' => ['noun' => 'hoodie', 'fabric' => 'a brushed fleece', 'fit' => 'relaxed'],
    'womens-jackets' => ['noun' => 'jacket', 'fabric' => 'a weather-ready shell', 'fit' => 'tailored'],
    'womens-shirts' => ['noun' => 'shirt', 'fabric' => 'a lightweight cotton', 'fit' => 'regular'],
    'womens-sweatshirts' => ['noun' => 'sweatshirt', 'fabric' => 'a soft brushed fleece', 'fit' => 'relaxed'],
    'crop-tops' => ['noun' => 'crop top', 'fabric' => 'a soft cotton-blend', 'fit' => 'fitted'],
    'jumpsuits' => ['noun' => 'jumpsuit', 'fabric' => 'a fluid crepe', 'fit' => 'relaxed'],
    'kurthis' => ['noun' => 'kurthi', 'fabric' => 'a breathable cotton-blend', 'fit' => 'straight'],
    'frocks' => ['noun' => 'frock', 'fabric' => 'a lightweight cotton-blend', 'fit' => 'flared'],
    'sarees' => ['noun' => 'saree', 'fabric' => 'a lustrous silk-blend', 'fit' => 'draped'],
];

/**
 * Products are assigned exactly one leaf category by import-products.php, but
 * this walks past any non-leaf term defensively rather than assuming it.
 */
function aivastra_product_category_slug(WC_Product $product): ?string
{
    $terms = get_the_terms($product->get_id(), 'product_cat');
    if (!is_array($terms) || empty($terms)) {
        return null;
    }
    foreach ($terms as $term) {
        if ($term->parent !== 0) {
            return $term->slug;
        }
    }
    return $terms[0]->slug;
}

/**
 * @return array{description: string, features: array<int, string>}
 */
function aivastra_product_copy(WC_Product $product): array
{
    $slug = aivastra_product_category_slug($product);
    $meta = AIVASTRA_PRODUCT_COPY[$slug] ?? ['noun' => 'piece', 'fabric' => 'a premium fabric', 'fit' => 'considered'];

    $description = sprintf(
        'Crafted from %s with a %s fit, this %s pairs everyday comfort with a considered finish — designed to move easily from one part of the day into the next.',
        $meta['fabric'],
        $meta['fit'],
        $meta['noun']
    );

    $features = [
        sprintf('Made from %s for all-day comfort', $meta['fabric']),
        sprintf('%s fit, true to size', ucfirst((string) $meta['fit'])),
        'Reinforced stitching for lasting wear',
        'Easy care — machine washable',
    ];

    return ['description' => $description, 'features' => $features];
}
