<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * The embedded "log in or sign up with your Ai Vastra email" form
 * (admin/class-settings-page.php's render_connect_form(), primary path per
 * docs/wordpress-plugin-design.md §4.1) — posts here via
 * admin/assets/connect.js instead of a full-page admin-post.php submit, so a
 * returning admin's whole connection happens in one AJAX round trip with no
 * redirect anywhere. Same nonce-gated, admin-only pattern as every other
 * *_Ajax class in this plugin; the password arrives only in this request's
 * POST body and is discarded once login_or_register() returns.
 */
class Aivastra_Connect_Ajax
{
    private const ACTION = 'aivastra_tryon_connect_login';
    public const NONCE_ACTION = 'aivastra_tryon_connect_login';

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

        $email = sanitize_email((string) ($_POST['email'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $phone = sanitize_text_field((string) ($_POST['phone'] ?? ''));

        if ($email === '' || !is_email($email)) {
            wp_send_json_error(['message' => 'Enter a valid email address.']);
        }
        if ($password === '') {
            wp_send_json_error(['message' => 'Enter your password.']);
        }

        $service = new Aivastra_Connection_Service(new Aivastra_Connection_Settings(), Aivastra_Settings_Page::API_BASE);
        $result = $service->login_or_register(
            $email,
            $password,
            home_url('/'),
            get_bloginfo('name'),
            wp_get_current_user()->display_name,
            $phone === '' ? null : $phone
        );

        if (!$result['ok']) {
            wp_send_json_error([
                'status' => $result['status'],
                'message' => $result['error'] ?? 'Something went wrong. Try again.',
            ]);
        }

        wp_send_json_success([
            'status' => $result['status'],
            'companyName' => $result['companyName'] ?? null,
            'credits' => $result['credits'] ?? null,
        ]);
    }
}
