<?php
/**
 * Plugin Name: Aivastra Try-On
 * Description: Adds an AI virtual try-on button to WooCommerce product pages.
 * Version: 0.4.0
 * Requires PHP: 8.1
 * Requires Plugins: woocommerce
 * License: GPL-2.0-or-later
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit; // No direct access.
}

define('AIVASTRA_TRYON_VERSION', '0.4.0');
define('AIVASTRA_TRYON_DIR', plugin_dir_path(__FILE__));
define('AIVASTRA_TRYON_URL', plugin_dir_url(__FILE__));

require_once AIVASTRA_TRYON_DIR . 'includes/class-connection-settings.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-connection-service.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-widget-config.php';
require_once AIVASTRA_TRYON_DIR . 'includes/class-category-mapping.php';
require_once AIVASTRA_TRYON_DIR . 'admin/class-settings-page.php';
require_once AIVASTRA_TRYON_DIR . 'public/class-widget-loader.php';

// No external calls on activation — connection happens explicitly in
// settings, per docs/wordpress-plugin-design.md §4.3.
register_activation_hook(__FILE__, function (): void {
    // Nothing to do yet: no options need a default value before first save.
});

add_action('plugins_loaded', function (): void {
    Aivastra_Settings_Page::init();
    Aivastra_Widget_Loader::init();
});
