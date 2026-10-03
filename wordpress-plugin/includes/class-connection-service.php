<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Verifies a full-scoped API key via GET /v1/dev/me, then persists it
 * (encrypted, via Aivastra_Connection_Settings) alongside the widget key and
 * a display snapshot — the full key is needed later to create Razorpay
 * orders from the "Plans & Credits" card. See
 * docs/superpowers/specs/2026-08-31-wordpress-plugin-credit-purchase-design.md.
 */
class Aivastra_Connection_Service
{
    public function __construct(
        private readonly Aivastra_Connection_Settings $settings,
        private readonly string $apiBase
    ) {
    }

    /** @return array{ok: bool, error?: string} */
    public function connect(string $fullKey, string $widgetKey): array
    {
        $response = wp_remote_get($this->apiBase . '/v1/dev/me', [
            'headers' => ['Authorization' => 'Bearer ' . $fullKey],
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'error' => 'Could not reach the aivastra API.'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return ['ok' => false, 'error' => 'The full API key was rejected (HTTP ' . $code . ').'];
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $companyName = is_array($body) ? ($body['companyName'] ?? '') : '';
        $credits = is_array($body) ? (int) ($body['credits'] ?? 0) : 0;

        $this->settings->set_widget_key_and_snapshot($widgetKey, $fullKey, $companyName, $credits, current_time('mysql'));

        return ['ok' => true];
    }

    /**
     * Re-reads the credit balance using the already-stored widget key —
     * GET /v1/dev/balance accepts widget-scoped keys (unlike /v1/dev/me),
     * so this never requires the merchant to re-paste the full key, which
     * they're unlikely to still have (it's shown once, at creation, and
     * never again).
     *
     * @return array{ok: bool, error?: string}
     */
    public function refresh(): array
    {
        $widgetKey = $this->settings->get_widget_key();
        if ($widgetKey === null) {
            return ['ok' => false, 'error' => 'not_connected'];
        }

        $response = wp_remote_get($this->apiBase . '/v1/dev/balance', [
            'headers' => ['Authorization' => 'Bearer ' . $widgetKey],
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'error' => 'Could not reach the aivastra API.'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return ['ok' => false, 'error' => 'The widget key was rejected (HTTP ' . $code . ').'];
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $credits = is_array($body) ? (int) ($body['credits'] ?? 0) : 0;

        $this->settings->update_credits($credits, current_time('mysql'));

        return ['ok' => true];
    }

    /**
     * The "Current balance" card's two calculated lines: how many try-ons
     * the current credit balance covers, and roughly how many days that
     * lasts at the merchant's own recent pace.
     *
     * tryOnsRemaining comes straight from GET /v1/dev/me (full scope) —
     * connect() already calls this endpoint to verify a new full key, but
     * discards this field; every other call in this class uses the
     * widget-scoped key, which this endpoint doesn't accept.
     * daysRemaining is this plugin's own arithmetic, not an API field: it
     * divides tryOnsRemaining by the merchant's average daily try-ons over
     * GET /v1/dev/analytics's window (same call render_dashboard() makes
     * for the Try-On Activity chart — pass its `daily` rows in via
     * $dailyRows to skip a second fetch; omit it, as
     * Aivastra_Refresh_Ajax does, to have this method fetch its own). Null
     * when there's no usage yet to average (a fresh install, or the
     * analytics call itself failing) — that's still a usable balance
     * summary, just without a day estimate.
     *
     * @param ?array<int, array{day:string,tryOns:int}> $dailyRows
     * @return array{ok: bool, tryOnsRemaining?: int, daysRemaining?: ?int, error?: string}
     */
    public function get_balance_summary(?array $dailyRows = null): array
    {
        $fullKey = $this->settings->get_full_key();
        if ($fullKey === null) {
            return ['ok' => false, 'error' => 'not_connected'];
        }

        $meResponse = wp_remote_get($this->apiBase . '/v1/dev/me', [
            'headers' => ['Authorization' => 'Bearer ' . $fullKey],
            'timeout' => 15,
        ]);
        if (is_wp_error($meResponse)) {
            return ['ok' => false, 'error' => 'Could not reach the aivastra API.'];
        }
        if (wp_remote_retrieve_response_code($meResponse) !== 200) {
            return ['ok' => false, 'error' => 'The full API key was rejected.'];
        }
        $meBody = json_decode(wp_remote_retrieve_body($meResponse), true);
        if (!is_array($meBody) || !isset($meBody['tryOnsRemaining'])) {
            return ['ok' => false, 'error' => 'Unexpected response from the aivastra API.'];
        }
        $tryOnsRemaining = (int) $meBody['tryOnsRemaining'];

        if ($dailyRows === null) {
            $analyticsResponse = wp_remote_get($this->apiBase . '/v1/dev/analytics', [
                'headers' => ['Authorization' => 'Bearer ' . $fullKey],
                'timeout' => 15,
            ]);
            $dailyRows = [];
            if (!is_wp_error($analyticsResponse) && wp_remote_retrieve_response_code($analyticsResponse) === 200) {
                $analyticsBody = json_decode(wp_remote_retrieve_body($analyticsResponse), true);
                $dailyRows = is_array($analyticsBody) && is_array($analyticsBody['daily'] ?? null)
                    ? $analyticsBody['daily']
                    : [];
            }
        }

        $daysRemaining = null;
        if (!empty($dailyRows)) {
            $total = 0;
            foreach ($dailyRows as $d) {
                $total += (int) ($d['tryOns'] ?? 0);
            }
            $avgPerDay = $total / count($dailyRows);
            if ($avgPerDay > 0) {
                $daysRemaining = (int) round($tryOnsRemaining / $avgPerDay);
            }
        }

        return ['ok' => true, 'tryOnsRemaining' => $tryOnsRemaining, 'daysRemaining' => $daysRemaining];
    }

    /**
     * Lists the merchant's active aivastra dev-API categories, for the category
     * mapping screen (§ category mapping) — GET /v1/dev/categories accepts a
     * widget-scoped key (apps/api/src/modules/dev/routes.ts), so no full key is
     * needed here.
     *
     * @return array{ok: bool, categories: array<int, array{slug: string, name: string}>, error?: string}
     */
    public function list_categories(string $widgetKey): array
    {
        $response = wp_remote_get($this->apiBase . '/v1/dev/categories', [
            'headers' => ['Authorization' => 'Bearer ' . $widgetKey],
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'categories' => [], 'error' => 'Could not reach the aivastra API.'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return ['ok' => false, 'categories' => [], 'error' => 'The widget key was rejected (HTTP ' . $code . ').'];
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $categories = is_array($body) ? ($body['categories'] ?? []) : [];

        return ['ok' => true, 'categories' => is_array($categories) ? $categories : []];
    }

    /**
     * Lists the merchant's purchasable credit plans (Basic/Advanced/Pro/
     * Ultra), for the "Plans & Credits" card — GET /v1/dev/plans accepts a
     * widget-scoped key, so no full key is needed here.
     *
     * @return array{ok: bool, plans: array<int, array{slug: string, name: string, priceInr: int, credits: int}>, error?: string}
     */
    public function list_plans(string $widgetKey): array
    {
        $response = wp_remote_get($this->apiBase . '/v1/dev/plans', [
            'headers' => ['Authorization' => 'Bearer ' . $widgetKey],
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'plans' => [], 'error' => 'Could not reach the aivastra API.'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return ['ok' => false, 'plans' => [], 'error' => 'The widget key was rejected (HTTP ' . $code . ').'];
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $plans = is_array($body) ? ($body['plans'] ?? []) : [];

        return ['ok' => true, 'plans' => is_array($plans) ? $plans : []];
    }

    /**
     * Mints a short-lived chatbot session token for the connected merchant —
     * POST /v1/dev/support/session accepts a widget-scoped key, same
     * reasoning as list_categories()/list_plans(). The browser exchanges the
     * returned JWT for a chatbot ws-ticket directly against
     * Aivastra_Settings_Page::CHATBOT_BASE, mirroring
     * apps/shopify/src/hooks/useSupportChat.ts's two-step handshake.
     *
     * @return array{ok: bool, token?: string, error?: string}
     */
    public function create_support_session(): array
    {
        $widgetKey = $this->settings->get_widget_key();
        if ($widgetKey === null) {
            return ['ok' => false, 'error' => 'not_connected'];
        }

        $response = wp_remote_post($this->apiBase . '/v1/dev/support/session', [
            // wp_remote_post() defaults to Content-Type:
            // application/x-www-form-urlencoded when no body is given, and
            // the API only has a JSON body parser registered — an empty
            // urlencoded body 415s. Send an explicit empty JSON body instead,
            // same as create_order()'s POST below.
            'headers' => ['Authorization' => 'Bearer ' . $widgetKey, 'Content-Type' => 'application/json'],
            'body' => '{}',
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'error' => 'Could not reach the aivastra API.'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return ['ok' => false, 'error' => 'The widget key was rejected (HTTP ' . $code . ').'];
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $token = is_array($body) ? ($body['token'] ?? null) : null;
        if (!is_string($token) || $token === '') {
            return ['ok' => false, 'error' => 'Unexpected response from the aivastra API.'];
        }

        return ['ok' => true, 'token' => $token];
    }

    /**
     * Creates a Razorpay order for the given plan using the stored, encrypted
     * full key — POST /v1/dev/payments/orders requires full scope. The
     * decrypted key lives only in this method's local scope.
     *
     * @return array{ok: bool, orderId?: string, amount?: int, currency?: string, keyId?: string, credits?: int, label?: string, error?: string}
     */
    public function create_order(string $planSlug): array
    {
        $fullKey = $this->settings->get_full_key();
        if ($fullKey === null) {
            return ['ok' => false, 'error' => 'not_connected'];
        }

        $response = wp_remote_post($this->apiBase . '/v1/dev/payments/orders', [
            'headers' => [
                'Authorization' => 'Bearer ' . $fullKey,
                'Content-Type' => 'application/json',
            ],
            'body' => wp_json_encode(['planSlug' => $planSlug]),
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'error' => 'Could not reach the aivastra API.'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return ['ok' => false, 'error' => 'Could not start the purchase (HTTP ' . $code . ').'];
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        if (!is_array($body) || !isset($body['orderId'])) {
            return ['ok' => false, 'error' => 'Unexpected response from the aivastra API.'];
        }

        return [
            'ok' => true,
            'orderId' => (string) $body['orderId'],
            'amount' => (int) $body['amount'],
            'currency' => (string) $body['currency'],
            'keyId' => (string) $body['keyId'],
            'credits' => (int) $body['credits'],
            'label' => (string) $body['label'],
        ];
    }

    /**
     * Reads the Analytics card's data using the stored, encrypted full key —
     * GET /v1/dev/analytics requires full scope (aggregate business data,
     * unlike balance/plans/categories above). `cards.tryOns` and `daily` are
     * real (drawn from the jobs table); everything else is advisory,
     * client-reported data from assets/widget.js's POST /v1/dev/widget-event
     * calls — see the comment on that route in
     * apps/api/src/modules/dev/routes.ts.
     *
     * @return array{ok: bool, cards?: array{tryOns:int,uniqueShoppers:int,addedToCart:int,addToCartRate:float}, daily?: array<int, array{day:string,tryOns:int}>, products?: array<int, array{productId:int,tryOns:int,uniqueShoppers:int,addedToCart:int,addToCartRate:float}>, error?: string}
     */
    public function get_analytics(): array
    {
        $fullKey = $this->settings->get_full_key();
        if ($fullKey === null) {
            return ['ok' => false, 'error' => 'not_connected'];
        }

        $response = wp_remote_get($this->apiBase . '/v1/dev/analytics', [
            'headers' => ['Authorization' => 'Bearer ' . $fullKey],
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'error' => 'Could not reach the aivastra API.'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return ['ok' => false, 'error' => 'Could not load analytics (HTTP ' . $code . ').'];
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        if (!is_array($body) || !isset($body['cards'], $body['daily'], $body['products'])) {
            return ['ok' => false, 'error' => 'Unexpected response from the aivastra API.'];
        }

        return [
            'ok' => true,
            'cards' => $body['cards'],
            'daily' => is_array($body['daily']) ? $body['daily'] : [],
            'products' => is_array($body['products']) ? $body['products'] : [],
        ];
    }

    /**
     * Verifies a completed Razorpay payment using the stored widget key —
     * POST /v1/dev/payments/verify accepts widget scope, since verification
     * is a signature check against an order already tied to this merchant.
     *
     * @param array{razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string} $payment
     * @return array{ok: bool, balance?: int, error?: string}
     */
    public function verify_payment(array $payment): array
    {
        $widgetKey = $this->settings->get_widget_key();
        if ($widgetKey === null) {
            return ['ok' => false, 'error' => 'not_connected'];
        }

        $response = wp_remote_post($this->apiBase . '/v1/dev/payments/verify', [
            'headers' => [
                'Authorization' => 'Bearer ' . $widgetKey,
                'Content-Type' => 'application/json',
            ],
            'body' => wp_json_encode($payment),
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'error' => 'Could not reach the aivastra API.'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return ['ok' => false, 'error' => 'Payment could not be verified (HTTP ' . $code . ').'];
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $balance = is_array($body) ? (int) ($body['balance'] ?? 0) : 0;

        $this->settings->update_credits($balance, current_time('mysql'));

        return ['ok' => true, 'balance' => $balance];
    }
}
