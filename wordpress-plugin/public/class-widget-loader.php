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
    private const API_BASE = 'https://api.aivastra.com';

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

        wp_enqueue_style('aivastra-tryon-widget', AIVASTRA_TRYON_URL . 'assets/widget.css', [], AIVASTRA_TRYON_VERSION);
        wp_enqueue_script('aivastra-tryon-widget-logic', AIVASTRA_TRYON_URL . 'assets/widget-logic.js', [], AIVASTRA_TRYON_VERSION, true);
        wp_enqueue_script('aivastra-tryon-widget', AIVASTRA_TRYON_URL . 'assets/widget.js', ['aivastra-tryon-widget-logic'], AIVASTRA_TRYON_VERSION, true);
        wp_localize_script('aivastra-tryon-widget', 'AivastraTryOn', array_merge($config, [
            'widgetKey' => $widgetKey,
            'apiBase' => self::API_BASE,
        ]));

        echo '<button type="button" id="aivastra-tryon-button" class="aivastra-tryon-button">Try It On</button>';
        echo '<div id="aivastra-tryon-modal" class="aivastra-tryon-modal" hidden></div>';
    }
}
