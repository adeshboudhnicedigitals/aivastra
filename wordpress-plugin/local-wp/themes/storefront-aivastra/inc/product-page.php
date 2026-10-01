<?php
declare(strict_types=1);

/**
 * Single product page matching shopify.aivastra.com/products/...: no
 * breadcrumb or "Category: X" meta line, a pill-style Size selector, the
 * Aivastra Virtual Try-On button, a quantity-stepper + Add to cart row, a
 * full-width Buy it now button, category-templated Description + Key
 * Features copy, and a "New Perspective" / "The art of everyday dressing"
 * section below the related-products grid.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once get_stylesheet_directory() . '/inc/product-copy.php';

/**
 * Default WooCommerce short-description (20) and meta line (40) removed —
 * replaced below with category-templated Description + Key Features (the
 * imported demo catalog has no bespoke per-product copy, see
 * product-copy.php), and the reference never shows a "Category: X" line at
 * all. The Description/Reviews tabs block (woocommerce_after_single_product_summary
 * @10) is removed too — the reference has no Reviews section, and its
 * Description tab would just duplicate the copy already shown above.
 */
add_action('wp', function (): void {
    if (is_product()) {
        remove_action('woocommerce_single_product_summary', 'woocommerce_template_single_excerpt', 20);
        remove_action('woocommerce_single_product_summary', 'woocommerce_template_single_meta', 40);
        remove_action('woocommerce_after_single_product_summary', 'woocommerce_output_product_data_tabs', 10);
    }
});

/**
 * Size selector (M/L/XL/2XL) — cosmetic only. The imported demo catalog is
 * all WC_Product_Simple (import-products.php), so there is no real
 * WooCommerce variation behind this; matches the reference's own generic,
 * non-bespoke per-product presentation. Printed before the Add to cart form
 * (woocommerce_template_single_add_to_cart runs at 30).
 */
add_action('woocommerce_single_product_summary', function (): void {
    ?>
    <div class="aivastra-size-selector" role="group" aria-label="Size">
        <span class="aivastra-size-label">Size</span>
        <div class="aivastra-size-pills">
            <?php foreach (['M', 'L', 'XL', '2XL'] as $index => $size) : ?>
                <button type="button" class="aivastra-size-pill<?php echo $index === 0 ? ' is-selected' : ''; ?>"><?php echo esc_html($size); ?></button>
            <?php endforeach; ?>
        </div>
    </div>
    <?php
}, 24);

/**
 * Whether a merchant has actually connected the Aivastra Try-On plugin
 * (Settings -> Aivastra Try-On) — mirrors Aivastra_Connection_Settings's own
 * check without depending on the plugin being active, since the theme must
 * still render sensibly if it isn't.
 */
function aivastra_widget_is_connected(): bool
{
    $settings = get_option('aivastra_tryon_settings', []);
    return is_array($settings) && !empty($settings['widget_key']);
}

/**
 * Fallback Virtual Try-On button. Aivastra_Widget_Loader (the plugin,
 * woocommerce_single_product_summary @25) only prints once a widget key is
 * connected; this local demo store has none, so its button never renders.
 * Same id/classes as the real one so the shared CSS in style.css and the
 * label override in assets/product-page.js apply to whichever one actually
 * prints — the two are mutually exclusive, never both in the DOM at once.
 */
add_action('woocommerce_single_product_summary', function (): void {
    if (aivastra_widget_is_connected()) {
        return;
    }
    ?>
    <button type="button" id="aivastra-tryon-button" class="aivastra-tryon-button">
        <svg class="aivastra-button-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
        </svg>
        <span>Try It On</span>
    </button>
    <?php
}, 25);

/**
 * Buy it now — WooCommerce has no native equivalent. A second button next to
 * the plain form.cart submit that flags the same POST (assets/product-page.js)
 * and is redirected straight to checkout by the filter below, instead of
 * needing a parallel AJAX add-to-cart implementation.
 */
add_action('woocommerce_single_product_summary', function (): void {
    global $product;
    if (!$product instanceof WC_Product || !$product->is_purchasable()) {
        return;
    }
    ?>
    <button type="button" class="aivastra-buy-now-button">Buy it now</button>
    <?php
}, 31);

add_filter('woocommerce_add_to_cart_redirect', function (string $url): string {
    if (!empty($_POST['aivastra_buy_now'])) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
        return wc_get_checkout_url();
    }
    return $url;
});

/**
 * Description + Key Features — replaces the removed default excerpt/meta.
 */
add_action('woocommerce_single_product_summary', function (): void {
    global $product;
    if (!$product instanceof WC_Product) {
        return;
    }
    $copy = aivastra_product_copy($product);
    ?>
    <div class="aivastra-product-copy">
        <p class="aivastra-product-description"><?php echo esc_html($copy['description']); ?></p>
        <div class="aivastra-product-features">
            <h3>Key Features</h3>
            <ul>
                <?php foreach ($copy['features'] as $feature) : ?>
                    <li><?php echo esc_html($feature); ?></li>
                <?php endforeach; ?>
            </ul>
        </div>
    </div>
    <?php
}, 45);

/**
 * "New Perspective" / "The art of everyday dressing" — a static section on
 * every single-product page, below "You may also like". Confirmed against
 * the reference as product-page-only, not global/homepage content.
 */
add_action('woocommerce_after_single_product', function (): void {
    ?>
    <section class="aivastra-seasonal-edit">
        <div class="aivastra-seasonal-edit-text">
            <p class="aivastra-seasonal-edit-eyebrow">New Perspective</p>
            <h2 class="aivastra-seasonal-edit-heading">The art of everyday dressing</h2>
            <p class="aivastra-seasonal-edit-copy">Thoughtful silhouettes and considered details for a wardrobe in motion.</p>
            <p class="aivastra-seasonal-edit-copy">Explore the pieces that define the season, made to be worn, layered and lived in.</p>
        </div>
        <div class="aivastra-seasonal-edit-images">
            <div class="aivastra-seasonal-edit-image aivastra-seasonal-edit-image--feature">
                <span>Add a feature image</span>
            </div>
            <div class="aivastra-seasonal-edit-image aivastra-seasonal-edit-image--supporting">
                <span>Add a supporting image</span>
            </div>
        </div>
        <p class="aivastra-seasonal-edit-caption">A study in texture, proportion and quiet confidence.</p>
    </section>
    <?php
}, 20);

/**
 * assets/product-page.js: size-pill selection, the Buy it now -> checkout
 * flag, a stepper wrapped around WooCommerce's plain quantity input, and (see
 * the fallback button comment above) the outer Try-On button's label — fixed
 * in the plugin's PHP as "Try It On" for every merchant, overridden here to
 * this store's reference copy without touching the shared plugin file.
 */
add_action('wp_enqueue_scripts', function (): void {
    if (!is_product()) {
        return;
    }
    $path = get_stylesheet_directory() . '/assets/product-page.js';
    wp_enqueue_script(
        'aivastra-product-page',
        get_stylesheet_directory_uri() . '/assets/product-page.js',
        [],
        file_exists($path) ? (string) filemtime($path) : '1.0.0',
        true
    );
}, 21);
