<?php
declare(strict_types=1);

/**
 * Runs only on actual plugin deletion from wp-admin (not on deactivation).
 * Mirrors Aivastra_Connection_Settings::clear() — kept as a plain
 * delete_option() rather than loading that class, since uninstall.php runs
 * standalone and none of the plugin's includes are guaranteed loaded here.
 */
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('aivastra_tryon_settings');
delete_option('aivastra_tryon_onboarding_done');
delete_option('aivastra_tryon_limits_done');
// Legacy flag from the retired categories onboarding step.
delete_option('aivastra_tryon_categories_done');
