<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Native WP Settings API page under Settings → Aivastra Try-On. Two paste
 * fields (full key, widget key) per docs/wordpress-plugin-design.md §4.1/§4.3.
 * The full key is used exactly once on save (Aivastra_Connection_Service),
 * never rendered back into the form, never stored.
 */
class Aivastra_Settings_Page
{
    // Production serves the API from the SAME host as the web app, reverse-
    // proxied at /v1/* (see infra/docker-compose.prod.yml) — there is no
    // separate api.aivastra.com. For local development against
    // `pnpm --filter @aivastra/api dev` (port 4000), override this to
    // 'http://host.docker.internal:4000' — host.docker.internal, not
    // localhost, since this plugin runs inside the WordPress container,
    // which has its own network namespace.
    // Public: Aivastra_Checkout_Ajax (includes/class-checkout-ajax.php) needs
    // the same base URL and has no other way to reach it.
    public const API_BASE = 'https://app.aivastra.com';

    // Two internal short-codes get a friendly rewrite; every other value in
    // $_GET['aivastra_error'] already IS a human-readable message coming
    // straight from Aivastra_Connection_Service (e.g. "The full API key was
    // rejected (HTTP 401).") and is shown as-is.
    private const ERROR_MESSAGES = [
        'invalid_key_format' => 'Please paste both keys — check they match the sk_live_… format exactly.',
        'not_connected' => 'Connect your account before mapping categories.',
    ];

    // Hardcoded, no user data ever passed through — safe to echo raw.
    private const ICONS = [
        'check-circle' => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        'refresh' => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
        'key' => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
        'log-out' => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
        'chevron' => '<svg class="aivastra-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
        'link' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 7h3a5 5 0 0 1 0 10h-3m-6 0H6a5 5 0 0 1 0-10h3"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
        'credit-card' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
        'palette' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a10 10 0 1 1 0-20 8 8 0 0 1 8 8c0 1.7-1.3 3-3 3h-2a2 2 0 0 0 0 4h.5a2.5 2.5 0 0 1 0 5z"/><circle cx="7.5" cy="10.5" r="1.4"/><circle cx="12" cy="7" r="1.4"/><circle cx="16.5" cy="10.5" r="1.4"/></svg>',
        'tag' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
        'bar-chart' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
        'life-buoy' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="14.83" y1="9.17" x2="18.36" y2="5.64"/><line x1="9.17" y1="9.17" x2="5.64" y2="5.64"/><line x1="14.83" y1="14.83" x2="18.36" y2="18.36"/><line x1="9.17" y1="14.83" x2="5.64" y2="18.36"/></svg>',
        'rocket' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>',
        'building' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 9h.01M9 13h.01M9 17h.01M14 9h.01M14 13h.01M14 17h.01"/></svg>',
        'check-plain' => '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
        'arrow-right' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
        'bar-chart-icon' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    ];

    // Per-tile icon/subtext/accent, matched by plan position to
    // TRYON_PLAN_META in apps/catalogues-web/src/app/(app)/pricing/use-pricing-data.ts
    // — GET /v1/dev/plans doesn't return this display metadata, so it's
    // re-declared here to give this admin screen the same look as the
    // consumer pricing page for the same four tiers.
    private const PLAN_META = [
        ['icon' => 'rocket', 'subtext' => 'Perfect for Startups', 'accent' => '#626262', 'checkGrad' => false],
        ['icon' => 'bar-chart-icon', 'subtext' => 'Most Popular Choice', 'accent' => '#209e46', 'checkGrad' => true],
        ['icon' => 'building', 'subtext' => 'Best for Growing Businesses', 'accent' => '#626262', 'checkGrad' => false],
        ['icon' => 'building', 'subtext' => 'Enterprises & High Volume', 'accent' => '#626262', 'checkGrad' => false],
    ];

    // Same static copy as TRYON_FEATURES in use-pricing-data.ts — identical
    // across every try-on plan there, so no per-plan variant is needed here.
    private const PLAN_FEATURES = [
        'Instant Priority Processing',
        'Pay Only for Successful Try-Ons',
        'White Label Integration',
        'Website & Shopify Integration',
        'Standard AI Quality',
    ];

