<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * The Dashboard's "Refresh balance" button (render_connection_section())
 * used to be a full form POST to admin-post.php, landing the merchant back
 * on the page with a dismissible WP admin notice ("Balance refreshed.") —
 * harmless on the old tabbed layout, but on the one-page dashboard
 * WordPress core's own common.js relocates every such notice to right after
 * the first <h1> on the page, which is the app header's own logo row,
 * wedging the notice between the logo and the version pill. This AJAX
 * endpoint lets admin/assets/refresh-balance.js update the credit number in
 * place instead, with no page reload and no notice — same nonce-gated,
 * admin-only pattern as class-support-ajax.php.
 */
class Aivastra_Refresh_Ajax
{
    private const ACTION = 'aivastra_tryon_refresh_balance';
    public const NONCE_ACTION = 'aivastra_tryon_refresh_balance';

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

        $settings = new Aivastra_Connection_Settings();
        $service = new Aivastra_Connection_Service($settings, Aivastra_Settings_Page::API_BASE);
        $result = $service->refresh();

        if (!$result['ok']) {
            $message = $result['error'] === 'not_connected'
                ? 'Connect your account before refreshing.'
                : 'Could not refresh your balance — try again in a moment.';
            wp_send_json_error(['message' => $message]);
        }

        // refresh() already wrote the fresh values via update_credits();
        // read them back rather than re-deriving from $result, which only
        // ever carries {ok}. get_balance_summary() is a second, independent
        // round trip (GET /v1/dev/me, and GET /v1/dev/analytics since no
        // $dailyRows are on hand here) — its own failure still leaves the
        // credit refresh itself successful, so it degrades to null fields
        // rather than failing the whole response.
        $balanceSummary = $service->get_balance_summary();
        wp_send_json_success([
            'credits' => $settings->get_credits(),
            'creditsAsOf' => $settings->get_credits_as_of(),
            'tryOnsRemaining' => $balanceSummary['ok'] ? $balanceSummary['tryOnsRemaining'] : null,
            'daysRemaining' => $balanceSummary['ok'] ? $balanceSummary['daysRemaining'] : null,
        ]);
    }
}
