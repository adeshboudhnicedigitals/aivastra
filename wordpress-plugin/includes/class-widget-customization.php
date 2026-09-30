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

    /**
     * Aivastra_Widget_Loader::PLACEMENT_PRIORITIES has the matching WooCommerce
     * hook priority for each of these — kept there, not here, since only that
     * class needs to know what a priority number means.
     */
    public const BUTTON_PLACEMENTS = ['before_cart', 'after_title', 'after_cart'];

    /**
     * Curated, fixed set — never free-text CSS. Two reasons: this value ends
     * up in an inline `style` attribute on the storefront (see
     * Aivastra_Widget_Loader::render()), so accepting arbitrary strings here
     * would be an injection surface; and a small hand-picked set looks
     * deliberate on a product page, where an arbitrary two-color picker tends
     * to produce muddy or clashing results. 'aivastra' matches this plugin's
     * own admin nav/logo gradient (admin/assets/settings-page.css's
     * --aivastra-gradient) — same stops, so a merchant who wants "the
     * Aivastra look" on their button gets exactly that, not a coincidence.
     */
    public const BUTTON_GRADIENTS = [
        'sunset' => 'linear-gradient(135deg, #f97316, #ec4899)',
        'ocean' => 'linear-gradient(135deg, #0ea5e9, #6366f1)',
        'violet' => 'linear-gradient(135deg, #8b5cf6, #d946ef)',
        'emerald' => 'linear-gradient(135deg, #10b981, #0ea5e9)',
        'aivastra' => 'linear-gradient(135deg, #d946ef 0%, #6366f1 45%, #22d3ee 75%, #fb923c 100%)',
    ];

    /** @return array{accentColor:?string,buttonColor:?string,buttonGradient:?string,heading:?string,subheading:?string,ctaLabel:?string,addToCart:bool,addToCartLabel:?string,share:bool,shareLabel:?string,buttonPlacement:?string} */
    public static function defaults(): array
    {
        return [
            // Popup-only — see Aivastra_Widget_Loader's doc comment on why the
            // on-page trigger button never read this despite living in the
            // same form.
            'accentColor' => null,
            // The on-page trigger button's own solid background. Deliberately
            // a separate field from accentColor, not a fallback for it: many
            // merchants want the popup's soft indigo defaults untouched but
            // need the button itself to match their storefront's brand
            // color/theme, which is exactly the color a theme's own CSS is
            // most likely to already be fighting over (see
            // Aivastra_Widget_Loader::render()'s doc comment).
            'buttonColor' => null,
            // Takes precedence over buttonColor when set — see
            // Aivastra_Widget_Loader::render(). One or the other, never both
            // painted at once.
            'buttonGradient' => null,
            'heading' => null,
            'subheading' => null,
            'ctaLabel' => null,
            'addToCart' => true,
            'addToCartLabel' => null,
            'share' => true,
            'shareLabel' => null,
            // null => Aivastra_Widget_Loader's own default ('before_cart'),
            // same normalize-don't-force-a-resave convention as every other
            // field here.
            'buttonPlacement' => null,
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
     * @return array{accentColor:?string,buttonColor:?string,buttonGradient:?string,heading:?string,subheading:?string,ctaLabel:?string,addToCart:bool,addToCartLabel:?string,share:bool,shareLabel:?string,buttonPlacement:?string}
     */
    public static function sanitize(array $raw): array
    {
        return [
            'accentColor' => self::sanitize_hex_color((string) ($raw['accentColor'] ?? '')),
            'buttonColor' => self::sanitize_hex_color((string) ($raw['buttonColor'] ?? '')),
            'buttonGradient' => self::sanitize_enum((string) ($raw['buttonGradient'] ?? ''), array_keys(self::BUTTON_GRADIENTS)),
            'heading' => self::sanitize_text((string) ($raw['heading'] ?? ''), self::MAX_HEADING),
            'subheading' => self::sanitize_text((string) ($raw['subheading'] ?? ''), self::MAX_SUBHEADING),
            'ctaLabel' => self::sanitize_text((string) ($raw['ctaLabel'] ?? ''), self::MAX_CTA_LABEL),
            'addToCart' => !empty($raw['addToCart']),
            'addToCartLabel' => self::sanitize_text((string) ($raw['addToCartLabel'] ?? ''), self::MAX_BEHAVIOR_LABEL),
            'share' => !empty($raw['share']),
            'shareLabel' => self::sanitize_text((string) ($raw['shareLabel'] ?? ''), self::MAX_BEHAVIOR_LABEL),
            'buttonPlacement' => self::sanitize_enum((string) ($raw['buttonPlacement'] ?? ''), self::BUTTON_PLACEMENTS),
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

    /** @param array<int, string> $allowed */
    private static function sanitize_enum(string $raw, array $allowed): ?string
    {
        $trimmed = trim($raw);
        return in_array($trimmed, $allowed, true) ? $trimmed : null;
    }
}