    // Icon shown before each sidebar nav item's label.
    private const NAV_ICONS = [
        'connection' => 'link',
        'plans' => 'credit-card',
        'widget' => 'palette',
        'categories' => 'tag',
        'analytics' => 'bar-chart',
        'support' => 'life-buoy',
    ];

    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'register_menu']);
        add_action('admin_enqueue_scripts', [self::class, 'enqueue_assets']);
        add_action('admin_post_aivastra_tryon_connect', [self::class, 'handle_connect']);
        add_action('admin_post_aivastra_tryon_refresh', [self::class, 'handle_refresh']);
        add_action('admin_post_aivastra_tryon_disconnect', [self::class, 'handle_disconnect']);
        add_action('admin_post_aivastra_tryon_save_category_map', [self::class, 'handle_save_category_map']);
        add_action('admin_post_aivastra_tryon_buy', [self::class, 'handle_buy']);
        add_action('admin_post_aivastra_tryon_save_widget_customization', [self::class, 'handle_save_widget_customization']);
    }

    /**
     * Loads the admin-only stylesheet, scoped to just this settings screen —
     * add_options_page() gives submenus of options-general.php the hook
     * suffix "settings_page_{menu_slug}" (a standard WordPress convention,
     * not specific to this plugin), so this never loads on any other admin
     * screen.
     */
    public static function enqueue_assets(string $hookSuffix): void
    {
        if ($hookSuffix !== 'settings_page_aivastra-tryon') {
            return;
        }
        wp_enqueue_style(
            'aivastra-tryon-settings',
            AIVASTRA_TRYON_URL . 'admin/assets/settings-page.css',
            [],
            AIVASTRA_TRYON_VERSION
        );

        if (!isset($_GET['aivastra_checkout'])) {
            return;
        }
        $order = get_transient('aivastra_tryon_checkout_' . get_current_user_id());
        if ($order === false) {
            return;
        }
        delete_transient('aivastra_tryon_checkout_' . get_current_user_id());

        wp_enqueue_script('razorpay-checkout', 'https://checkout.razorpay.com/v1/checkout.js', [], null, false);
        wp_enqueue_script(
            'aivastra-tryon-checkout',
            AIVASTRA_TRYON_URL . 'admin/assets/checkout.js',
            ['razorpay-checkout'],
            AIVASTRA_TRYON_VERSION,
            true
        );
        wp_localize_script('aivastra-tryon-checkout', 'aivastraCheckout', [
            'order' => $order,
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce(Aivastra_Checkout_Ajax::NONCE_ACTION),
        ]);
    }

    public static function register_menu(): void
    {
        add_options_page(
            'Aivastra Try-On',
            'Aivastra Try-On',
            'manage_woocommerce',
            'aivastra-tryon',
            [self::class, 'render']
        );
    }

    /**
     * Rejects anything not shaped like an aivastra API key. A malformed
     * value is treated the same as "not provided" rather than stored and
     * failing later at connect time with a confusing error.
     */
    public static function sanitize_key_input(string $raw): string
    {
        $trimmed = trim($raw);
        if ($trimmed === '') {
            return '';
        }
        return (bool) preg_match('/^sk_live_[A-Za-z0-9_-]{43}$/', $trimmed) ? $trimmed : '';
    }

    public static function handle_connect(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_connect');

        $fullKey = self::sanitize_key_input((string) ($_POST['aivastra_full_key'] ?? ''));
        $widgetKey = self::sanitize_key_input((string) ($_POST['aivastra_widget_key'] ?? ''));

        $redirectArgs = ['page' => 'aivastra-tryon'];

        if ($fullKey === '' || $widgetKey === '') {
            $redirectArgs['aivastra_error'] = 'invalid_key_format';
        } else {
            $service = new Aivastra_Connection_Service(new Aivastra_Connection_Settings(), self::API_BASE);
            $result = $service->connect($fullKey, $widgetKey);
            $redirectArgs[$result['ok'] ? 'aivastra_connected' : 'aivastra_error'] =
                $result['ok'] ? '1' : ($result['error'] ?? 'unknown');
        }

        wp_safe_redirect(add_query_arg($redirectArgs, admin_url('options-general.php')));
        exit;
    }

    /**
     * Re-reads the credit balance via the stored widget key — a single
     * click, no key to paste, since GET /v1/dev/balance accepts widget-scoped
     * keys.
     */
    public static function handle_refresh(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_refresh');

        $settings = new Aivastra_Connection_Settings();
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $service->refresh();

        $redirectArgs = ['page' => 'aivastra-tryon'];
        $redirectArgs[$result['ok'] ? 'aivastra_refreshed' : 'aivastra_error'] =
            $result['ok'] ? '1' : ($result['error'] ?? 'unknown');

        wp_safe_redirect(add_query_arg($redirectArgs, admin_url('options-general.php')));
        exit;
    }

    /**
     * Wipes the entire connection — widget key, snapshot, and category
     * mapping — via Aivastra_Connection_Settings::clear(). No fields, no
     * confirmation dance beyond WordPress's own nonce check; the button
     * itself is the confirmation.
     */
    public static function handle_disconnect(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_disconnect');

        (new Aivastra_Connection_Settings())->clear();

        wp_safe_redirect(add_query_arg(
            ['page' => 'aivastra-tryon', 'aivastra_disconnected' => '1'],
            admin_url('options-general.php')
        ));
        exit;
    }

    /**
     * Saves the WooCommerce-category -> aivastra-category mapping (see
     * Aivastra_Category_Mapping) that class-widget-loader.php reads to pick a
     * per-product try-on workflow instead of always asking for 'general'.
     * Re-validates against both taxonomies server-side — a stale term ID (a
     * deleted WooCommerce category) or an unknown/inactive aivastra slug must
     * never be persisted, even if that's what the form posted.
     */
    public static function handle_save_category_map(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_save_category_map');

        $settings = new Aivastra_Connection_Settings();
        $widgetKey = $settings->get_widget_key();
        $redirectArgs = ['page' => 'aivastra-tryon', 'section' => 'categories'];

        if ($widgetKey === null) {
            $redirectArgs['aivastra_error'] = 'not_connected';
            wp_safe_redirect(add_query_arg($redirectArgs, admin_url('options-general.php')));
            exit;
        }

        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $service->list_categories($widgetKey);
        $validSlugs = array_map(
            static fn (array $c): string => (string) ($c['slug'] ?? ''),
            $result['categories']
        );

        $terms = get_terms(['taxonomy' => 'product_cat', 'hide_empty' => false, 'fields' => 'ids']);
        $validTermIds = is_wp_error($terms) ? [] : array_map('intval', $terms);

        $rawMap = $_POST['aivastra_category_map'] ?? [];
        $clean = Aivastra_Category_Mapping::sanitize(
            is_array($rawMap) ? $rawMap : [],
            $validTermIds,
            $validSlugs
        );
        $settings->set_category_map($clean);

        $redirectArgs['aivastra_category_map_saved'] = '1';
        wp_safe_redirect(add_query_arg($redirectArgs, admin_url('options-general.php')));
        exit;
    }

    /**
     * Creates a Razorpay order for the selected plan using the stored full
     * key, stashes the (non-secret) order details in a short-lived transient,
     * and redirects back to the settings page, which opens the Razorpay
     * modal automatically (see enqueue_assets()) — mirroring the auto-open
     * pattern already used for the aivastra.com "Buy Now" deep link
     * (docs/superpowers/specs/2026-08-18-pricing-plan-deep-link-design.md).
     */
    public static function handle_buy(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_buy');

        $planSlug = sanitize_key((string) ($_POST['aivastra_plan_slug'] ?? ''));
        $settings = new Aivastra_Connection_Settings();
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $service->create_order($planSlug);

        if (!$result['ok']) {
            wp_safe_redirect(add_query_arg(
                ['page' => 'aivastra-tryon', 'section' => 'plans', 'aivastra_error' => $result['error'] ?? 'unknown'],
                admin_url('options-general.php')
            ));
            exit;
        }

        set_transient('aivastra_tryon_checkout_' . get_current_user_id(), $result, 15 * MINUTE_IN_SECONDS);

        wp_safe_redirect(add_query_arg(
            ['page' => 'aivastra-tryon', 'section' => 'plans', 'aivastra_checkout' => '1'],
            admin_url('options-general.php')
        ));
        exit;
    }

    /**
     * Saves merchant-facing widget branding (accent color, modal copy, and
     * the add-to-cart/share toggle+labels) that Aivastra_Widget_Loader and
     * assets/widget.js consume at render time. Mirrors the shape of
     * Shopify's (unused-by-its-own-embedded-admin) PATCH /v1/shopify/widget-
     * config schema — packages/types/src/widget.ts — so the two platforms
     * stay conceptually aligned, but this is WordPress-only storage: no
     * backend round-trip, no metafield mirror.
     */
    public static function handle_save_widget_customization(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_save_widget_customization');

        $raw = $_POST['aivastra_widget'] ?? [];
        $clean = Aivastra_Widget_Customization::sanitize(is_array($raw) ? $raw : []);
        (new Aivastra_Connection_Settings())->set_widget_customization($clean);

        wp_safe_redirect(add_query_arg(
            ['page' => 'aivastra-tryon', 'section' => 'widget', 'aivastra_widget_saved' => '1'],
            admin_url('options-general.php')
        ));
        exit;
    }

    private static function icon(string $name): string
    {
        return self::ICONS[$name] ?? '';
    }

    /**
     * Section keys valid for the current connection state, in the order the
     * sidebar nav shows them. Connection and Support are always reachable;
     * everything else needs a working connection to have anything to show
     * (each needs the widget or full key to call the API), matching the
     * conditions the old single-page layout gated the same cards on.
     */
    private static function nav_items(bool $connected): array
    {
        $items = ['connection' => 'Connection'];
        if ($connected) {
            $items['plans'] = 'Plans & Credits';
            $items['widget'] = 'Widget Appearance';
            $items['categories'] = 'Category Mapping';
            $items['analytics'] = 'Analytics';
        }
        $items['support'] = 'Support';
        return $items;
    }

    /**
     * Reads $_GET['section'], falling back to 'connection' for a missing,
     * unknown, or (for a not-yet-connected site) connection-only value —
     * e.g. a bookmarked ?section=analytics link from before a disconnect.
     */
    private static function current_section(bool $connected): string
    {
        $requested = isset($_GET['section']) ? sanitize_key((string) $_GET['section']) : 'connection';
        return array_key_exists($requested, self::nav_items($connected)) ? $requested : 'connection';
    }

    private static function render_nav(string $activeSection, bool $connected): void
    {
        ?>
        <nav class="aivastra-settings-nav">
          <?php foreach (self::nav_items($connected) as $key => $label): ?>
            <a
              href="<?php echo esc_url(add_query_arg(['page' => 'aivastra-tryon', 'section' => $key], admin_url('options-general.php'))); ?>"
              class="aivastra-nav-item<?php echo $key === $activeSection ? ' is-active' : ''; ?>"
            >
              <span class="aivastra-nav-icon"><?php echo self::icon(self::NAV_ICONS[$key]); ?></span>
              <?php echo esc_html($label); ?>
            </a>
          <?php endforeach; ?>
        </nav>
        <?php
    }

    /** Small colored icon chip shown before a section's <h2>, echoing the icon used for that section in the sidebar. */
    private static function heading_icon(string $iconName): string
    {
        return '<span class="aivastra-heading-icon">' . self::icon($iconName) . '</span>';
    }

    private static function render_connection_section(Aivastra_Connection_Settings $settings, bool $connected): void
    {
        if (!$connected) {
            ?>
            <div class="aivastra-card aivastra-connect-card">
              <h2 class="aivastra-connect-heading"><?php echo self::heading_icon('link'); ?>Connect your Aivastra account</h2>
              <p class="aivastra-connect-description">Paste two keys from your Aivastra dashboard to enable virtual try-on on your storefront.</p>
              <?php self::render_connect_form(); ?>
            </div>
            <?php
            return;
        }

        $companyName = $settings->get_company_name();
        $credits = $settings->get_credits();
        $creditsAsOf = $settings->get_credits_as_of();
        ?>
        <div class="aivastra-card aivastra-status-card">
          <div class="aivastra-status-top">
            <span class="aivastra-badge aivastra-badge-success">
              <?php echo self::icon('check-circle'); ?>
              Connected
            </span>
            <span class="aivastra-status-company"><?php echo esc_html($companyName); ?></span>
          </div>

          <div class="aivastra-credit-stat">
            <span class="aivastra-credit-number"><?php echo esc_html(number_format_i18n((int) $credits)); ?></span>
            <span class="aivastra-credit-label">credits available</span>
          </div>
          <p class="aivastra-credit-meta">Balance last checked <?php echo esc_html($creditsAsOf ?? 'unknown'); ?></p>

          <div class="aivastra-action-row">
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-refresh-form">
              <input type="hidden" name="action" value="aivastra_tryon_refresh">
              <?php wp_nonce_field('aivastra_tryon_refresh'); ?>
              <button type="submit" class="aivastra-btn aivastra-btn-secondary">
                <?php echo self::icon('refresh'); ?>
                Refresh balance
              </button>
            </form>

            <details class="aivastra-accordion">
              <summary>
                <?php echo self::icon('key'); ?>
                Update connection keys
                <?php echo self::icon('chevron'); ?>
              </summary>
              <div class="aivastra-accordion-body">
                <?php self::render_connect_form(); ?>
              </div>
            </details>
          </div>

          <div class="aivastra-danger-zone">
            <div class="aivastra-danger-copy">
              <strong>Disconnect this site</strong>
              <p>Removes your stored keys and category mapping. The storefront button stops working until you reconnect.</p>
            </div>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
              <input type="hidden" name="action" value="aivastra_tryon_disconnect">
              <?php wp_nonce_field('aivastra_tryon_disconnect'); ?>
              <button type="submit" class="aivastra-btn aivastra-btn-danger-ghost">
                <?php echo self::icon('log-out'); ?>
                Disconnect
              </button>
            </form>
          </div>
        </div>
        <?php
    }

    public static function render(): void
    {
        $settings = new Aivastra_Connection_Settings();
        $connected = $settings->get_company_name() !== null;
        $section = self::current_section($connected);
        ?>
        <div class="wrap aivastra-settings-wrap">
          <div class="aivastra-page-header">
            <h1 class="aivastra-logo-row">
              <img src="<?php echo esc_url(AIVASTRA_TRYON_URL . 'admin/assets/images/logo.svg'); ?>" alt="" class="aivastra-logo-mark">
              <img src="<?php echo esc_url(AIVASTRA_TRYON_URL . 'admin/assets/images/logo-text.svg'); ?>" alt="Aivastra Try-On" class="aivastra-logo-text">
            </h1>
            <p class="aivastra-page-subtitle">Manage the connection powering your storefront's virtual try-on button.</p>
          </div>

          <?php self::render_notices(); ?>

          <div class="aivastra-settings-layout">
            <?php self::render_nav($section, $connected); ?>

            <div class="aivastra-settings-content">
              <?php if ($section === 'connection'): ?>
                <?php self::render_connection_section($settings, $connected); ?>
              <?php elseif ($section === 'plans'): ?>
                <?php self::render_plans($settings); ?>
              <?php elseif ($section === 'widget'): ?>
                <?php self::render_widget_customization($settings); ?>
              <?php elseif ($section === 'categories'): ?>
                <?php self::render_category_mapping($settings); ?>
              <?php elseif ($section === 'analytics'): ?>
                <?php self::render_analytics($settings); ?>
              <?php elseif ($section === 'support'): ?>
                <?php self::render_support(); ?>
              <?php endif; ?>
            </div>
          </div>
        </div>
        <?php
    }

    /**
     * Only shown once connected — GET /v1/dev/analytics needs the stored full
     * key (aggregate business data, unlike balance/plans/categories, which
     * accept the widget key). `cards.tryOns` and the daily bars are real
     * (drawn from the jobs table by apps/api/src/modules/dev/analytics.ts);
     * everything else, including the entire product table, is advisory —
     * client-reported by assets/widget.js and forgeable — which is why the
     * product table is labeled as such instead of implying it is as exact as
     * the top-line try-on count.
     */
    private static function render_analytics(Aivastra_Connection_Settings $settings): void
    {
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $service->get_analytics();
        ?>
        <div class="aivastra-card aivastra-analytics-card">
          <h2 class="aivastra-card-heading"><?php echo self::heading_icon('bar-chart'); ?>Analytics</h2>
          <?php if (!$result['ok']): ?>
            <p class="aivastra-empty-state">Could not load analytics right now — try reloading this page.</p>
          <?php else: ?>
            <p class="aivastra-card-description">Last 30 days. Try-ons are measured on our servers and are exact; everything else is measured in the shopper's browser and can undercount if blocked.</p>

            <div class="aivastra-stat-grid">
              <div class="aivastra-stat-tile">
                <span class="aivastra-stat-label">Try-ons</span>
                <span class="aivastra-stat-value"><?php echo esc_html(number_format_i18n((int) $result['cards']['tryOns'])); ?></span>
              </div>
              <div class="aivastra-stat-tile">
                <span class="aivastra-stat-label">Unique shoppers</span>
                <span class="aivastra-stat-value"><?php echo esc_html(number_format_i18n((int) $result['cards']['uniqueShoppers'])); ?></span>
              </div>
              <div class="aivastra-stat-tile">
                <span class="aivastra-stat-label">Added to cart</span>
                <span class="aivastra-stat-value"><?php echo esc_html(number_format_i18n((int) $result['cards']['addedToCart'])); ?></span>
              </div>
              <div class="aivastra-stat-tile">
                <span class="aivastra-stat-label">Add-to-cart rate</span>
                <span class="aivastra-stat-value"><?php echo esc_html(round(((float) $result['cards']['addToCartRate']) * 100, 1)); ?>%</span>
              </div>
            </div>

            <h3 class="aivastra-analytics-subheading">Try-ons per day (last 14 days)</h3>
            <?php
            $maxDaily = 0;
            foreach ($result['daily'] as $d) {
                $maxDaily = max($maxDaily, (int) $d['tryOns']);
            }
            ?>
            <div class="aivastra-bar-chart">
              <?php foreach ($result['daily'] as $d): ?>
                <?php $pct = $maxDaily > 0 ? max(4, (int) round(((int) $d['tryOns'] / $maxDaily) * 100)) : 0; ?>
                <div class="aivastra-bar-col" title="<?php echo esc_attr($d['day'] . ': ' . $d['tryOns'] . ' try-ons'); ?>">
                  <div class="aivastra-bar-track">
                    <div class="aivastra-bar" style="height: <?php echo esc_attr((string) $pct); ?>%"></div>
                  </div>
                  <span class="aivastra-bar-label"><?php echo esc_html(substr((string) $d['day'], 5)); ?></span>
                </div>
              <?php endforeach; ?>
            </div>

            <?php if (!empty($result['products'])): ?>
              <h3 class="aivastra-analytics-subheading">Products (advisory)</h3>
              <table class="aivastra-analytics-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Views</th>
                    <th>Shoppers</th>
                    <th>Added to cart</th>
                  </tr>
                </thead>
                <tbody>
                  <?php foreach ($result['products'] as $p): ?>
                    <?php $title = get_the_title((int) $p['productId']); ?>
                    <tr>
                      <td><?php echo esc_html($title !== '' ? $title : ('#' . $p['productId'])); ?></td>
                      <td><?php echo esc_html(number_format_i18n((int) $p['tryOns'])); ?></td>
                      <td><?php echo esc_html(number_format_i18n((int) $p['uniqueShoppers'])); ?></td>
                      <td><?php echo esc_html(number_format_i18n((int) $p['addedToCart'])); ?></td>
                    </tr>
                  <?php endforeach; ?>
                </tbody>
              </table>
            <?php endif; ?>
          <?php endif; ?>
        </div>
        <?php
    }

    /**
     * Same two contact channels as the Shopify embedded admin's Support tab
     * (apps/shopify/src/pages/SupportPage.tsx) — static links, no backend of
     * its own, so it's always shown regardless of connection state.
     */
    private static function render_support(): void
    {
        ?>
        <div class="aivastra-card aivastra-support-card">
          <h2 class="aivastra-card-heading"><?php echo self::heading_icon('life-buoy'); ?>Support</h2>
          <p class="aivastra-card-description">Two ways to reach the team.</p>
          <div class="aivastra-support-banner">
            Live chat is the fastest option during business hours. Email is answered within 24 hours the rest of the time.
          </div>
          <div class="aivastra-support-grid">
            <div class="aivastra-support-channel">
              <h3 class="aivastra-support-channel-title">Email support</h3>
              <p class="aivastra-support-channel-body">Send us the details and we usually reply within 24 hours.</p>
              <a href="mailto:support@aivastra.com" class="aivastra-btn aivastra-btn-secondary">Email us</a>
            </div>
            <div class="aivastra-support-channel">
              <h3 class="aivastra-support-channel-title">Live chat</h3>
              <p class="aivastra-support-channel-body">Talk to the team in real time during business hours.</p>
              <a href="https://app.aivastra.com/support" target="_blank" rel="noopener noreferrer" class="aivastra-btn aivastra-btn-secondary">Start a chat</a>
            </div>
          </div>
        </div>
        <?php
    }

    /** Shared by the not-connected default view and the "Update connection keys" reveal. */
    private static function render_connect_form(): void
    {
        ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-form aivastra-connect-form">
          <input type="hidden" name="action" value="aivastra_tryon_connect">
          <?php wp_nonce_field('aivastra_tryon_connect'); ?>
          <div class="aivastra-step">
            <span class="aivastra-step-number">1</span>
            <div class="aivastra-step-body">
              <label for="aivastra_full_key">Full API key</label>
              <p class="aivastra-step-hint">From your aivastra account → API Keys. Verified against your account and stored securely (encrypted) so you can buy credits below without re-entering it.</p>
              <input type="password" id="aivastra_full_key" name="aivastra_full_key" class="aivastra-input" autocomplete="off" placeholder="sk_live_&hellip;">
            </div>
          </div>
          <div class="aivastra-step">
            <span class="aivastra-step-number">2</span>
            <div class="aivastra-step-body">
              <label for="aivastra_widget_key">Widget API key</label>
              <p class="aivastra-step-hint">From "Create WordPress Widget Key" in the same screen. This is the key that powers the storefront button.</p>
              <input type="password" id="aivastra_widget_key" name="aivastra_widget_key" class="aivastra-input" autocomplete="off" placeholder="sk_live_&hellip;">
            </div>
          </div>
          <button type="submit" class="aivastra-btn aivastra-btn-primary aivastra-btn-block">Test connection</button>
        </form>
        <?php
    }

    private static function render_notices(): void
    {
        if (isset($_GET['aivastra_connected'])) {
            self::render_notice('success', 'Connected successfully.');
        }
        if (isset($_GET['aivastra_refreshed'])) {
            self::render_notice('success', 'Balance refreshed.');
        }
        if (isset($_GET['aivastra_disconnected'])) {
            self::render_notice('success', 'Disconnected. All stored settings, including the category mapping, have been cleared.');
        }
        if (isset($_GET['aivastra_category_map_saved'])) {
            self::render_notice('success', 'Category mapping saved.');
        }
        if (isset($_GET['aivastra_widget_saved'])) {
            self::render_notice('success', 'Widget appearance saved.');
        }
        if (isset($_GET['aivastra_error'])) {
            $code = (string) $_GET['aivastra_error'];
            $message = self::ERROR_MESSAGES[$code] ?? $code;
            self::render_notice('error', $message);
        }
    }

    private static function render_notice(string $type, string $message): void
    {
        printf(
            '<div class="notice notice-%s is-dismissible aivastra-notice"><p>%s</p></div>',
            esc_attr($type),
            esc_html($message)
        );
    }

    /**
     * Only shown once connected — plan pricing needs the widget key
     * (GET /v1/dev/plans), and purchasing needs a plan to buy against.
     */
    private static function render_plans(Aivastra_Connection_Settings $settings): void
    {
        $widgetKey = $settings->get_widget_key();
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $widgetKey !== null ? $service->list_plans($widgetKey) : ['ok' => false, 'plans' => []];
        ?>
        <div class="aivastra-card aivastra-plans-card">
          <h2 class="aivastra-card-heading"><?php echo self::heading_icon('credit-card'); ?>Plans &amp; credits</h2>
          <?php if (!$result['ok']): ?>
            <p class="aivastra-empty-state">Could not load plans right now — try reloading this page.</p>
          <?php else: ?>
            <div class="aivastra-plans-grid">
              <?php foreach ($result['plans'] as $idx => $plan): ?>
                <?php
                $meta = self::PLAN_META[$idx] ?? self::PLAN_META[0];
                $highlighted = !empty($plan['isHighlighted']) && !empty($plan['badge']);
                ?>
                <div class="aivastra-plan-outer<?php echo $highlighted ? ' aivastra-plan-outer-highlighted' : ''; ?>">
                  <div class="aivastra-plan-tile<?php echo $highlighted ? ' aivastra-plan-tile-highlighted' : ''; ?>">
                    <?php if ($highlighted): ?>
                      <span class="aivastra-plan-badge">&#9733; <?php echo esc_html($plan['badge']); ?></span>
                    <?php endif; ?>

                    <div class="aivastra-plan-head">
                      <span class="aivastra-plan-icon" style="background: color-mix(in srgb, <?php echo esc_attr($meta['accent']); ?> 14%, transparent); color: <?php echo esc_attr($meta['accent']); ?>;">
                        <?php echo self::icon($meta['icon']); ?>
                      </span>
                      <span class="aivastra-plan-head-text">
                        <span class="aivastra-plan-name"><?php echo esc_html($plan['name']); ?></span>
                        <span class="aivastra-plan-subtext"><?php echo esc_html($meta['subtext']); ?></span>
                      </span>
                    </div>

                    <div class="aivastra-plan-price-row">
                      <span class="aivastra-plan-price-big">&#8377;<?php echo esc_html(number_format_i18n((int) $plan['priceInr'])); ?></span>
                      <?php if (!empty($plan['unitCountLabel'])): ?>
                        <span class="aivastra-plan-unit">/ <?php echo esc_html($plan['unitCountLabel']); ?></span>
                      <?php endif; ?>
                    </div>
                    <p class="aivastra-plan-gst">+ GST &middot; <?php echo esc_html(number_format_i18n((int) $plan['credits'])); ?> credits</p>
                    <?php if (!empty($plan['perUnitPriceLabel'])): ?>
                      <p class="aivastra-plan-per-unit"><?php echo esc_html($plan['perUnitPriceLabel']); ?></p>
                    <?php endif; ?>

                    <div class="aivastra-plan-divider"></div>

                    <div class="aivastra-plan-features">
                      <p class="aivastra-plan-features-heading">Included Features</p>
                      <?php foreach (self::PLAN_FEATURES as $feature): ?>
                        <div class="aivastra-plan-feature-row">
                          <span
                            class="aivastra-plan-feature-check<?php echo $meta['checkGrad'] ? ' is-gradient' : ''; ?>"
                            <?php if (!$meta['checkGrad']): ?>
                              style="background: color-mix(in srgb, <?php echo esc_attr($meta['accent']); ?> 16%, transparent); color: <?php echo esc_attr($meta['accent']); ?>;"
                            <?php endif; ?>
                          ><?php echo self::icon('check-plain'); ?></span>
                          <span class="aivastra-plan-feature-label"><?php echo esc_html($feature); ?></span>
                        </div>
                      <?php endforeach; ?>
                    </div>

                    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-plan-buy-form">
                      <input type="hidden" name="action" value="aivastra_tryon_buy">
                      <input type="hidden" name="aivastra_plan_slug" value="<?php echo esc_attr($plan['slug']); ?>">
                      <?php wp_nonce_field('aivastra_tryon_buy'); ?>
                      <button type="submit" class="aivastra-btn aivastra-plan-buy-btn<?php echo $highlighted ? ' aivastra-btn-catalogue-gradient' : ' aivastra-btn-dark'; ?>">
                        Buy Now
                        <?php echo self::icon('arrow-right'); ?>
                      </button>
                    </form>
                  </div>
                </div>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>
        </div>
        <?php
    }

    /**
     * Only shown once connected, matching Plans/Category mapping — there is
     * no live widget to preview a color/copy change against otherwise.
     * Persisted entirely in wp_options; unlike the Shopify widget-config
     * route, there is no backend round-trip or metafield to keep in sync.
     */
    private static function render_widget_customization(Aivastra_Connection_Settings $settings): void
    {
        $c = $settings->get_widget_customization();
        ?>
        <div class="aivastra-card aivastra-widget-customization-card">
          <h2 class="aivastra-card-heading"><?php echo self::heading_icon('palette'); ?>Widget appearance</h2>
          <p class="aivastra-card-description">Customize the colors and copy shoppers see in the try-on button and modal. Leave a field blank to use the default.</p>
          <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-form aivastra-widget-form">
            <input type="hidden" name="action" value="aivastra_tryon_save_widget_customization">
            <?php wp_nonce_field('aivastra_tryon_save_widget_customization'); ?>

            <div class="aivastra-field-row">
              <label for="aivastra_widget_accent_color">Accent color</label>
              <input type="color" id="aivastra_widget_accent_color" name="aivastra_widget[accentColor]" class="aivastra-color-input" value="<?php echo esc_attr($c['accentColor'] ?? '#6366f1'); ?>">
            </div>

            <div class="aivastra-field-row">
              <label for="aivastra_widget_heading">Modal heading</label>
              <input type="text" id="aivastra_widget_heading" name="aivastra_widget[heading]" class="aivastra-input" maxlength="60" placeholder="Virtual Try-On" value="<?php echo esc_attr($c['heading'] ?? ''); ?>">
            </div>

            <div class="aivastra-field-row">
              <label for="aivastra_widget_subheading">Modal subheading</label>
              <input type="text" id="aivastra_widget_subheading" name="aivastra_widget[subheading]" class="aivastra-input" maxlength="160" placeholder="Upload a full-body photo to see how it looks on you." value="<?php echo esc_attr($c['subheading'] ?? ''); ?>">
            </div>

            <div class="aivastra-field-row">
              <label for="aivastra_widget_cta">Generate button label</label>
              <input type="text" id="aivastra_widget_cta" name="aivastra_widget[ctaLabel]" class="aivastra-input" maxlength="40" placeholder="Generate Try-On" value="<?php echo esc_attr($c['ctaLabel'] ?? ''); ?>">
            </div>

            <div class="aivastra-field-row aivastra-field-row-checkbox">
              <label for="aivastra_widget_add_to_cart">
                <input type="checkbox" id="aivastra_widget_add_to_cart" name="aivastra_widget[addToCart]" value="1" <?php checked($c['addToCart']); ?>>
                Show "Add to Cart" on the result
              </label>
              <input type="text" id="aivastra_widget_add_to_cart_label" name="aivastra_widget[addToCartLabel]" class="aivastra-input aivastra-input-inline" maxlength="30" placeholder="Add to Cart" value="<?php echo esc_attr($c['addToCartLabel'] ?? ''); ?>">
            </div>

            <div class="aivastra-field-row aivastra-field-row-checkbox">
              <label for="aivastra_widget_share">
                <input type="checkbox" id="aivastra_widget_share" name="aivastra_widget[share]" value="1" <?php checked($c['share']); ?>>
                Show "Share" on the result
              </label>
              <input type="text" id="aivastra_widget_share_label" name="aivastra_widget[shareLabel]" class="aivastra-input aivastra-input-inline" maxlength="30" placeholder="Share" value="<?php echo esc_attr($c['shareLabel'] ?? ''); ?>">
            </div>

            <button type="submit" class="aivastra-btn aivastra-btn-primary">Save appearance</button>
          </form>
        </div>
        <?php
    }

    /**
     * Only shown once connected — a widget key is required to list the
     * merchant's aivastra categories (GET /v1/dev/categories).
     */
    private static function render_category_mapping(Aivastra_Connection_Settings $settings): void
    {
        $widgetKey = $settings->get_widget_key();
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $widgetKey !== null ? $service->list_categories($widgetKey) : ['ok' => false, 'categories' => []];

        $terms = get_terms(['taxonomy' => 'product_cat', 'hide_empty' => false]);
        $productCategories = is_wp_error($terms) ? [] : $terms;
        $currentMap = $settings->get_category_map();
        ?>
        <div class="aivastra-card aivastra-category-card">
          <h2 class="aivastra-card-heading"><?php echo self::heading_icon('tag'); ?>Try-on category mapping</h2>
          <?php if (!$result['ok']): ?>
            <p class="aivastra-empty-state">Could not load your aivastra categories right now — try reloading this page.</p>
          <?php elseif (empty($result['categories'])): ?>
            <p class="aivastra-empty-state">No active try-on categories are configured on your aivastra account yet. Every product will use the <code>general</code> category until one exists.</p>
          <?php elseif (empty($productCategories)): ?>
            <p class="aivastra-empty-state">No WooCommerce product categories found — every product uses the <code>general</code> try-on category.</p>
          <?php else: ?>
            <p class="aivastra-card-description">Pick which aivastra try-on workflow applies to each WooCommerce product category. A category left as "Default" falls back to <code>general</code>.</p>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-form">
              <input type="hidden" name="action" value="aivastra_tryon_save_category_map">
              <?php wp_nonce_field('aivastra_tryon_save_category_map'); ?>
              <div class="aivastra-mapping-list">
                <?php foreach ($productCategories as $term): ?>
                  <div class="aivastra-mapping-row">
                    <label for="aivastra-cat-map-<?php echo esc_attr($term->term_id); ?>" class="aivastra-mapping-label"><?php echo esc_html($term->name); ?></label>
                    <select id="aivastra-cat-map-<?php echo esc_attr($term->term_id); ?>" name="aivastra_category_map[<?php echo esc_attr($term->term_id); ?>]" class="aivastra-select">
                      <option value="">Default (general)</option>
                      <?php foreach ($result['categories'] as $cat): ?>
                        <option value="<?php echo esc_attr($cat['slug']); ?>" <?php selected($currentMap[$term->term_id] ?? '', $cat['slug']); ?>>
                          <?php echo esc_html($cat['name']); ?>
                        </option>
                      <?php endforeach; ?>
                    </select>
                  </div>
                <?php endforeach; ?>
              </div>
              <button type="submit" class="aivastra-btn aivastra-btn-primary">Save category mapping</button>
            </form>
          <?php endif; ?>
        </div>
        <?php
    }
}
