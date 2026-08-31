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
