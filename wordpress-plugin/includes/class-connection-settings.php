<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * The ONLY class that touches the plugin's wp_options row. Deliberately has
 * no method that stores a full-scoped API key — the full key is used once
 * at connect time (see Aivastra_Connection_Service) and discarded, never
 * persisted. See docs/wordpress-plugin-design.md §4.3.
 */
class Aivastra_Connection_Settings
{
    private const OPTION_KEY = 'aivastra_tryon_settings';

    private function all(): array
    {
        $value = get_option(self::OPTION_KEY, []);
        return is_array($value) ? $value : [];
    }

    public function get_widget_key(): ?string
    {
        return $this->all()['widget_key'] ?? null;
    }

    public function get_company_name(): ?string
    {
        return $this->all()['company_name'] ?? null;
    }

    public function get_credits_as_of(): ?string
    {
        return $this->all()['credits_as_of'] ?? null;
    }

    /**
     * The only write path for a successful connection — sets the widget key
     * and the display snapshot together, in one wp_options write.
     */
    public function set_widget_key_and_snapshot(
        string $widgetKey,
        string $companyName,
        string $creditsAsOf
    ): void {
        update_option(self::OPTION_KEY, [
            'widget_key' => $widgetKey,
            'company_name' => $companyName,
            'credits_as_of' => $creditsAsOf,
        ]);
    }
}
