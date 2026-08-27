<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Hooked to woocommerce_single_product_summary — reads product id/title/image
 * directly from the live $product object at render time (no sync/cache
 * problem, unlike Shopify's metafield mirror — see
 * docs/wordpress-plugin-design.md §2). Renders nothing if the merchant has
 * not connected a widget key yet.
 */
class Aivastra_Widget_Loader
{
    // LOCAL DEV OVERRIDE: this API_BASE is sent to the BROWSER (via
    // wp_localize_script below) — widget.js runs on the shopper's machine,
    // not inside the WordPress container, so it must use the host's own
    // view of the network (`localhost`), NOT `host.docker.internal` (a
    // Docker-internal DNS alias a normal browser can't resolve). Contrast
    // with Aivastra_Settings_Page::API_BASE, which runs server-side inside
    // the container and does need host.docker.internal. Points at
    // `pnpm --filter @aivastra/api dev` (port 4000, apps/api/src/env.ts).
    // Revert to 'https://api.aivastra.com' before any real/staging use.
    private const API_BASE = 'http://localhost:4000';

    public static function init(): void
    {
        add_action('woocommerce_single_product_summary', [self::class, 'render'], 25);
    }

    public static function render(): void
    {
        global $product;
        if (!$product instanceof WC_Product) {
            return;
        }

        $settings = new Aivastra_Connection_Settings();
        $widgetKey = $settings->get_widget_key();
        if ($widgetKey === null) {
            return;
        }

        $imageId = $product->get_image_id();
        $imageUrl = $imageId ? wp_get_attachment_image_url($imageId, 'large') : false;
        $config = Aivastra_Widget_Config::build($product->get_id(), $product->get_name(), $imageUrl);

        // Which try-on workflow runs is chosen server-side (dev_tryon_categories
        // slug -> workflow_templates), never by the plugin — this only resolves
        // WHICH slug to ask for, from the merchant's WooCommerce-category mapping
        // (Settings -> Aivastra Try-On -> Category mapping). Falls back to
        // 'general' when the product's category has no mapping.
        $categoryTermIds = wp_get_post_terms($product->get_id(), 'product_cat', ['fields' => 'ids']);
        $category = Aivastra_Category_Mapping::resolve(
            is_array($categoryTermIds) ? $categoryTermIds : [],
            $settings->get_category_map()
        );

        wp_enqueue_style('aivastra-tryon-widget', AIVASTRA_TRYON_URL . 'assets/widget.css', [], AIVASTRA_TRYON_VERSION);
        wp_enqueue_script('aivastra-tryon-widget-logic', AIVASTRA_TRYON_URL . 'assets/widget-logic.js', [], AIVASTRA_TRYON_VERSION, true);
        wp_enqueue_script('aivastra-tryon-widget', AIVASTRA_TRYON_URL . 'assets/widget.js', ['aivastra-tryon-widget-logic'], AIVASTRA_TRYON_VERSION, true);
        wp_localize_script('aivastra-tryon-widget', 'AivastraTryOn', array_merge($config, [
            'widgetKey' => $widgetKey,
            'apiBase' => self::API_BASE,
            'category' => $category,
        ]));

        echo '<button type="button" id="aivastra-tryon-button" class="aivastra-tryon-button">Try It On</button>';
        echo '<div id="aivastra-tryon-modal" class="aivastra-tryon-modal" hidden></div>';
    }
}
