<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Merchant-editable try-on modal branding — accent color, modal copy, and the
 * add-to-cart/share toggle+labels rendered by assets/widget.js. Mirrors the
 * shape of Shopify's ShopifyWidgetConfigPatch (packages/types/src/widget.ts)
 * so the two platforms stay conceptually aligned, but this is WordPress-only:
 * no backend round-trip, no metafield mirror, stored entirely in wp_options
 * via Aivastra_Connection_Settings. Pure functions only, like
 * Aivastra_Category_Mapping — no wp_options access here.
 */
class Aivastra_Widget_Customization
{
    private const MAX_HEADING = 60;
    private const MAX_SUBHEADING = 160;
    private const MAX_CTA_LABEL = 40;
    private const MAX_BEHAVIOR_LABEL = 30;

    /** @return array{accentColor:?string,heading:?string,subheading:?string,ctaLabel:?string,addToCart:bool,addToCartLabel:?string,share:bool,shareLabel:?string} */
    public static function defaults(): array
    {
        return [
            'accentColor' => null,
            'heading' => null,
            'subheading' => null,
            'ctaLabel' => null,
            'addToCart' => true,
            'addToCartLabel' => null,
            'share' => true,
            'shareLabel' => null,
        ];
    }

    /**
     * Sanitizes raw $_POST['aivastra_widget']-shaped input. A blank or
     * malformed field becomes null (falls back to the widget's built-in
     * default) rather than rejecting the whole form — matches
     * Aivastra_Settings_Page::sanitize_key_input's normalize-don't-reject
     * convention. Checkbox fields are absent from $_POST entirely when
     * unchecked, so their absence here means false, not "leave unchanged" —
     * the caller always persists the full result of this method.
     *
     * @param array<string, mixed> $raw
     * @return array{accentColor:?string,heading:?string,subheading:?string,ctaLabel:?string,addToCart:bool,addToCartLabel:?string,share:bool,shareLabel:?string}
     */
    public static function sanitize(array $raw): array
    {
        return [
            'accentColor' => self::sanitize_hex_color((string) ($raw['accentColor'] ?? '')),
            'heading' => self::sanitize_text((string) ($raw['heading'] ?? ''), self::MAX_HEADING),
            'subheading' => self::sanitize_text((string) ($raw['subheading'] ?? ''), self::MAX_SUBHEADING),
            'ctaLabel' => self::sanitize_text((string) ($raw['ctaLabel'] ?? ''), self::MAX_CTA_LABEL),
            'addToCart' => !empty($raw['addToCart']),
            'addToCartLabel' => self::sanitize_text((string) ($raw['addToCartLabel'] ?? ''), self::MAX_BEHAVIOR_LABEL),
            'share' => !empty($raw['share']),
            'shareLabel' => self::sanitize_text((string) ($raw['shareLabel'] ?? ''), self::MAX_BEHAVIOR_LABEL),
        ];
    }

    private static function sanitize_hex_color(string $raw): ?string
    {
        $trimmed = trim($raw);
        if ($trimmed === '') {
            return null;
        }
        return (bool) preg_match('/^#[0-9a-fA-F]{6}$/', $trimmed) ? strtolower($trimmed) : null;
    }

    private static function sanitize_text(string $raw, int $max): ?string
    {
        $clean = trim(strip_tags($raw));
        if ($clean === '') {
            return null;
        }
        return mb_substr($clean, 0, $max);
    }
}
