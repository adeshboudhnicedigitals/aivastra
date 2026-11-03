<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Tells the storefront widget who the shopper is, in a form the Ai Vastra API
 * can trust.
 *
 * The widget calls POST /v1/dev/tryon straight from the shopper's browser with
 * the PUBLIC widget key, so the API can't tell who is behind a request. When
 * the merchant has set shopper limits (Customize -> Try-on limits), the API
 * refuses any try-on that doesn't carry a token signed here with the
 * account's shopper-token secret — which only this server holds. That is what
 * makes "require login" and "N try-ons per shopper per 24 hours" real rather
 * than a hint in the page's JavaScript: whoever calls the API directly has no
 * valid token.
 *
 * Public on purpose (wp_ajax_nopriv_*): guests are shoppers too. No WP nonce —
 * storefront pages are routinely full-page cached, so a nonce baked into the
 * page would be stale; the response only goes to the page's own origin
 * (admin-ajax sends no CORS headers) and carries no secret.
 *
 * Token format (matches apps/api/src/modules/dev/shopper-policy.ts):
 *   base64url(json{sid, lg, exp}) . base64url(hmac_sha256(payload, secret))
 */
class Aivastra_Shopper_Token_Ajax
{
    public const ACTION = 'aivastra_tryon_shopper_token';
    public const GUEST_COOKIE = 'aivastra_tryon_sid';
    public const TOKEN_TTL = 600;

    public static function init(): void
    {
        add_action('wp_ajax_' . self::ACTION, [self::class, 'handle']);
        add_action('wp_ajax_nopriv_' . self::ACTION, [self::class, 'handle']);
    }

    public static function base64url(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    /**
     * @param string $sid "u:<wp user id>" or "g:<guest id>"
     */
    public static function sign_token(string $secret, string $sid, bool $loggedIn, int $expiresAt): string
    {
        $payload = self::base64url((string) wp_json_encode([
            'sid' => $sid,
            'lg' => $loggedIn ? 1 : 0,
            'exp' => $expiresAt,
        ]));
        $signature = self::base64url(hash_hmac('sha256', $payload, $secret, true));
        return $payload . '.' . $signature;
    }

    /** Stable random id for a not-logged-in shopper, kept in a cookie. */
    private static function guest_id(): string
    {
        $existing = isset($_COOKIE[self::GUEST_COOKIE]) ? (string) wp_unslash($_COOKIE[self::GUEST_COOKIE]) : '';
        if (preg_match('/^[a-f0-9]{24}$/', $existing) === 1) {
            return $existing;
        }
        $id = bin2hex(random_bytes(12));
        if (!headers_sent()) {
            setcookie(self::GUEST_COOKIE, $id, [
                'expires' => time() + YEAR_IN_SECONDS,
                'path' => '/',
                'secure' => is_ssl(),
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
        }
        return $id;
    }

    public static function handle(): void
    {
        nocache_headers();

        $settings = new Aivastra_Connection_Settings();
        $policy = $settings->get_shopper_policy();
        $secret = $settings->get_shopper_token_secret();

        // No policy, or one that restricts nothing: the API asks for no token.
        if ($policy === null || $secret === null || (!$policy['login_required'] && $policy['cap'] === null)) {
            wp_send_json_success(['required' => false]);
        }

        $loggedIn = is_user_logged_in();
        $redirect = isset($_REQUEST['redirect']) ? esc_url_raw(wp_unslash((string) $_REQUEST['redirect'])) : '';
        $redirect = wp_validate_redirect($redirect, home_url('/'));

        if ($policy['login_required'] && !$loggedIn) {
            wp_send_json_success([
                'required' => true,
                'loginRequired' => true,
                'loggedIn' => false,
                'loginUrl' => wp_login_url($redirect),
            ]);
        }

        $sid = $loggedIn ? 'u:' . get_current_user_id() : 'g:' . self::guest_id();
        wp_send_json_success([
            'required' => true,
            'loginRequired' => (bool) $policy['login_required'],
            'loggedIn' => $loggedIn,
            'token' => self::sign_token($secret, $sid, $loggedIn, time() + self::TOKEN_TTL),
        ]);
    }
}
