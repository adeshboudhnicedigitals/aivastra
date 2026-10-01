<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Hooked to woocommerce_single_product_summary — reads product id/title/image
 * directly from the live $product object at render time (no sync/cache
 * problem, unlike Shopify's metafield mirror — see
 * docs/wordpress-plugin-design.md §2). Renders nothing if the merchant has
 * not connected a widget key yet.
 */
class Aivastra_Widget_Loader
{
    // This API_BASE is sent to the BROWSER (via wp_localize_script below) —
    // widget.js runs on the shopper's machine. Production serves the API
    // from the SAME host as the web app, reverse-proxied at /v1/* (see
    // infra/docker-compose.prod.yml) — there is no separate api.aivastra.com.
    // For local development, override this to 'http://localhost:4000'
    // (`pnpm --filter @aivastra/api dev`, port 4000) — `localhost`, NOT
    // `host.docker.internal` (a Docker-internal DNS alias a normal browser
    // can't resolve). Contrast with Aivastra_Settings_Page::API_BASE, which
    // runs server-side inside the container and does need
    // host.docker.internal.
    private const API_BASE = 'https://app.aivastra.com';

    // WooCommerce's own woocommerce_single_product_summary callbacks: 5 =
    // title, 10 = rating, 20 = price, 20 = excerpt (short description; WC
    // core actually also uses 20, template hooks just happen to render title
    // before excerpt), 30 = add to cart. 'before_cart' (25) is the plugin's
    // long-standing default and behaves exactly as it always has; the other
    // two are new, merchant-chosen alternatives from the "Button placement"
    // field in Settings -> Aivastra Try-On -> Try-on button.
    private const PLACEMENT_PRIORITIES = [
        'after_title' => 6,
        'before_cart' => 25,
        'after_cart' => 35,
    ];

    public static function init(): void
    {
        $placement = (new Aivastra_Connection_Settings())->get_widget_customization()['buttonPlacement'];
        $priority = self::PLACEMENT_PRIORITIES[$placement] ?? self::PLACEMENT_PRIORITIES['before_cart'];
        add_action('woocommerce_single_product_summary', [self::class, 'render'], $priority);
    }

    public static function render(): void
    {
        global $product;
        if (!$product instanceof WC_Product) {
            return;
        }

        if (!Aivastra_Product_Toggle::is_enabled($product->get_id())) {
            return;
        }

        $settings = new Aivastra_Connection_Settings();
        $widgetKey = $settings->get_widget_key();
        if ($widgetKey === null) {
            return;
        }

        $imageId = $product->get_image_id();
        $imageUrl = $imageId ? wp_get_attachment_image_url($imageId, 'large') : false;
        $config = Aivastra_Widget_Config::build($product->get_id(), $product->get_name(), $imageUrl);
        $customization = $settings->get_widget_customization();

        // Which try-on workflow runs is chosen server-side (dev_tryon_categories
        // slug -> workflow_templates), never by the plugin — this only resolves
        // WHICH slug to ask for, from the merchant's WooCommerce-category mapping
        // (Settings -> Aivastra Try-On -> Category mapping). A product whose
        // category has no explicit mapping gets no button at all — see
        // Aivastra_Category_Mapping::resolve()'s doc comment for why this used
        // to silently send 'general' and broke generation instead.
        $categoryTermIds = wp_get_post_terms($product->get_id(), 'product_cat', ['fields' => 'ids']);
        $category = Aivastra_Category_Mapping::resolve(
            is_array($categoryTermIds) ? $categoryTermIds : [],
            $settings->get_category_map()
        );
        if ($category === null) {
            return;
        }

        wp_enqueue_style('aivastra-tryon-widget', AIVASTRA_TRYON_URL . 'assets/widget.css', [], AIVASTRA_TRYON_VERSION);
        wp_enqueue_script('aivastra-tryon-widget-logic', AIVASTRA_TRYON_URL . 'assets/widget-logic.js', [], AIVASTRA_TRYON_VERSION, true);
        wp_enqueue_script('aivastra-tryon-widget', AIVASTRA_TRYON_URL . 'assets/widget.js', ['aivastra-tryon-widget-logic'], AIVASTRA_TRYON_VERSION, true);
        wp_localize_script('aivastra-tryon-widget', 'AivastraTryOn', array_merge($config, [
            'widgetKey' => $widgetKey,
            'apiBase' => self::API_BASE,
            'category' => $category,
            // Add to Cart posts to WordPress's own admin-ajax.php, not the
            // Aivastra API — WooCommerce cart state lives here, not on the
            // dev-API. See Aivastra_Cart_Ajax.
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'addToCartNonce' => wp_create_nonce(Aivastra_Cart_Ajax::NONCE_ACTION),
            // Merchant branding from Settings -> Aivastra Try-On -> Widget
            // appearance. widget.js applies accentColor as a CSS custom
            // property at init (the button and the reparented-to-<body>
            // modal are siblings, so an inline style here couldn't cascade
            // to both) and falls back to its own hardcoded copy for any
            // null field. buttonColor/buttonGradient are unrelated — see the
            // inline style below — and don't need to be in this payload at
            // all (widget.js never reads either), but stay here anyway since
            // 'customization' is otherwise a complete, one-shot snapshot of
            // the saved form.
            'customization' => $customization,
        ]));

        // Rendered as an INLINE style, not a class + CSS custom property
        // (unlike accentColor above): a merchant picking a button color is
        // almost always doing it specifically because their theme already
        // has an opinion on #aivastra-tryon-button's background — often
        // with its own `!important` and a selector specific enough (e.g. an
        // id) to out-rank anything this plugin could add in an external
        // stylesheet, at any specificity. An inline `style` attribute is the
        // only origin that reliably wins that fight regardless of the
        // theme's selector, and `!important` here still wins ties against a
        // `!important` rule in any stylesheet, inline always outranks it.
        // A gradient (Aivastra_Widget_Customization::BUTTON_GRADIENTS) always
        // wins over a plain buttonColor when the merchant has picked one —
        // enforced here, not in the admin form, so there's exactly one place
        // that decides precedence. The hover effect (widget.css's
        // [data-aivastra-custom-bg]:hover) is a brightness filter rather than
        // a second computed color specifically so it works unchanged for a
        // gradient background, not just a solid one.
        $buttonBackground = self::resolve_button_background($customization);
        $buttonStyleAttr = $buttonBackground !== null
            ? ' style="background:' . esc_attr($buttonBackground) . ' !important" data-aivastra-custom-bg="1"'
            : '';

        echo '<button type="button" id="aivastra-tryon-button" class="aivastra-tryon-button"' . $buttonStyleAttr . '>' .
            '<svg class="aivastra-button-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' .
            '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>' .
            '</svg>' .
            '<span>Try It On</span>' .
            '</button>';
        echo '<div id="aivastra-tryon-modal" class="aivastra-tryon-modal" hidden></div>';
    }

    /** @param array{buttonColor:?string,buttonGradient:?string,...} $customization */
    private static function resolve_button_background(array $customization): ?string
    {
        $gradientSlug = $customization['buttonGradient'] ?? null;
        if ($gradientSlug !== null && isset(Aivastra_Widget_Customization::BUTTON_GRADIENTS[$gradientSlug])) {
            return Aivastra_Widget_Customization::BUTTON_GRADIENTS[$gradientSlug];
        }
        return $customization['buttonColor'] ?? null;
    }
}
