<?php
/**
 * Wires the vendored Plugin Update Checker (PUC, MIT-licensed,
 * github.com/YahnisElsts/plugin-update-checker) to our own JSON update-manifest
 * endpoint (GET /v1/wordpress-plugin/update-info,
 * apps/api/src/modules/admin/config.routes.ts), giving direct-share installs a
 * normal wp-admin "Update available" row despite not being on wp.org.
 *
 * This file and includes/vendor/plugin-update-checker/ are deliberately absent
 * from the wp.org submission zip (see the packaging script) — a wp.org-listed
 * plugin must not carry its own update mechanism, since WordPress core already
 * owns updates for a listed slug via the SVN Stable tag. aivastra-tryon.php
 * guards the require behind file_exists() so the wp.org build (which omits
 * this file) simply skips it, same as any other optional add-on file a
 * WordPress plugin might or might not ship with.
 */

if (!defined('ABSPATH')) {
    exit; // No direct access.
}

final class Aivastra_Update_Checker
{
    private const METADATA_URL = Aivastra_Settings_Page::API_BASE . '/v1/wordpress-plugin/update-info';

    public static function init(): void
    {
        $vendorEntryPoint = AIVASTRA_TRYON_DIR . 'includes/vendor/plugin-update-checker/plugin-update-checker.php';
        if (!file_exists($vendorEntryPoint)) {
            return;
        }
        require_once $vendorEntryPoint;

        if (!class_exists(\YahnisElsts\PluginUpdateChecker\v5\PucFactory::class)) {
            return;
        }

        \YahnisElsts\PluginUpdateChecker\v5\PucFactory::buildUpdateChecker(
            self::METADATA_URL,
            AIVASTRA_TRYON_DIR . 'aivastra-tryon.php',
            'aivastra-tryon',
        );
    }
}
