<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Per-row "Try-On enabled" checkbox on the Manage page's Eligibility tab
 * (Aivastra_Settings_Page::render_product_eligibility_list()) — fires one
 * AJAX call per toggle instead of a single big form submit, the same
 * instant-save idiom as class-refresh-ajax.php, since a merchant with
 * hundreds of products would otherwise have to scroll back to a single Save
 * button after flipping one switch. Writes straight through
 * Aivastra_Product_Toggle's own _aivastra_tryon_enabled post meta — the only
 * per-product eligibility mechanism this plugin has (see that class's own
 * comment) — there is no separate "enabled" list or table this duplicates.
 */
class Aivastra_Product_Eligibility_Ajax
{
    private const ACTION = 'aivastra_tryon_set_product_eligibility';
    public const NONCE_ACTION = 'aivastra_tryon_set_product_eligibility';

    public static function init(): void
    {
        add_action('wp_ajax_' . self::ACTION, [self::class, 'handle']);
    }

    public static function handle(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error(['message' => 'You do not have permission to do this.'], 403);
        }
        check_ajax_referer(self::NONCE_ACTION, 'nonce');

        $productId = isset($_POST['productId']) ? (int) $_POST['productId'] : 0;
        $product = $productId > 0 ? get_post($productId) : null;
        if (!$product || $product->post_type !== 'product') {
            wp_send_json_error(['message' => 'Unknown product.'], 404);
        }

        $enabled = Aivastra_Product_Toggle::sanitize_checkbox($_POST['enabled'] ?? null) === '1';
        update_post_meta($productId, Aivastra_Product_Toggle::META_KEY, $enabled ? '1' : '0');

        wp_send_json_success(['productId' => $productId, 'enabled' => $enabled]);
    }
}
