<?php
/**
 * Plugin Name: Ai Vastra Try-On
 * Description: Adds an AI virtual try-on button to WooCommerce product pages.
 * Version: 0.5.13
 * Requires PHP: 8.1
 * Requires Plugins: woocommerce
 * License: GPL-2.0-or-later
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit; // No direct access.
}

define('AIVASTRA_TRYON_VERSION', '0.5.13');
define('AIVASTRA_TRYON_DIR', plugin_dir_path(__FILE__));
define('AIVASTRA_TRYON_URL', plugin_dir_url(__FILE__));

require_once AIVASTRA_TRYON_DIR . 'includes/class-crypto.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-widget-customization.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-connection-settings.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-connection-service.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-widget-config.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-category-mapping.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-product-toggle.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-cart-ajax.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-checkout-ajax.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-support-ajax.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-refresh-ajax.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-connect-ajax.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-category-map-ajax.php';
require_once AIVASTRA_TRYON_DIR . 'admin/class-settings-page.php';
require_once AIVASTRA_TRYON_DIR . 'public/class-widget-loader.php';

// Update checker: present only in the direct-share build, never in the wp.org
// submission zip — see includes/class-update-checker.php's doc comment.
$aivastra_update_checker_file = AIVASTRA_TRYON_DIR . 'includes/class-update-checker.php';
if (file_exists($aivastra_update_checker_file)) {
    require_once $aivastra_update_checker_file;
}

// No external calls on activation — connection happens explicitly in
// settings, per docs/wordpress-plugin-design.md §4.3.
register_activation_hook(__FILE__, function (): void {
    // Nothing to do yet: no options need a default value before first save.
    aivastra_tryon_flush_page_caches();
});

/**
 * The Try-On button is never stored anywhere — it's echoed fresh by
 * Aivastra_Widget_Loader::render() on every request the plugin is loaded
 * for, so deactivating already stops it from being injected at the PHP
 * level. If a merchant still sees the button (or still doesn't see it after
 * reactivating), the page they're looking at is being served from a cache —
 * a caching plugin, the host's edge/object cache, or their own browser —
 * that was populated before the toggle. Proactively flushing the caching
 * plugins WooCommerce stores commonly run means the change is visible
 * immediately instead of waiting out that cache's own TTL. Every call is
 * function_exists-guarded since none of these plugins are a dependency;
 * do_action() for LiteSpeed is safe to fire unconditionally either way, it's
 * a no-op with no listener registered.
 */
function aivastra_tryon_flush_page_caches(): void
{
    wp_cache_flush();

    if (function_exists('rocket_clean_domain')) {
        rocket_clean_domain(); // WP Rocket
    }
    if (function_exists('w3tc_flush_all')) {
        w3tc_flush_all(); // W3 Total Cache
    }
    if (function_exists('wp_cache_clear_cache')) {
        wp_cache_clear_cache(); // WP Super Cache
    }
    if (function_exists('sg_cachepress_purge_cache')) {
        sg_cachepress_purge_cache(); // SiteGround Optimizer
    }
    if (function_exists('wpfc_clear_all_cache')) {
        wpfc_clear_all_cache(); // WP Fastest Cache
    }
    if (function_exists('breeze_clear_all_cache')) {
        breeze_clear_all_cache(); // Breeze (Cloudways)
    }
    do_action('litespeed_purge_all'); // LiteSpeed Cache
}

register_deactivation_hook(__FILE__, 'aivastra_tryon_flush_page_caches');

add_action('plugins_loaded', function (): void {
    Aivastra_Settings_Page::init();
    Aivastra_Widget_Loader::init();
    Aivastra_Cart_Ajax::init();
    Aivastra_Checkout_Ajax::init();
    Aivastra_Support_Ajax::init();
    Aivastra_Refresh_Ajax::init();
    Aivastra_Connect_Ajax::init();
    Aivastra_Category_Map_Ajax::init();
    Aivastra_Product_Toggle::init();
});

// On `init`, not `plugins_loaded`: building the checker schedules its cron
// event on the first request after activation, and wp_schedule_event() runs
// the `cron_schedules` filter — where WooCommerce translates its interval
// labels. Before `init` that trips WordPress 6.7+'s "translation loading for
// the woocommerce domain was triggered too early" notice, which with
// WP_DEBUG on also breaks the activation redirect ("headers already sent").
add_action('init', function (): void {
    if (class_exists('Aivastra_Update_Checker')) {
        Aivastra_Update_Checker::init();
    }
});
