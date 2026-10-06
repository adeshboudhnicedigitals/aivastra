<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * The ONLY class that touches the plugin's wp_options row. Persists the
 * full-scoped API key (encrypted via Aivastra_Crypto) so the "Plans &
 * Credits" purchase flow can create a Razorpay order without asking the
 * merchant to re-paste it every time — see
 * docs/superpowers/specs/2026-08-31-wordpress-plugin-credit-purchase-design.md.
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

    /**
     * Decrypts and returns the stored full key, or null if never connected.
     * Used only by Aivastra_Connection_Service::create_order() — every other
     * call in the plugin uses the widget key.
     */
    public function get_full_key(): ?string
    {
        $encrypted = $this->all()['full_key'] ?? null;
        return is_string($encrypted) ? Aivastra_Crypto::decrypt($encrypted) : null;
    }

    public function get_company_name(): ?string
    {
        return $this->all()['company_name'] ?? null;
    }

    public function get_credits_as_of(): ?string
    {
        return $this->all()['credits_as_of'] ?? null;
    }

    /** @return array<int, string> WooCommerce product_cat term_id => aivastra category slug. */
    public function get_category_map(): array
    {
        $map = $this->all()['category_map'] ?? [];
        return is_array($map) ? $map : [];
    }

    /** @param array<int, string> $map */
    public function set_category_map(array $map): void
    {
        $all = $this->all();
        $all['category_map'] = $map;
        update_option(self::OPTION_KEY, $all);
    }

    public function get_credits(): ?int
    {
        return $this->all()['credits'] ?? null;
    }

    /**
     * True once a connect/refresh/payment round trip has told this plugin
     * the merchant's Ai Vastra user has a currently-active unlimited plan
     * (DevMeResponse/DevBalanceResponse's own `unlimited` field,
     * packages/types/src/dev.ts) — a date-ranged plan where try-ons aren't
     * metered against the credit balance at all. render_connection_section()
     * shows "Unlimited" instead of the numeric credits/try-ons-remaining
     * fields when this is true; get_credits() is still whatever the
     * underlying balance happens to be and isn't meaningful on its own in
     * that case. Defaults false for any row saved before this field existed.
     */
    public function get_unlimited(): bool
    {
        return (bool) ($this->all()['unlimited'] ?? false);
    }

    /**
     * Merged with Aivastra_Widget_Customization::defaults() so a field never
     * present in an older saved row (or never saved at all) still resolves to
     * a usable value instead of null-vs-missing ambiguity.
     *
     * @return array{accentColor:?string,buttonColor:?string,buttonGradient:?string,heading:?string,subheading:?string,ctaLabel:?string,addToCart:bool,addToCartLabel:?string,share:bool,shareLabel:?string,buttonPlacement:?string}
     */
    public function get_widget_customization(): array
    {
        $stored = $this->all()['widget_customization'] ?? null;
        return array_merge(
            Aivastra_Widget_Customization::defaults(),
            is_array($stored) ? $stored : []
        );
    }

    /** @param array{accentColor:?string,buttonColor:?string,buttonGradient:?string,heading:?string,subheading:?string,ctaLabel:?string,addToCart:bool,addToCartLabel:?string,share:bool,shareLabel:?string,buttonPlacement:?string} $customization */
    public function set_widget_customization(array $customization): void
    {
        $all = $this->all();
        $all['widget_customization'] = $customization;
        update_option(self::OPTION_KEY, $all);
    }

    /**
     * The only write path for a successful connection — sets the widget key,
     * the encrypted full key, and the display snapshot together, in one
     * wp_options write.
     */
    public function set_widget_key_and_snapshot(
        string $widgetKey,
        string $fullKey,
        string $companyName,
        int $credits,
        string $creditsAsOf,
        bool $unlimited = false
    ): void {
        update_option(self::OPTION_KEY, [
            'widget_key' => $widgetKey,
            'full_key' => Aivastra_Crypto::encrypt($fullKey),
            'company_name' => $companyName,
            'credits' => $credits,
            'credits_as_of' => $creditsAsOf,
            'unlimited' => $unlimited,
        ]);
    }

    /**
     * Updates only the credit balance and its timestamp — deliberately
     * leaves widget_key, company_name, and category_map untouched. Used by
     * the "Refresh balance" action, which reads GET /v1/dev/balance with the
     * already-stored widget key and so never needs to re-verify identity.
     *
     * $unlimited: null (the default) leaves the stored flag untouched — used
     * by callers (verify_payment()) whose own API response doesn't carry an
     * `unlimited` field, so a payment can't accidentally flip it back off. A
     * caller that does have a fresh value (refresh()) passes it explicitly.
     */
    public function update_credits(int $credits, string $creditsAsOf, ?bool $unlimited = null): void
    {
        $all = $this->all();
        $all['credits'] = $credits;
        $all['credits_as_of'] = $creditsAsOf;
        if ($unlimited !== null) {
            $all['unlimited'] = $unlimited;
        }
        update_option(self::OPTION_KEY, $all);
    }

    /**
     * Wipes the entire stored option — widget key, snapshot, AND the category
     * mapping. A fresh connect afterward could be a different aivastra
     * account with an entirely different set of categories, so a stale
     * mapping must not survive a disconnect.
     */
    public function clear(): void
    {
        delete_option(self::OPTION_KEY);
    }
}
