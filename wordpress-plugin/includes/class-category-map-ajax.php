<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * "Save categories" (render_category_mapping(), admin/assets/save-categories.js)
 * used to be a full form POST to admin-post.php, landing the merchant back on
 * the page with a dismissible "Categories saved." WP admin notice — core's
 * own common.js relocates every such notice to right after the page's first
 * <h1>/<h2>, nowhere near the Save button that was actually clicked. This
 * AJAX endpoint saves the mapping in place instead, same nonce-gated,
 * admin-only pattern as class-refresh-ajax.php. The one case that still
 * needs a real navigation — this save completing onboarding step 2 — is
 * signalled back via `redirectUrl` rather than handled with a redirect here;
 * the browser landing on the dashboard is its own confirmation, same as
 * every other onboarding transition on this page.
 */
class Aivastra_Category_Map_Ajax
{
    private const ACTION = 'aivastra_tryon_save_category_map';
    public const NONCE_ACTION = 'aivastra_tryon_save_category_map';

    public static function init(): void
    {
        add_action('wp_ajax_' . self::ACTION, [self::class, 'handle']);
    }

    /**
     * Re-validates against both taxonomies server-side, same as the
     * admin-post.php handler this replaced — a stale term ID (a deleted
     * WooCommerce category) or an unknown/inactive aivastra slug must never
     * be persisted, even if that's what the form posted.
     */
    public static function handle(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error(['message' => 'You do not have permission to do this.'], 403);
        }
        check_ajax_referer(self::NONCE_ACTION);

        $settings = new Aivastra_Connection_Settings();
        $widgetKey = $settings->get_widget_key();
        // Captured before set_category_map()/update_option() below — the
        // only signal distinguishing "this save completes onboarding step 2"
        // (tell the browser to move on to the dashboard) from "this save
        // came from the regular Categories page, reached long after
        // onboarding" (stay put, just confirm inline).
        $wasOnboarding = get_option(Aivastra_Settings_Page::ONBOARDING_DONE_OPTION_KEY) !== '1';

        if ($widgetKey === null) {
            wp_send_json_error(['message' => 'Connect your account before setting up categories.']);
        }

        $service = new Aivastra_Connection_Service($settings, Aivastra_Settings_Page::API_BASE);
        $result = $service->list_categories($widgetKey);
        $validSlugs = array_map(
            static fn (array $c): string => (string) ($c['slug'] ?? ''),
            $result['categories']
        );

        $terms = get_terms(['taxonomy' => 'product_cat', 'hide_empty' => false, 'fields' => 'ids']);
        $validTermIds = is_wp_error($terms) ? [] : array_map('intval', $terms);

        $rawMap = $_POST['aivastra_category_map'] ?? [];
        $clean = Aivastra_Category_Mapping::sanitize(
            is_array($rawMap) ? $rawMap : [],
            $validTermIds,
            $validSlugs
        );
        $settings->set_category_map($clean);
        update_option(Aivastra_Settings_Page::ONBOARDING_DONE_OPTION_KEY, '1', false);

        wp_send_json_success([
            'redirectUrl' => $wasOnboarding ? admin_url('admin.php?page=aivastra-tryon') : null,
        ]);
    }
}
