<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Verifies a full-scoped API key via GET /v1/dev/me, then discards it — only
 * the widget key and a display snapshot are ever persisted (via
 * Aivastra_Connection_Settings). The full key parameter to connect() lives
 * only in this method's local scope. See docs/wordpress-plugin-design.md §4.3.
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

        $this->settings->set_widget_key_and_snapshot($widgetKey, $companyName, current_time('mysql'));

        return ['ok' => true];
    }
}
