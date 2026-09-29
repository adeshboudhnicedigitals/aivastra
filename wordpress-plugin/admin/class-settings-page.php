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
    // `pnpm --filter @aivastra/api dev` (port 4000), override this to reach
    // the host from inside the WordPress container (its own network
    // namespace, not localhost). `host.docker.internal` only resolves if
    // local-wp's compose file sets `extra_hosts: host.docker.internal:
    // host-gateway` — it doesn't here (Docker Desktop adds it automatically;
    // plain Docker Engine on Linux doesn't). Verified working alternative:
    // the docker bridge gateway IP, e.g. 'http://172.19.0.1:4000' — get the
    // actual value via `docker network inspect local-wp_default` (or `docker
    // inspect local-wp-wordpress-1 --format '{{json .NetworkSettings.Networks}}'`),
    // it can differ per machine/network recreation.
    // Public: Aivastra_Checkout_Ajax (includes/class-checkout-ajax.php) needs
    // the same base URL and has no other way to reach it.
    public const API_BASE = 'https://app.aivastra.com';

    // Production chatbot endpoint: path-proxied under the SAME host as
    // API_BASE at /chatbot (docker-compose.prod.yml's own comment claims a
    // chatbot.aivastra.com subdomain, but that was never actually
    // provisioned — see docs/progress.md's chatbot CORS/URL fix entry. Use
    // this path, not a subdomain.) Deliberately NOT derived from API_BASE
    // (`self::API_BASE . '/chatbot'`) even though they match in production —
    // API_BASE is read by PHP running inside the WordPress container
    // (needs host.docker.internal locally), while this constant is only
    // ever handed to browser JS via wp_localize_script (needs a URL the
    // browser on the HOST machine can reach) — the two diverge in local
    // dev. For local development against `pnpm --filter @aivastra/chatbot
    // dev` (port 4200), override this to 'http://localhost:4200'.
    public const CHATBOT_BASE = 'https://app.aivastra.com/chatbot';

    // Set once a merchant finishes or skips the onboarding wizard's Step 2
    // (categories/funnels — render_onboarding_categories()), so the bare page
    // URL stops showing that step and goes straight to the dashboard.
    // Deleted by uninstall.php alongside the rest of the plugin's options.
    private const ONBOARDING_DONE_OPTION_KEY = 'aivastra_tryon_onboarding_done';

    // Step labels for the onboarding wizard's progress row, in order — read
    // by render_progress_steps() so every step's number and the total stay
    // in sync with this one list.
    private const ONBOARDING_STEPS = ['Connect account', 'Categories & Funnels'];

    // Two internal short-codes get a friendly rewrite; every other value in
    // $_GET['aivastra_error'] already IS a human-readable message coming
    // straight from Aivastra_Connection_Service (e.g. "The full API key was
    // rejected (HTTP 401).") and is shown as-is.
    private const ERROR_MESSAGES = [
        'invalid_key_format' => 'Please paste both keys — check they match the sk_live_… format exactly.',
        'not_connected' => 'Connect your account before setting up categories.',
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
        'grid' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
    ];

    // Per-tile icon/subtext/accent, matched by plan position to
    // TRYON_PLAN_META in apps/catalogues-web/src/app/(app)/pricing/use-pricing-data.ts
    // — GET /v1/dev/plans doesn't return this display metadata, so it's
    // re-declared here to give this admin screen the same look as the
    // consumer pricing page for the same four tiers.
    //
    // `name` is a WordPress-only display label, at the merchant's request —
    // GET /v1/dev/plans's own `name`/`slug`/price/credits/badge stay exactly
    // as the API returns them (unchanged here, unchanged in the app and
    // Shopify); only the heading text shown on this card is swapped, same
    // positional match as the rest of this array. If the account ever has
    // more than four active plans, render_plans() falls back to the plan's
    // real API name for the extra ones rather than mislabelling them.
    private const PLAN_META = [
        ['name' => 'Silver', 'icon' => 'rocket', 'subtext' => 'Great for getting started', 'accent' => '#626262', 'checkGrad' => false],
        ['name' => 'Gold', 'icon' => 'bar-chart-icon', 'subtext' => 'Most popular', 'accent' => '#209e46', 'checkGrad' => true],
        ['name' => 'Platinum', 'icon' => 'building', 'subtext' => 'For growing stores', 'accent' => '#626262', 'checkGrad' => false],
        ['name' => 'Diamond', 'icon' => 'building', 'subtext' => 'For stores with high traffic', 'accent' => '#626262', 'checkGrad' => false],
    ];

    // Same static copy as TRYON_FEATURES in use-pricing-data.ts — identical
    // across every try-on plan there, so no per-plan variant is needed here.
    private const PLAN_FEATURES = [
        'Faster processing, ahead of the queue',
        'Only pay for try-ons that work',
        'No Aivastra branding shown to shoppers',
        'Works on your website and Shopify store',
        'Standard AI quality',
    ];

    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'register_menu']);
        add_action('admin_init', [self::class, 'redirect_legacy_url']);
        add_action('admin_head', [self::class, 'print_menu_icon_style']);
        add_action('admin_enqueue_scripts', [self::class, 'enqueue_assets']);
        add_action('admin_post_aivastra_tryon_connect', [self::class, 'handle_connect']);
        add_action('admin_post_aivastra_tryon_disconnect', [self::class, 'handle_disconnect']);
        add_action('admin_post_aivastra_tryon_save_category_map', [self::class, 'handle_save_category_map']);
        add_action('admin_post_aivastra_tryon_skip_onboarding', [self::class, 'handle_skip_onboarding']);
        add_action('admin_post_aivastra_tryon_buy', [self::class, 'handle_buy']);
        add_action('admin_post_aivastra_tryon_save_widget_customization', [self::class, 'handle_save_widget_customization']);
    }

    /**
     * Loads the admin-only stylesheet, scoped to just this settings screen —
     * add_menu_page() gives a top-level page the hook suffix
     * "toplevel_page_{menu_slug}" (a standard WordPress convention, not
     * specific to this plugin), so this never loads on any other admin
     * screen.
     */
    public static function enqueue_assets(string $hookSuffix): void
    {
        if ($hookSuffix !== 'toplevel_page_aivastra-tryon') {
            return;
        }
        wp_enqueue_style(
            'aivastra-tryon-settings',
            AIVASTRA_TRYON_URL . 'admin/assets/settings-page.css',
            [],
            AIVASTRA_TRYON_VERSION
        );
        wp_enqueue_script(
            'aivastra-tryon-select',
            AIVASTRA_TRYON_URL . 'admin/assets/select.js',
            [],
            AIVASTRA_TRYON_VERSION,
            true
        );
        wp_enqueue_script(
            'aivastra-tryon-support-chat',
            AIVASTRA_TRYON_URL . 'admin/assets/support-chat.js',
            [],
            AIVASTRA_TRYON_VERSION,
            true
        );
        wp_localize_script('aivastra-tryon-support-chat', 'aivastraSupportChat', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce(Aivastra_Support_Ajax::NONCE_ACTION),
            'chatbotBase' => self::CHATBOT_BASE,
        ]);
        wp_enqueue_script(
            'aivastra-tryon-refresh-balance',
            AIVASTRA_TRYON_URL . 'admin/assets/refresh-balance.js',
            [],
            AIVASTRA_TRYON_VERSION,
            true
        );
        // The nonce itself travels on the button's own data-nonce attribute
        // (render_connection_section()), not here — only the AJAX URL is the
        // same on every load.
        wp_localize_script('aivastra-tryon-refresh-balance', 'aivastraRefreshBalance', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
        ]);

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

    /**
     * A top-level sidebar item rather than a Settings submenu, so merchants
     * find it without opening Settings. Position 56.1 sits just after
     * WooCommerce's own block (WooCommerce 55.5, Products 56); the decimal
     * avoids colliding with another plugin claiming a whole-number slot,
     * which would silently replace one of the two entries.
     */
    public static function register_menu(): void
    {
        add_menu_page(
            'Ai Vastra Try-On',
            'Ai Vastra',
            'manage_woocommerce',
            'aivastra-tryon',
            [self::class, 'render'],
            self::menu_icon(),
            56.1
        );
    }

    /**
     * The Ai Vastra mark as a base64 data URI. It must be a data URI (not a
     * file URL) and single-colour: WordPress's svg-painter only recolours
     * base64 SVGs, rewriting every fill to the admin colour scheme's icon
     * colour so it matches the core menu icons in every state. logo.svg's
     * gradient fills would be flattened the same way anyway, so
     * menu-icon.svg is a flat copy of its paths, padded to a square viewBox
     * so the 20px menu slot doesn't squash it.
     */
    /**
     * Core draws every data-URI menu icon at `background-size: 20px auto`.
     * The mark is much wider than tall, so at 20px wide it's only ~14px high
     * and looks undersized next to the square dashicons. 24px wide (~16px
     * high) matches their visual weight and still fits the 36px icon column
     * when the menu is folded. Printed on every admin screen because the
     * sidebar is — the settings-page.css bundle only loads on our own page.
     */
    public static function print_menu_icon_style(): void
    {
        echo '<style>#adminmenu #toplevel_page_aivastra-tryon div.wp-menu-image.svg{background-size:24px auto}</style>';
    }

    private static function menu_icon(): string
    {
        $svg = file_get_contents(AIVASTRA_TRYON_DIR . 'admin/assets/images/menu-icon.svg');
        return $svg === false
            ? 'dashicons-camera'
            : 'data:image/svg+xml;base64,' . base64_encode($svg);
    }

    /**
     * The page lived under Settings (options-general.php?page=aivastra-tryon)
     * before it became a top-level menu item. Existing bookmarks still point
     * there — WordPress would answer those with "Sorry, you are not
     * allowed to access this page", so forward them to the new location with
     * the rest of the query string intact.
     */
    public static function redirect_legacy_url(): void
    {
        global $pagenow;
        if ($pagenow !== 'options-general.php' || ($_GET['page'] ?? '') !== 'aivastra-tryon') {
            return;
        }
        wp_safe_redirect(add_query_arg(wp_unslash($_GET), admin_url('admin.php')));
        exit;
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

        wp_safe_redirect(add_query_arg($redirectArgs, admin_url('admin.php')));
        exit;
    }

    // "Refresh balance" is now AJAX (Aivastra_Refresh_Ajax, admin/assets/refresh-balance.js)
    // — a full-page admin-post.php round trip landed the merchant back on the
    // page with a dismissible WP admin notice, which on the one-page
    // dashboard core's own common.js relocates to right after the first
    // <h1> (the app header's logo row), wedging "Balance refreshed."
    // between the logo and the version pill. AJAX updates the credit number
    // in place with a small confirmation next to it instead.

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
            admin_url('admin.php')
        ));
        exit;
    }

    /**
     * Saves the WooCommerce-category -> aivastra-category mapping (see
     * Aivastra_Category_Mapping) that class-widget-loader.php reads to pick a
     * per-product try-on workflow — an unmapped category gets no button at
     * all (Aivastra_Category_Mapping::resolve()'s doc comment).
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
            wp_safe_redirect(add_query_arg($redirectArgs, admin_url('admin.php')));
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
        // Reachable from the regular dashboard's Categories tab too, long after
        // onboarding — an extra write of an already-'1' option there is harmless.
        update_option(self::ONBOARDING_DONE_OPTION_KEY, '1', false);

        $redirectArgs['aivastra_category_map_saved'] = '1';
        wp_safe_redirect(add_query_arg($redirectArgs, admin_url('admin.php')));
        exit;
    }

    /**
     * "Skip for now" on the onboarding wizard's Step 2 — a merchant who isn't
     * ready to map categories yet needs a way off this step without being
     * forced to open every dropdown first. The button simply won't show on
     * any product until they come back and map at least one category.
     */
    public static function handle_skip_onboarding(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_skip_onboarding');

        update_option(self::ONBOARDING_DONE_OPTION_KEY, '1', false);

        wp_safe_redirect(add_query_arg(['page' => 'aivastra-tryon', 'section' => 'connection'], admin_url('admin.php')));
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
                admin_url('admin.php')
            ));
            exit;
        }

        set_transient('aivastra_tryon_checkout_' . get_current_user_id(), $result, 15 * MINUTE_IN_SECONDS);

        wp_safe_redirect(add_query_arg(
            ['page' => 'aivastra-tryon', 'section' => 'plans', 'aivastra_checkout' => '1'],
            admin_url('admin.php')
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
            admin_url('admin.php')
        ));
        exit;
    }

    private static function icon(string $name): string
    {
        return self::ICONS[$name] ?? '';
    }

    /** Small colored icon chip shown before a section's <h2>, matching that section's icon elsewhere on the page. */
    private static function heading_icon(string $iconName): string
    {
        return '<span class="aivastra-heading-icon">' . self::icon($iconName) . '</span>';
    }

    /**
     * @param ?array<int, array{day:string,tryOns:int}> $dailyRows Passed
     *   straight through to Aivastra_Connection_Service::get_balance_summary()
     *   — see that method's doc comment. Unused when $connected is false.
     */
    private static function render_connection_section(Aivastra_Connection_Settings $settings, bool $connected, ?array $dailyRows = null): void
    {
        if (!$connected) {
            ?>
            <div class="aivastra-card aivastra-connect-card">
              <h2 class="aivastra-connect-heading"><?php echo self::heading_icon('link'); ?>Connect your Ai Vastra account</h2>
              <p class="aivastra-connect-description">Paste two keys from your Ai Vastra dashboard to get started.</p>
              <?php self::render_connect_form(); ?>
            </div>
            <?php
            return;
        }

        $companyName = $settings->get_company_name();
        $credits = $settings->get_credits();
        $creditsAsOf = $settings->get_credits_as_of();

        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $balanceSummary = $service->get_balance_summary($dailyRows);
        $tryOnsRemaining = $balanceSummary['ok'] ? $balanceSummary['tryOnsRemaining'] : null;
        $daysRemaining = $balanceSummary['ok'] ? $balanceSummary['daysRemaining'] : null;
        ?>
        <div class="aivastra-card aivastra-status-card">
          <?php // No card heading — the badge below already says what this card is; only caller left with $connected=true is render_dashboard(), which gives the whole page its own "Dashboard" context. ?>
          <div class="aivastra-status-top">
            <span class="aivastra-badge aivastra-badge-success">
              <?php echo self::icon('check-circle'); ?>
              Connected
            </span>

            <?php // User tag + Disconnect stacked in the corner — Disconnect used to sit in the action row below with Refresh/Update keys, but a destructive action reads clearer next to whose account it disconnects than lined up beside two harmless ones. ?>
            <div class="aivastra-status-corner">
              <span class="aivastra-status-company"><span class="aivastra-status-company-tag">User:</span> <?php echo esc_html($companyName); ?></span>
              <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="aivastra_tryon_disconnect">
                <?php wp_nonce_field('aivastra_tryon_disconnect'); ?>
                <button type="submit" class="aivastra-btn aivastra-btn-danger-ghost aivastra-btn-sm">
                  <?php echo self::icon('log-out'); ?>
                  Disconnect
                </button>
              </form>
            </div>
          </div>

          <p class="aivastra-balance-label">Current balance</p>
          <div class="aivastra-credit-stat">
            <span class="aivastra-credit-number" id="aivastra-credit-number"><?php echo esc_html(number_format_i18n((int) $credits)); ?></span>
            <span class="aivastra-credit-label">credits</span>
            <?php // Filled in by refresh-balance.js on a successful refresh; empty and invisible (no reserved layout space — see the CSS) until then. ?>
            <span class="aivastra-refresh-confirm" id="aivastra-refresh-confirm" aria-live="polite"></span>
          </div>
          <?php // tryOnsRemaining/daysRemaining are real (get_balance_summary()) — a Aivastra_Connection_Service::get_balance_summary() error (stale connection, API hiccup) is the only time this falls back to the plain last-checked timestamp, same text this line always showed before. ?>
          <p class="aivastra-credit-meta" id="aivastra-credit-meta">
            <?php if ($tryOnsRemaining !== null): ?>
              About <?php echo esc_html(number_format_i18n($tryOnsRemaining)); ?> try-on<?php echo $tryOnsRemaining === 1 ? '' : 's'; ?> remaining<?php if ($daysRemaining !== null): ?> &mdash; roughly <?php echo esc_html(number_format_i18n($daysRemaining)); ?> day<?php echo $daysRemaining === 1 ? '' : 's'; ?> at your current rate<?php endif; ?>
            <?php else: ?>
              Balance last checked <?php echo esc_html($creditsAsOf ?? 'unknown'); ?>
            <?php endif; ?>
          </p>

          <div class="aivastra-action-row">
            <?php // AJAX (Aivastra_Refresh_Ajax) — see the comment where handle_refresh() used to be, above handle_disconnect(). ?>
            <button
              type="button"
              id="aivastra-refresh-balance"
              class="aivastra-btn aivastra-btn-secondary"
              data-nonce="<?php echo esc_attr(wp_create_nonce(Aivastra_Refresh_Ajax::NONCE_ACTION)); ?>"
            >
              <span class="aivastra-refresh-icon"><?php echo self::icon('refresh'); ?></span>
              Refresh balance
            </button>

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
        </div>
        <?php
    }

    /**
     * No persisted "dismissed" flag: the welcome page is purely a function of
     * connection state plus whether the merchant has already navigated past
     * it in this visit. Bookmarking or reopening the plain ?page=aivastra-tryon
     * URL while not connected always lands back on the welcome page — it's
     * the site's actual home state, not a one-time tutorial — while Continue
     * (a plain link to ?section=connection, not a form submit) moves forward
     * within the same visit, and the connect step's topbar links back to it
     * (render_onboarding_connect()). Once connected, the welcome page never
     * shows again.
     */
    public static function should_show_intro(bool $connected): bool
    {
        return !$connected && !isset($_GET['section']);
    }

    /**
     * Step 2 of the wizard (render_onboarding_categories()) — same "no
     * section in the URL" escape hatch as should_show_intro(), but it can't
     * use should_show_intro()'s other trick of deriving "done" from state:
     * an empty category map is a legitimate permanent choice (the button
     * just doesn't show anywhere yet), not an unfinished step, so unlike the
     * welcome page this needs an explicit, persisted "done" flag — set by
     * either saving a mapping (handle_save_category_map()) or skipping
     * (handle_skip_onboarding()).
     */
    public static function should_show_categories_step(bool $connected): bool
    {
        return $connected && !isset($_GET['section']) && get_option(self::ONBOARDING_DONE_OPTION_KEY) !== '1';
    }

    public static function render(): void
    {
        $settings = new Aivastra_Connection_Settings();
        $connected = $settings->get_company_name() !== null;
        if (self::should_show_intro($connected)) {
            self::render_intro();
            return;
        }
        if (!$connected) {
            self::render_onboarding_connect($settings);
            return;
        }
        if (self::should_show_categories_step($connected)) {
            self::render_onboarding_categories($settings);
            return;
        }
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-dashboard-wrap">
          <div class="aivastra-shell">
            <div class="aivastra-shell-scroll">
              <?php self::render_app_header(); ?>

              <?php self::render_notices(); ?>

              <?php self::render_dashboard($settings); ?>
            </div>
          </div>

          <?php self::render_chat_modal(); ?>
        </div>
        <?php
    }

    /**
     * The connected dashboard's persistent chrome, above render_dashboard()'s
     * one long page — logo, plugin version, and a Support entry point,
     * echoing the always-visible navbar of the reference dashboard the page
     * below it was modelled on. Get Support reuses the same dropdown idiom
     * as the onboarding topbar's (render_onboarding_topbar()); the help icon
     * links to the same developer docs render_connect_form()'s "Get your
     * API keys" link does.
     */
    private static function render_app_header(): void
    {
        ?>
        <div class="aivastra-page-header aivastra-app-header">
          <div class="aivastra-app-header-left">
            <h1 class="aivastra-logo-row">
              <img src="<?php echo esc_url(AIVASTRA_TRYON_URL . 'admin/assets/images/logo.svg'); ?>" alt="" class="aivastra-logo-mark">
              <img src="<?php echo esc_url(AIVASTRA_TRYON_URL . 'admin/assets/images/logo-text.svg'); ?>" alt="Ai Vastra Try-On" class="aivastra-logo-text">
            </h1>
            <span class="aivastra-version-pill">v<?php echo esc_html(AIVASTRA_TRYON_VERSION); ?></span>
          </div>

          <div class="aivastra-app-header-right">
            <details class="aivastra-topbar-support">
              <summary class="aivastra-app-header-support-trigger">
                <?php echo self::icon('life-buoy'); ?>
                Get Support
              </summary>
              <div class="aivastra-topbar-support-menu">
                <a href="mailto:support@aivastra.com" class="aivastra-topbar-support-item">Email us</a>
                <button type="button" class="aivastra-topbar-support-item aivastra-start-chat-trigger">Start a chat</button>
              </div>
            </details>
            <a
              href="<?php echo esc_url(self::API_BASE . '/developers'); ?>"
              target="_blank"
              rel="noopener noreferrer"
              class="aivastra-app-header-help"
              aria-label="Help and documentation"
              title="Help and documentation"
            >
              <?php echo self::lucide('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>', 18); ?>
            </a>
          </div>
        </div>
        <?php
    }

    /**
     * The entire connected experience, one page, no sidebar — replaces the
     * old Connection/Plans/Try-On Button/Categories/Analytics/Support tabs
     * (render_nav(), removed) at the merchant's request: everything the
     * tabs held is still here, just stacked on one scroll instead of gated
     * behind a click, in this order: Connection, Plans & Credits, an
     * Activity summary (stat tiles, chart, Top Products — purpose-built,
     * modelled on a reference WordPress plugin dashboard the merchant
     * supplied screenshots of), then Try-On Button, Categories and Support.
     * Everything except the Activity summary reuses each old tab's render
     * method completely unchanged — same forms, same save handlers, same
     * data — just called in sequence instead of behind a section switch.
     *
     * Every number in the Activity summary is real, from the same GET
     * /v1/dev/analytics call the old Analytics tab used
     * (Aivastra_Connection_Service::get_analytics()'s doc comment has the
     * exact server-exact-vs-advisory breakdown) — which is also why there's
     * no separate "Analytics" section: its cards, chart and products table
     * are exactly this summary, so repeating it lower on the same page
     * would just be the same numbers twice. Two things the reference
     * dashboard has that this one deliberately doesn't: a custom date-range
     * picker — the dev API's analytics endpoint takes no date-range
     * parameter, its windows are fixed server-side, so a picker here would
     * be a control wired to nothing — and a per-event "recent activity" feed
     * with a content-type filter — the API returns aggregates only (daily
     * totals, a per-product table), never individual events, so there is
     * nothing to filter or list one row per event.
     */
    private static function render_dashboard(Aivastra_Connection_Settings $settings): void
    {
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $service->get_analytics();
        $credits = $settings->get_credits();
        ?>
        <div class="aivastra-dashboard">
          <?php // No "Dashboard" heading (the page it's on already says so) and no "Last 30 days" period pill — the merchant asked for both to be dropped. ?>
          <?php // $result's own `daily` rows (fetched above for the Try-On Activity chart) double as get_balance_summary()'s days-remaining input, so the Current balance card doesn't make its own second GET /v1/dev/analytics call. ?>
          <?php self::render_connection_section($settings, true, $result['ok'] ? $result['daily'] : null); ?>
          <?php self::render_plans($settings); ?>

          <?php if (!$result['ok']): ?>
            <p class="aivastra-empty-state">Could not load your dashboard data right now — try reloading this page.</p>
          <?php else: ?>
            <div class="aivastra-dashboard-stats">
              <div class="aivastra-dashboard-stat">
                <span class="aivastra-dashboard-stat-icon aivastra-dashboard-stat-icon--tryons">
                  <?php echo self::lucide('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>', 20); ?>
                </span>
                <span class="aivastra-dashboard-stat-label">Virtual Try-Ons</span>
                <span class="aivastra-dashboard-stat-value"><?php echo esc_html(number_format_i18n((int) $result['cards']['tryOns'])); ?></span>
              </div>
              <div class="aivastra-dashboard-stat">
                <span class="aivastra-dashboard-stat-icon aivastra-dashboard-stat-icon--shoppers">
                  <?php echo self::lucide('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', 20); ?>
                </span>
                <span class="aivastra-dashboard-stat-label">Unique Shoppers</span>
                <span class="aivastra-dashboard-stat-value"><?php echo esc_html(number_format_i18n((int) $result['cards']['uniqueShoppers'])); ?></span>
              </div>
              <div class="aivastra-dashboard-stat">
                <span class="aivastra-dashboard-stat-icon aivastra-dashboard-stat-icon--cart">
                  <?php echo self::icon('credit-card'); ?>
                </span>
                <span class="aivastra-dashboard-stat-label">Added to Cart</span>
                <span class="aivastra-dashboard-stat-value"><?php echo esc_html(number_format_i18n((int) $result['cards']['addedToCart'])); ?></span>
              </div>
              <div class="aivastra-dashboard-stat">
                <span class="aivastra-dashboard-stat-icon aivastra-dashboard-stat-icon--rate">
                  <?php echo self::icon('bar-chart'); ?>
                </span>
                <span class="aivastra-dashboard-stat-label">Add-to-Cart Rate</span>
                <span class="aivastra-dashboard-stat-value"><?php echo esc_html(round(((float) $result['cards']['addToCartRate']) * 100, 1)); ?>%</span>
              </div>
              <div class="aivastra-dashboard-stat">
                <span class="aivastra-dashboard-stat-icon aivastra-dashboard-stat-icon--credits">
                  <?php echo self::lucide('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>', 20); ?>
                </span>
                <span class="aivastra-dashboard-stat-label">Credits Available</span>
                <span class="aivastra-dashboard-stat-value"><?php echo $credits !== null ? esc_html(number_format_i18n($credits)) : '—'; ?></span>
              </div>
            </div>

            <div class="aivastra-card aivastra-dashboard-chart-card">
              <div class="aivastra-dashboard-chart-header">
                <h3>Try-On Activity</h3>
                <span class="aivastra-dashboard-legend"><span class="aivastra-dashboard-legend-dot"></span>Try-Ons per day</span>
              </div>
              <?php
              $maxDaily = 0;
              foreach ($result['daily'] as $d) {
                  $maxDaily = max($maxDaily, (int) $d['tryOns']);
              }
              ?>
              <div class="aivastra-bar-chart aivastra-dashboard-bar-chart">
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
            </div>

            <div class="aivastra-card aivastra-dashboard-products-card">
              <h3>Top Products</h3>
              <?php if (empty($result['products'])): ?>
                <p class="aivastra-empty-state">No product activity yet.</p>
              <?php else: ?>
                <table class="aivastra-analytics-table">
                  <thead>
                    <tr><th>Product</th><th>Try-ons</th><th>Shoppers</th><th>Added to cart</th></tr>
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
            </div>
          <?php endif; ?>

          <?php // Rest of the old sidebar tabs, unchanged, now stacked on this one page instead of behind a click. ?>
          <?php self::render_widget_customization($settings); ?>
          <?php self::render_category_mapping($settings); ?>
          <?php self::render_support(); ?>
        </div>
        <?php
    }

    /**
     * Lucide glyph (ISC licence, https://lucide.dev) — same 24px grid and 2px
     * round stroke as Lucide's own components. Inner markup is hardcoded
     * below, never user data, so it's safe to echo raw.
     */
    private static function lucide(string $inner, int $size): string
    {
        return '<svg width="' . $size . '" height="' . $size . '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . $inner . '</svg>';
    }

    /**
     * The first-run welcome page — a port of the Shopify app's
     * apps/shopify/src/pages/OnboardingIntroPage.tsx (same copy, the same
     * three photos, same card + connector layout), so a merchant sees the
     * same introduction on either platform. Replaces the whole settings
     * screen, header and nav included, until Continue is clicked; see
     * should_show_intro().
     */
    private static function render_intro(): void
    {
        $images = AIVASTRA_TRYON_URL . 'admin/assets/images/';
        // Card glyphs are 18px (not 22) so each caption stays on one line.
        $cards = [
            [
                'image' => 'welcome-person.jpg',
                'width' => 1080,
                'height' => 1440,
                'alt' => "A customer's own photo",
                'icon' => self::lucide('<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>', 18),
                'title' => 'Customer Photo',
                'caption' => "Your customer's image",
            ],
            [
                'image' => 'welcome-garment.jpg',
                'width' => 1080,
                'height' => 1438,
                'alt' => 'A product photo from the store',
                'icon' => self::lucide('<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>', 18),
                'title' => 'Your Garment Image',
                'caption' => 'From your store',
            ],
            [
                'image' => 'welcome-result.jpg',
                'width' => 1080,
                'height' => 1440,
                'alt' => 'The customer wearing the product',
                'icon' => self::lucide('<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>', 18),
                'title' => 'Virtual Try-On',
                'caption' => 'Realistic results in seconds',
            ],
        ];
        $benefits = [
            // Three bars rising left to right, so it reads as "growth".
            ['icon' => self::lucide('<path d="M5 21v-6"/><path d="M12 21V9"/><path d="M19 21V3"/>', 20), 'text' => 'Increase conversions'],
            ['icon' => self::lucide('<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>', 20), 'text' => 'Reduce returns'],
            ['icon' => self::lucide('<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>', 20), 'text' => 'Build customer confidence'],
        ];
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-intro-wrap">
          <?php // Screen-reader heading; WordPress also moves admin notices to just after the first h1/h2 in .wrap. ?>
          <h1 class="screen-reader-text">Welcome to Ai Vastra Try-On</h1>
          <div class="aivastra-intro">
            <div class="aivastra-intro-body">
              <div class="aivastra-intro-logo">
                <img src="<?php echo esc_url($images . 'logo.svg'); ?>" alt="" class="aivastra-intro-logo-mark">
                <img src="<?php echo esc_url($images . 'logo-text.svg'); ?>" alt="AI Vastra" class="aivastra-intro-logo-text">
              </div>

              <div class="aivastra-intro-copy">
                <h2 class="aivastra-intro-title">Let your customers see themselves in your garments.</h2>
                <p class="aivastra-intro-subtitle">Help customers see how the dress suits them, increasing sales and reducing returns.</p>
              </div>

              <div class="aivastra-intro-cards">
                <?php foreach ($cards as $index => $card): ?>
                  <?php if ($index > 0): ?>
                    <div class="aivastra-intro-connector" aria-hidden="true">
                      <span class="aivastra-intro-circle aivastra-intro-circle--connector">
                        <?php if ($index === 1): ?>
                          <?php echo self::lucide('<path d="M5 12h14"/><path d="M12 5v14"/>', 20); ?>
                        <?php else: ?>
                          <span class="aivastra-intro-equals"><span></span><span></span></span>
                        <?php endif; ?>
                      </span>
                    </div>
                  <?php endif; ?>
                  <div class="aivastra-intro-card">
                    <img
                      src="<?php echo esc_url($images . $card['image']); ?>"
                      alt="<?php echo esc_attr($card['alt']); ?>"
                      width="<?php echo (int) $card['width']; ?>"
                      height="<?php echo (int) $card['height']; ?>"
                      decoding="async"
                      class="aivastra-intro-photo"
                    >
                    <div class="aivastra-intro-card-caption">
                      <span class="aivastra-intro-circle aivastra-intro-circle--card"><?php echo $card['icon']; ?></span>
                      <div>
                        <p class="aivastra-intro-card-title"><?php echo esc_html($card['title']); ?></p>
                        <p class="aivastra-intro-card-text"><?php echo esc_html($card['caption']); ?></p>
                      </div>
                    </div>
                  </div>
                <?php endforeach; ?>
              </div>

              <ul class="aivastra-intro-benefits">
                <?php foreach ($benefits as $benefit): ?>
                  <li>
                    <span class="aivastra-intro-circle aivastra-intro-circle--benefit"><?php echo $benefit['icon']; ?></span>
                    <span><?php echo esc_html($benefit['text']); ?></span>
                  </li>
                <?php endforeach; ?>
              </ul>
            </div>

            <div class="aivastra-intro-footer">
              <a
                href="<?php echo esc_url(add_query_arg(['page' => 'aivastra-tryon', 'section' => 'connection'], admin_url('admin.php'))); ?>"
                class="aivastra-intro-continue"
              >Continue</a>
            </div>
          </div>
        </div>
        <?php
    }

    /**
     * The topbar shared by every onboarding wizard step (render_onboarding_connect(),
     * render_onboarding_categories()): logo on the left, optionally preceded
     * by Back; Support — there's no sidebar on these steps to hold it, same
     * as the rest of the connected dashboard now (render_dashboard()) — as a
     * dropdown on the right, so it stays reachable before there's anything
     * else on the page.
     *
     * @param ?string $backUrl Where Back goes, or null to omit it. Step 1
     *   passes the welcome page (should_show_intro()'s doc comment: plain
     *   navigation, nothing to unwind); step 2 passes the dashboard, with
     *   ?section set only to satisfy should_show_categories_step()'s own
     *   escape hatch — connecting itself is a one-way action, not a form to
     *   revisit, but a merchant who connected the wrong account needs a way
     *   back to fix it, and the dashboard's own Connection card (render_dashboard())
     *   is where that happens now.
     */
    private static function render_onboarding_topbar(?string $backUrl = null): void
    {
        ?>
        <div class="aivastra-topbar">
          <div class="aivastra-topbar-left">
            <?php if ($backUrl !== null): ?>
              <a href="<?php echo esc_url($backUrl); ?>" class="aivastra-topbar-back">
                <?php echo self::lucide('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>', 16); ?>
                <span>Back</span>
              </a>
              <span class="aivastra-topbar-divider" aria-hidden="true"></span>
            <?php endif; ?>
            <div class="aivastra-logo-row">
              <img src="<?php echo esc_url(AIVASTRA_TRYON_URL . 'admin/assets/images/logo.svg'); ?>" alt="" class="aivastra-logo-mark">
              <img src="<?php echo esc_url(AIVASTRA_TRYON_URL . 'admin/assets/images/logo-text.svg'); ?>" alt="Ai Vastra" class="aivastra-logo-text">
            </div>
          </div>

          <?php // A native <details> menu, same idiom as the "Update connection keys" accordion elsewhere on this page — support-chat.js adds the outside-click/Escape close a floating menu needs on top of it. ?>
          <details class="aivastra-topbar-support">
            <summary class="aivastra-topbar-support-trigger">
              <?php echo self::icon('life-buoy'); ?>
              Support
            </summary>
            <div class="aivastra-topbar-support-menu">
              <a href="mailto:support@aivastra.com" class="aivastra-topbar-support-item">Email us</a>
              <button type="button" class="aivastra-topbar-support-item aivastra-start-chat-trigger">Start a chat</button>
            </div>
          </details>
        </div>
        <?php
    }

    /**
     * Numbered progress row shared by every onboarding step — same visual
     * language as the Shopify app's own OnboardingSteps.tsx: a filled circle
     * and connecting line for every step up to and including the current
     * one, an outlined circle and grey line for steps not reached yet. Reads
     * off ONBOARDING_STEPS so a page's step number and total always match
     * that list instead of being hand-rolled per page.
     */
    private static function render_progress_steps(int $current): void
    {
        $total = count(self::ONBOARDING_STEPS);
        ?>
        <ol class="aivastra-progress-steps" aria-label="Getting started, step <?php echo (int) $current; ?> of <?php echo (int) $total; ?>">
          <?php foreach (self::ONBOARDING_STEPS as $index => $label): ?>
            <?php $step = $index + 1; $reached = $step <= $current; ?>
            <?php if ($index > 0): ?>
              <li class="aivastra-progress-connector<?php echo $reached ? ' is-reached' : ''; ?>" aria-hidden="true"></li>
            <?php endif; ?>
            <li
              class="aivastra-progress-step<?php echo $reached ? ' is-reached' : ''; ?><?php echo $step === $current ? ' is-current' : ''; ?>"
              <?php echo $step === $current ? 'aria-current="step"' : ''; ?>
            >
              <span class="aivastra-progress-circle"><?php echo (int) $step; ?></span>
              <span class="aivastra-progress-label"><?php echo esc_html($label); ?></span>
            </li>
          <?php endforeach; ?>
        </ol>
        <?php
    }

    /**
     * The not-yet-connected experience: step 1 of the onboarding wizard
     * rather than the tabbed settings screen connected merchants get — see
     * ONBOARDING_STEPS, render_progress_steps() and render_onboarding_topbar().
     */
    private static function render_onboarding_connect(Aivastra_Connection_Settings $settings): void
    {
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-onboarding-wrap">
          <div class="aivastra-shell">
            <?php self::render_onboarding_topbar(admin_url('admin.php?page=aivastra-tryon')); ?>

            <div class="aivastra-shell-scroll">
              <?php self::render_progress_steps(1); ?>

              <?php self::render_notices(); ?>

              <div class="aivastra-onboarding-body">
                <?php self::render_connection_section($settings, false); ?>
              </div>
            </div>
          </div>

          <?php self::render_chat_modal(); ?>
        </div>
        <?php
    }

    /**
     * Step 2 of the onboarding wizard: map WooCommerce categories to Ai
     * Vastra try-on categories right after connecting, rather than leaving
     * the Try-On button hidden on every product until a merchant finds the
     * Categories tab on their own. Reuses render_category_mapping()'s own
     * card unchanged — same form, same save handler, same table.
     *
     * Heading and intro copy are the Shopify app's own step 2 text, verbatim
     * (apps/shopify/src/pages/OnboardingProductsPage.tsx's `heading` prop and
     * its Card's description), with only "product" swapped for "category" in
     * the second sentence — factual, not stylistic: what that page calls
     * assigning each PRODUCT a "funnel" (shopify_funnel_templates /
     * shopify_funnel_rules, a per-product routing table this plugin has no
     * equivalent of — see CLAUDE.md's Shopify surface section) this plugin
     * does per CATEGORY instead, via Aivastra_Category_Mapping::resolve().
     * There's no separate "funnel" step to add; this single step already is
     * this plugin's version of it.
     */
    private static function render_onboarding_categories(Aivastra_Connection_Settings $settings): void
    {
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-onboarding-wrap">
          <div class="aivastra-shell">
            <?php self::render_onboarding_topbar(admin_url('admin.php?page=aivastra-tryon&section=connection')); ?>

            <div class="aivastra-shell-scroll">
              <?php self::render_progress_steps(2); ?>

              <div class="aivastra-onboarding-heading">
                <h2>Describe Your Garment type for Accurate Virtual Try-On Results</h2>
                <p>Choose the garment type, such as Upper Wear or Single-Piece Dress, for each category to ensure accurate virtual try-on results.</p>
              </div>

              <?php self::render_notices(); ?>

              <div class="aivastra-onboarding-body">
                <?php self::render_category_mapping($settings); ?>
              </div>

              <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-onboarding-skip">
                <input type="hidden" name="action" value="aivastra_tryon_skip_onboarding">
                <?php wp_nonce_field('aivastra_tryon_skip_onboarding'); ?>
                <button type="submit" class="aivastra-onboarding-skip-link">Skip for now</button>
              </form>
            </div>
          </div>

          <?php self::render_chat_modal(); ?>
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
              <h3 class="aivastra-analytics-subheading">Products (estimated)</h3>
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
          <div class="aivastra-support-grid">
            <div class="aivastra-support-channel">
              <h3 class="aivastra-support-channel-title">Email support</h3>
              <p class="aivastra-support-channel-body">Send us the details and we usually reply within 24 hours.</p>
              <a href="mailto:support@aivastra.com" class="aivastra-btn aivastra-btn-secondary">Email us</a>
            </div>
            <div class="aivastra-support-channel">
              <h3 class="aivastra-support-channel-title">Live chat</h3>
              <p class="aivastra-support-channel-body">Talk to the team in real time during business hours.</p>
              <button type="button" class="aivastra-btn aivastra-btn-secondary aivastra-start-chat-trigger">Start a chat</button>
            </div>
          </div>
        </div>
        <?php
        // No render_chat_modal() call here — the connected dashboard's app
        // header (render()) already mounts one on every tab, this card's
        // own .aivastra-start-chat-trigger button opens that same instance.
    }

    /**
     * The live-chat modal markup — mounted once per page, never per trigger.
     * support-chat.js wires up every .aivastra-start-chat-trigger button on
     * the page (the app header's "Get Support", this Support tab's own
     * card, the onboarding topbar's dropdown) to whichever single instance
     * of this modal that page rendered.
     */
    private static function render_chat_modal(): void
    {
        ?>
        <div id="aivastra-chat-modal" class="aivastra-chat-modal" hidden aria-hidden="true">
          <div class="aivastra-chat-modal__backdrop" data-aivastra-chat-close></div>
          <div class="aivastra-chat-modal__panel" role="dialog" aria-modal="true" aria-label="Live chat">
            <div class="aivastra-chat-modal__header">
              <span class="aivastra-chat-modal__title">Ai Vastra Support</span>
              <span class="aivastra-chat-modal__status" id="aivastra-chat-status">Connecting…</span>
              <button type="button" class="aivastra-chat-modal__close" data-aivastra-chat-close aria-label="Close chat">&times;</button>
            </div>
            <div class="aivastra-chat-modal__error" id="aivastra-chat-error" hidden></div>
            <div class="aivastra-chat-modal__messages" id="aivastra-chat-messages"></div>
            <form class="aivastra-chat-modal__composer" id="aivastra-chat-composer">
              <input type="text" id="aivastra-chat-input" placeholder="Type a message…" autocomplete="off" />
              <button type="submit" class="aivastra-btn aivastra-btn-primary">Send</button>
            </form>
          </div>
        </div>
        <?php
    }

    /**
     * Shared by the not-connected default view and the "Update connection keys"
     * reveal. The banner above the form points a fresh marketplace install
     * (no aivastra account yet) or an existing merchant who's forgotten where
     * keys live at the web app — the plugin never mints an account or a key
     * itself (docs/wordpress-plugin-design.md §4.1).
     */
    private static function render_connect_form(): void
    {
        ?>
        <div class="aivastra-onboarding-banner">
          <p class="aivastra-onboarding-banner-text">You&rsquo;ll need two keys from your Ai Vastra account to connect your store:</p>
          <div class="aivastra-onboarding-links">
            <a href="<?php echo esc_url(self::API_BASE . '/register?src=wordpress_plugin'); ?>" target="_blank" rel="noopener noreferrer" class="aivastra-btn aivastra-btn-primary">Create a free account &rarr;</a>
            <a href="<?php echo esc_url(self::API_BASE . '/developers'); ?>" target="_blank" rel="noopener noreferrer" class="aivastra-btn aivastra-btn-ghost">Already have an account? Get your API keys &rarr;</a>
          </div>
        </div>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-form aivastra-connect-form">
          <input type="hidden" name="action" value="aivastra_tryon_connect">
          <?php wp_nonce_field('aivastra_tryon_connect'); ?>
          <div class="aivastra-step">
            <span class="aivastra-step-number">1</span>
            <div class="aivastra-step-body">
              <label for="aivastra_full_key">Full API key</label>
              <p class="aivastra-step-hint">We check it against your account and store it securely (encrypted), so you won&rsquo;t need to re-enter it when buying credits.</p>
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
        if (isset($_GET['aivastra_disconnected'])) {
            self::render_notice('success', 'Disconnected. All stored settings, including your saved categories, have been cleared.');
        }
        if (isset($_GET['aivastra_category_map_saved'])) {
            self::render_notice('success', 'Categories saved.');
        }
        if (isset($_GET['aivastra_widget_saved'])) {
            self::render_notice('success', 'Try-on button settings saved.');
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
                // Styling (icon/subtext/accent) cycles from the top if there are ever
                // more than four plans; the display name does not — past our four
                // known tiers, mislabelling a 5th plan "Silver" again would be worse
                // than just showing its real API name.
                $meta = self::PLAN_META[$idx] ?? self::PLAN_META[0];
                $displayName = self::PLAN_META[$idx]['name'] ?? $plan['name'];
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
                        <span class="aivastra-plan-name"><?php echo esc_html($displayName); ?></span>
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
                      <p class="aivastra-plan-features-heading">What's included</p>
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
                        Buy credits
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
          <h2 class="aivastra-card-heading"><?php echo self::heading_icon('palette'); ?>Try-on button</h2>
          <p class="aivastra-card-description">Customize the colors and text shoppers see in the try-on button and popup. Leave a field blank to use the default.</p>
          <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-form aivastra-widget-form">
            <input type="hidden" name="action" value="aivastra_tryon_save_widget_customization">
            <?php wp_nonce_field('aivastra_tryon_save_widget_customization'); ?>

            <div class="aivastra-field-row">
              <label for="aivastra_widget_accent_color">Accent color</label>
              <input type="color" id="aivastra_widget_accent_color" name="aivastra_widget[accentColor]" class="aivastra-color-input" value="<?php echo esc_attr($c['accentColor'] ?? '#6366f1'); ?>">
            </div>

            <div class="aivastra-field-row">
              <label for="aivastra_widget_heading">Popup heading</label>
              <input type="text" id="aivastra_widget_heading" name="aivastra_widget[heading]" class="aivastra-input" maxlength="60" placeholder="Virtual Try-On" value="<?php echo esc_attr($c['heading'] ?? ''); ?>">
            </div>

            <div class="aivastra-field-row">
              <label for="aivastra_widget_subheading">Popup subheading</label>
              <input type="text" id="aivastra_widget_subheading" name="aivastra_widget[subheading]" class="aivastra-input" maxlength="160" placeholder="Upload a full-body photo to see how it looks on you." value="<?php echo esc_attr($c['subheading'] ?? ''); ?>">
            </div>

            <div class="aivastra-field-row">
              <label for="aivastra_widget_cta">Generate button label</label>
              <input type="text" id="aivastra_widget_cta" name="aivastra_widget[ctaLabel]" class="aivastra-input" maxlength="40" placeholder="Generate Try-On" value="<?php echo esc_attr($c['ctaLabel'] ?? ''); ?>">
            </div>

            <div class="aivastra-field-row aivastra-field-row-checkbox">
              <label for="aivastra_widget_add_to_cart">
                <input type="checkbox" id="aivastra_widget_add_to_cart" name="aivastra_widget[addToCart]" value="1" class="aivastra-checkbox" <?php checked($c['addToCart']); ?>>
                Show "Add to Cart" on the result
              </label>
              <input type="text" id="aivastra_widget_add_to_cart_label" name="aivastra_widget[addToCartLabel]" class="aivastra-input aivastra-input-inline" maxlength="30" placeholder="Add to Cart" value="<?php echo esc_attr($c['addToCartLabel'] ?? ''); ?>">
            </div>

            <div class="aivastra-field-row aivastra-field-row-checkbox">
              <label for="aivastra_widget_share">
                <input type="checkbox" id="aivastra_widget_share" name="aivastra_widget[share]" value="1" class="aivastra-checkbox" <?php checked($c['share']); ?>>
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
          <h2 class="aivastra-card-heading"><?php echo self::heading_icon('tag'); ?>Categories</h2>
          <?php if (!$result['ok']): ?>
            <p class="aivastra-empty-state">Could not load your Ai Vastra categories right now — try reloading this page.</p>
          <?php elseif (empty($result['categories'])): ?>
            <p class="aivastra-empty-state">You don't have any try-on categories set up on your Ai Vastra account yet. The Try-On button won't show on any product until you add one and map it below.</p>
          <?php elseif (empty($productCategories)): ?>
            <p class="aivastra-empty-state">No WooCommerce product categories found — the Try-On button won't show on any product until its category is mapped below.</p>
          <?php else: ?>
            <p class="aivastra-card-description">Choose which try-on style each of your product categories should use. Categories left as "Default" won't show the Try-On button at all.</p>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-form">
              <input type="hidden" name="action" value="aivastra_tryon_save_category_map">
              <?php wp_nonce_field('aivastra_tryon_save_category_map'); ?>
              <div class="aivastra-mapping-list">
                <?php foreach ($productCategories as $term): ?>
                  <div class="aivastra-mapping-row">
                    <label for="aivastra-cat-map-<?php echo esc_attr($term->term_id); ?>" class="aivastra-mapping-label"><?php echo esc_html($term->name); ?></label>
                    <select id="aivastra-cat-map-<?php echo esc_attr($term->term_id); ?>" name="aivastra_category_map[<?php echo esc_attr($term->term_id); ?>]" class="aivastra-select">
                      <option value="">Default (button hidden)</option>
                      <?php foreach ($result['categories'] as $cat): ?>
                        <option value="<?php echo esc_attr($cat['slug']); ?>" <?php selected($currentMap[$term->term_id] ?? '', $cat['slug']); ?>>
                          <?php echo esc_html($cat['name']); ?>
                        </option>
                      <?php endforeach; ?>
                    </select>
                  </div>
                <?php endforeach; ?>
              </div>
              <button type="submit" class="aivastra-btn aivastra-btn-primary">Save categories</button>
            </form>
          <?php endif; ?>
        </div>
        <?php
    }
}
