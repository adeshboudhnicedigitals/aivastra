<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Mints a chatbot session token for the settings page's "Start a chat"
 * button, so the browser JS (admin/assets/support-chat.js) never handles the
 * merchant's stored API key directly — same admin-only, nonce-gated pattern
 * as class-checkout-ajax.php.
 */
class Aivastra_Support_Ajax
{
    private const ACTION = 'aivastra_tryon_support_session';
    public const NONCE_ACTION = 'aivastra_tryon_support_session';

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

        $service = new Aivastra_Connection_Service(new Aivastra_Connection_Settings(), Aivastra_Settings_Page::API_BASE);
        $result = $service->create_support_session();

        if (!$result['ok']) {
            $message = $result['error'] === 'not_connected'
                ? 'Connect your account before starting a chat.'
                : 'Could not start a chat session — try again in a moment.';
            wp_send_json_error(['message' => $message]);
        }

        wp_send_json_success(['token' => $result['token']]);
    }
}
