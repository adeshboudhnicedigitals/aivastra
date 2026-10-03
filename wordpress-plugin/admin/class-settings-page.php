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
    // separate api.aivastra.com. This is the value every *server-to-server*
    // call in this plugin needs (every Aivastra_Connection_Service
    // construction — login, refresh, checkout, connect, disconnect, buy,
    // etc.) as well as the browser-driven Google-init redirect in
    // handle_connect_start() below, since both reach the same host in
    // production. For local development against `pnpm --filter
    // @aivastra/api dev` (port 4000), override this to reach the host from
    // inside the WordPress container (its own network namespace, not
    // localhost). `host.docker.internal` only resolves if local-wp's compose
    // file sets `extra_hosts: host.docker.internal: host-gateway` — it
    // doesn't by default (Docker Desktop adds it automatically; plain Docker
    // Engine on Linux doesn't). Verified working alternative: the docker
    // bridge gateway IP, e.g. 'http://172.19.0.1:4000' — get the actual value
    // via `docker network inspect local-wp_default` (or `docker inspect
    // local-wp-wordpress-1 --format '{{json .NetworkSettings.Networks}}'`),
    // it can differ per machine/network recreation. Local testing against
    // Google sign-in specifically needs a browser-reachable host instead
    // (the gateway IP won't work — Google itself rejects it as a
    // redirect_uri, "device_id and device_name are required for private
    // IP" — and GOOGLE_CALLBACK_URL is hardcoded in .env to
    // http://localhost:4000/v1/auth/google/callback, so the Google-init
    // redirect must share that same host or the API's google_state/
    // google_next cookies never reach the callback request); point this
    // constant at 'http://localhost:4000' for that case instead, accepting
    // that server-to-server calls will then fail until switched back.
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
    // Public: Aivastra_Category_Map_Ajax (includes/class-category-map-ajax.php)
    // needs it too, same cross-class reason API_BASE is public.
    public const ONBOARDING_DONE_OPTION_KEY = 'aivastra_tryon_onboarding_done';

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
        'invalid_state' => 'That connection attempt expired or didn\'t match — please try "Continue with Google" again.',
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
        'arrow-right' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
        'bar-chart-icon' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
        'grid' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
    ];

    // Per-tile icon/subtext, matched by plan position to TRYON_PLAN_META in
    // apps/catalogues-web/src/app/(app)/pricing/use-pricing-data.ts — GET
    // /v1/dev/plans doesn't return this display metadata, so it's
    // re-declared here to give this admin screen the same look as the
    // consumer pricing page for the same four tiers.
    //
    // Per-tile accent colour/highlight was briefly removed at the merchant's
    // request when Plans & credits was still one card squeezed onto the
    // shared one-page dashboard alongside Products/Support/etc — the extra
    // visual weight of a highlighted tile competed with every other card on
    // that page. Plans & credits now has its own standalone page
    // (render_plans_page(), linked from the "Buy credits" stat), so that
    // constraint no longer applies: render_plans() below uses the API's own
    // isHighlighted/badge fields again, same as the consumer pricing page.
    //
    // `name` is a WordPress-only display label, at the merchant's request —
    // GET /v1/dev/plans's own `name`/`slug`/price/credits/badge stay exactly
    // as the API returns them (unchanged here, unchanged in the app and
    // Shopify); only the heading text shown on this card is swapped, same
    // positional match as the rest of this array. If the account ever has
    // more than four active plans, render_plans() falls back to the plan's
    // real API name for the extra ones rather than mislabelling them.
    private const PLAN_META = [
        ['name' => 'Silver', 'icon' => 'rocket', 'subtext' => 'Great for getting started'],
        ['name' => 'Gold', 'icon' => 'bar-chart-icon', 'subtext' => 'Most popular'],
        ['name' => 'Platinum', 'icon' => 'building', 'subtext' => 'For growing stores'],
        ['name' => 'Diamond', 'icon' => 'building', 'subtext' => 'For stores with high traffic'],
    ];

    // Static feature list shown under every plan tile — same across all four
    // tiers (unlike the catalogue-plan PLAN_FEATURES in use-pricing-data.ts,
    // which varies by plan). Matches TRYON_FEATURES there exactly, since
    // these are the same try-on credit plans.
    private const PLAN_FEATURES = [
        'Instant Priority Processing',
        'Pay Only for Successful Try-Ons',
        'White Label Integration',
        'Website & Shopify Integration',
        'Standard AI Quality',
    ];

    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'register_menu']);
        add_action('admin_init', [self::class, 'redirect_legacy_url']);
        add_action('admin_head', [self::class, 'print_menu_icon_style']);
        add_action('admin_enqueue_scripts', [self::class, 'enqueue_assets']);
        add_action('admin_post_aivastra_tryon_connect', [self::class, 'handle_connect']);
        add_action('admin_post_aivastra_tryon_connect_start', [self::class, 'handle_connect_start']);
        // No nonce check on the callback action below — it's a cross-site
        // redirect from app.aivastra.com, not a same-site form submit, so
        // there's no WordPress session to carry a nonce through. CSRF
        // protection is the `state` parameter matching the transient
        // handle_connect_start() stored, checked inside the handler itself.
        add_action('admin_post_aivastra_tryon_connect_callback', [self::class, 'handle_connect_callback']);
        add_action('admin_post_aivastra_tryon_disconnect', [self::class, 'handle_disconnect']);
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
        wp_enqueue_script(
            'aivastra-tryon-connect',
            AIVASTRA_TRYON_URL . 'admin/assets/connect.js',
            [],
            AIVASTRA_TRYON_VERSION,
            true
        );
        wp_localize_script('aivastra-tryon-connect', 'aivastraConnect', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce(Aivastra_Connect_Ajax::NONCE_ACTION),
        ]);
        wp_enqueue_script(
            'aivastra-tryon-save-categories',
            AIVASTRA_TRYON_URL . 'admin/assets/save-categories.js',
            [],
            AIVASTRA_TRYON_VERSION,
            true
        );
        // No nonce here — the form's own wp_nonce_field() (render_category_mapping())
        // already carries it as _wpnonce, read straight out via FormData the
        // same way the rest of that form's fields are.
        wp_localize_script('aivastra-tryon-save-categories', 'aivastraSaveCategories', [
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

    // 10 minutes — generous enough to survive the admin switching tabs to
    // log in or register on app.aivastra.com, short enough that a stale
    // transient from an abandoned attempt doesn't linger.
    private const CONNECT_STATE_TRANSIENT = 'aivastra_tryon_connect_state';
    private const CONNECT_STATE_TTL = 10 * MINUTE_IN_SECONDS;

    /**
     * "Continue with Google" sub-path (docs/wordpress-plugin-design.md §4.1)
     * — generates a one-time state token, stashes it in a transient, and
     * sends the browser to Google's own consent screen first rather than our
     * branded /login form, landing back on the already-built
     * /connect/wordpress consent page once Google hands control back.
     * Google requires an exact-match registered redirect URI
     * (GOOGLE_CALLBACK_URL, fixed to api.aivastra.com) — it can never
     * redirect straight into a WordPress site's admin-post.php — so this
     * still has to bounce through our own domain once; what changed from the
     * previous version of this method is skipping our own login page on the
     * way there, not the number of hops. `next` round-trips through
     * /v1/auth/google/init as an opaque, re-encoded query value and lands
     * the browser on exactly that path+query under the web app's own origin
     * (apps/catalogues-web/src/app/api/auth/google/callback/route.ts treats
     * it as a path relative to that origin, never a full URL — so it must be
     * passed as one here too). wp_redirect() (not wp_safe_redirect()) is
     * correct here — the target is built from the fixed, plugin-controlled
     * API_BASE constant, not user input, so there is nothing for the
     * allowed-hosts check to guard against.
     */
    public static function handle_connect_start(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_connect_start');

        $state = wp_generate_password(32, false);
        set_transient(self::CONNECT_STATE_TRANSIENT, $state, self::CONNECT_STATE_TTL);

        $callbackUrl = admin_url('admin-post.php?action=aivastra_tryon_connect_callback');
        $consentPath = add_query_arg([
            'state' => $state,
            'site_url' => home_url('/'),
            'site_name' => get_bloginfo('name'),
            'redirect_uri' => $callbackUrl,
        ], '/connect/wordpress');

        // add_query_arg() does NOT urlencode its array values — passing
        // $consentPath (itself a URL with its own ?state=&site_url=&...) in
        // raw would let its &/= characters leak out as top-level params of
        // this outer URL instead of staying part of `next`'s value, silently
        // truncating `next` at the first & and dropping site_url/site_name/
        // redirect_uri entirely. rawurlencode() first keeps it one opaque value.
        $googleInitUrl = add_query_arg([
            'next' => rawurlencode($consentPath),
            'src' => 'wordpress_plugin',
        ], self::API_BASE . '/v1/auth/google/init');

        wp_redirect($googleInitUrl);
        exit;
    }

    /**
     * Step 2: the browser lands back here from app.aivastra.com with either
     * `code` (approved) or `error=access_denied` (the admin clicked Cancel
     * on the consent screen). The transient is the only thing authenticating
     * this request — there is no nonce, since app.aivastra.com's redirect is
     * cross-site and carries no WordPress session.
     */
    public static function handle_connect_callback(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }

        $expectedState = get_transient(self::CONNECT_STATE_TRANSIENT);
        delete_transient(self::CONNECT_STATE_TRANSIENT); // one-time use regardless of outcome

        $state = isset($_GET['state']) ? sanitize_text_field(wp_unslash($_GET['state'])) : '';
        $redirectArgs = ['page' => 'aivastra-tryon'];

        if ($expectedState === false || $state === '' || !hash_equals((string) $expectedState, $state)) {
            $redirectArgs['aivastra_error'] = 'invalid_state';
        } elseif (isset($_GET['error'])) {
            // Admin clicked Cancel — not a failure, just an abandoned attempt.
            $redirectArgs['aivastra_cancelled'] = '1';
        } else {
            $code = isset($_GET['code']) ? sanitize_text_field(wp_unslash($_GET['code'])) : '';
            if ($code === '') {
                $redirectArgs['aivastra_error'] = 'invalid_state';
            } else {
                $service = new Aivastra_Connection_Service(new Aivastra_Connection_Settings(), self::API_BASE);
                $result = $service->exchange_connect_code($code);
                $redirectArgs[$result['ok'] ? 'aivastra_connected' : 'aivastra_error'] =
                    $result['ok'] ? '1' : ($result['error'] ?? 'unknown');
            }
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
     *
     * Also deletes ONBOARDING_DONE_OPTION_KEY, a separate wp_option that
     * Aivastra_Connection_Settings::clear() never touches — without this, a
     * merchant who reconnects (same account or a different one) landed
     * straight back on the dashboard, silently skipping step 2 of the
     * wizard (categories/funnels) forever, because that flag survived the
     * disconnect. Contradicts this very method's own doc comment above
     * ("a fresh connect afterward could be a different aivastra account...
     * a stale mapping must not survive a disconnect") — the onboarding-done
     * flag is exactly that kind of stale state and needs to go too.
     */
    public static function handle_disconnect(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_disconnect');

        (new Aivastra_Connection_Settings())->clear();
        delete_option(self::ONBOARDING_DONE_OPTION_KEY);

        wp_safe_redirect(add_query_arg(
            ['page' => 'aivastra-tryon', 'aivastra_disconnected' => '1'],
            admin_url('admin.php')
        ));
        exit;
    }

    // "Save categories" is now AJAX (Aivastra_Category_Map_Ajax,
    // admin/assets/save-categories.js) — same reasoning as "Refresh balance"
    // above: a full-page admin-post.php round trip landed the merchant back
    // on the page with a dismissible "Categories saved." WP admin notice,
    // which core's own common.js relocates to right after the page's first
    // <h1>/<h2>, popping up nowhere near the Save button that was actually
    // clicked. AJAX saves the mapping in place and shows a small inline
    // confirmation next to the button instead — except when this save is
    // completing onboarding step 2, where the destination itself (the
    // dashboard) is the confirmation, same as every other onboarding
    // transition on this page; the AJAX handler tells the JS to navigate
    // there instead of showing an inline message in that one case.

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
     * Picks a y-axis ceiling for render_activity_chart() that's always a
     * multiple of 4 — so all 5 gridline labels (0, 1/4, 1/2, 3/4, full) come
     * out as whole numbers, never a fraction like 12.5 — and at least as big
     * as the real max daily value.
     */
    private static function nice_axis_max(int $rawMax): int
    {
        return max(4, (int) ceil($rawMax / 4) * 4);
    }

    /**
     * Monotone cubic (Fritsch–Carlson) interpolation through $points (each an
     * [x, y] pair in SVG viewBox pixels) — the same algorithm d3's
     * curveMonotoneX uses. Unlike a plain cardinal/Catmull-Rom spline, this
     * guarantees every segment's curve stays between its two endpoints' y
     * values, so it can't overshoot into a visible dip or bump next to a
     * point — which a low-volume merchant's data (a long flat run of zero
     * days next to one real day) makes an easy case to hit with a simpler
     * spline.
     *
     * @param array<int, array{0: float, 1: float}> $points
     */
    private static function smooth_line_path(array $points): string
    {
        $n = count($points);
        if ($n === 0) {
            return '';
        }
        if ($n === 1) {
            return sprintf('M%.2f,%.2f', $points[0][0], $points[0][1]);
        }
        if ($n === 2) {
            return sprintf('M%.2f,%.2f L%.2f,%.2f', $points[0][0], $points[0][1], $points[1][0], $points[1][1]);
        }

        $xs = array_column($points, 0);
        $ys = array_column($points, 1);

        // Secant slope of each segment.
        $secants = [];
        for ($k = 0; $k < $n - 1; $k++) {
            $h = $xs[$k + 1] - $xs[$k];
            $secants[$k] = $h !== 0.0 ? ($ys[$k + 1] - $ys[$k]) / $h : 0.0;
        }

        // Initial tangent at each point: the secant at the ends, the average
        // of its two neighboring secants everywhere in between.
        $tangents = [];
        $tangents[0] = $secants[0];
        $tangents[$n - 1] = $secants[$n - 2];
        for ($k = 1; $k < $n - 1; $k++) {
            $tangents[$k] = ($secants[$k - 1] + $secants[$k]) / 2;
        }

        // A flat segment (equal y at both ends) must have a flat tangent on
        // both its points, or the curve would bow away from a straight line
        // between two equal values.
        for ($k = 0; $k < $n - 1; $k++) {
            if ($secants[$k] === 0.0) {
                $tangents[$k] = 0.0;
                $tangents[$k + 1] = 0.0;
            }
        }

        // Fritsch–Carlson bound: rescale a segment's two tangents together
        // whenever they'd otherwise push the curve past monotone.
        for ($k = 0; $k < $n - 1; $k++) {
            if ($secants[$k] === 0.0) {
                continue;
            }
            $alpha = $tangents[$k] / $secants[$k];
            $beta = $tangents[$k + 1] / $secants[$k];
            $sumSq = $alpha * $alpha + $beta * $beta;
            if ($sumSq > 9.0) {
                $tau = 3.0 / sqrt($sumSq);
                $tangents[$k] = $tau * $alpha * $secants[$k];
                $tangents[$k + 1] = $tau * $beta * $secants[$k];
            }
        }

        $path = sprintf('M%.2f,%.2f', $xs[0], $ys[0]);
        for ($k = 0; $k < $n - 1; $k++) {
            $h = $xs[$k + 1] - $xs[$k];
            $cp1x = $xs[$k] + $h / 3;
            $cp1y = $ys[$k] + $tangents[$k] * $h / 3;
            $cp2x = $xs[$k + 1] - $h / 3;
            $cp2y = $ys[$k + 1] - $tangents[$k + 1] * $h / 3;
            $path .= sprintf(' C%.2f,%.2f %.2f,%.2f %.2f,%.2f', $cp1x, $cp1y, $cp2x, $cp2y, $xs[$k + 1], $ys[$k + 1]);
        }
        return $path;
    }

    /**
     * Top-of-dashboard activity chart — a smooth line in place of the old
     * plain bar chart, at the merchant's request to match a reference
     * dashboard screenshot (big headline number, uppercase axis label,
     * gridlines with a numeric y-axis). Deliberately its own self-contained
     * 14-day window (ANALYTICS_DAILY_WINDOW_DAYS server-side) rather than
     * mixing in the stat tiles' 30-day cards.tryOns total — those are two
     * different windows from the same GET /v1/dev/analytics call, and
     * labelling this card's headline number with the 30-day total while the
     * line below it only covers 14 days would silently misstate what the
     * chart shows. No period-over-period change badge (the reference
     * screenshot has one) since the API returns one window, not a
     * comparison to a prior one — nothing here to compute that from
     * honestly. Same reasoning as this method's doc comment on
     * render_dashboard(): no date-range picker, since the window is fixed
     * server-side.
     *
     * @param array<int, array{day:string,tryOns:int}> $daily
     */
    private static function render_activity_chart(array $daily): void
    {
        $n = count($daily);
        $total = 0;
        $rawMax = 0;
        foreach ($daily as $d) {
            $v = (int) $d['tryOns'];
            $total += $v;
            $rawMax = max($rawMax, $v);
        }
        $niceMax = self::nice_axis_max($rawMax);

        $width = 920;
        $height = 180;
        $padY = 10;
        $usableH = $height - 2 * $padY;
        $points = [];
        foreach (array_values($daily) as $i => $d) {
            $x = $n > 1 ? ($i / ($n - 1)) * $width : $width / 2;
            $y = $padY + $usableH - (((int) $d['tryOns']) / $niceMax) * $usableH;
            $points[] = [$x, $y];
        }
        $linePath = self::smooth_line_path($points);
        ?>
        <div class="aivastra-card aivastra-activity-card">
          <h3 class="aivastra-activity-title">Try-On Activity</h3>
          <div class="aivastra-activity-stat">
            <span class="aivastra-activity-number"><?php echo esc_html(number_format_i18n($total)); ?></span>
            <span class="aivastra-activity-caption">try-on<?php echo $total === 1 ? '' : 's'; ?> in the last <?php echo (int) $n; ?> days</span>
          </div>
          <p class="aivastra-activity-sublabel">TRY-ONS OVER TIME</p>

          <div class="aivastra-linechart">
            <div class="aivastra-linechart-axis">
              <?php for ($t = 4; $t >= 0; $t--): ?>
                <span><?php echo esc_html(number_format_i18n((int) round($niceMax * $t / 4))); ?></span>
              <?php endfor; ?>
            </div>
            <div class="aivastra-linechart-plot">
              <?php for ($t = 0; $t <= 4; $t++): ?>
                <div class="aivastra-linechart-gridline" style="top: <?php echo esc_attr((string) ($t * 25)); ?>%"></div>
              <?php endfor; ?>
              <?php if ($total === 0): ?>
                <p class="aivastra-empty-state aivastra-linechart-empty">No try-on activity yet in this window.</p>
              <?php else: ?>
                <svg class="aivastra-linechart-svg" viewBox="0 0 <?php echo (int) $width; ?> <?php echo (int) $height; ?>" preserveAspectRatio="none">
                  <path class="aivastra-linechart-line" d="<?php echo esc_attr($linePath); ?>" fill="none" />
                </svg>
              <?php endif; ?>
            </div>
          </div>
          <div class="aivastra-linechart-xaxis">
            <?php foreach ($daily as $d): ?>
              <span><?php echo esc_html(date_i18n('M j', strtotime((string) $d['day']))); ?></span>
            <?php endforeach; ?>
          </div>
        </div>
        <?php
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
            <?php // No boxed white card here any more — this flows straight on the
            // page's own background, same as every other screen in the plugin
            // (render_dashboard(), render_onboarding_categories()). Reuses
            // .aivastra-onboarding-heading — the exact same centred, 30px page-
            // title treatment render_onboarding_categories() gives step 2 — rather
            // than the old small left-aligned icon+heading row, so both onboarding
            // steps read as one consistent wizard. No description line under the
            // heading any more (the merchant found it redundant with the form
            // right below it) — just the bare page title. render_connect_form(false):
            // "Advanced: connect with API keys instead" moved out of this form
            // entirely, into the onboarding topbar instead (render_onboarding_topbar()'s
            // $showAdvanced); same flag also drops the form's own intro line
            // ("Log in or create your free Ai Vastra account…") for the same
            // reason. The "Update connection keys" reveal in the connected
            // dashboard is the only caller that still wants that line, so it
            // stays the default there. ?>
            <div class="aivastra-onboarding-heading">
              <h2>Connect your Ai Vastra account</h2>
            </div>
            <?php // Narrower than the 760px heading above it and the wider
            // .aivastra-onboarding-body it both sit inside — two short fields
            // filling the full wizard width read as oversized, and this is also
            // where the taller input/button sizing lives (.aivastra-connect-column
            // in the CSS), scoped here rather than globally so every other form
            // on the page keeps its normal size. ?>
            <div class="aivastra-connect-column">
              <?php self::render_connect_form(false); ?>
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
        ?>
        <div class="aivastra-card aivastra-status-card">
          <?php // No card heading — the badge below already says what this card is; only caller left with $connected=true is render_dashboard(), which gives the whole page its own "Dashboard" context. ?>
          <div class="aivastra-status-top">
            <div class="aivastra-status-left">
              <span class="aivastra-badge aivastra-badge-success">
                <?php echo self::icon('check-circle'); ?>
                Connected
              </span>
              <span class="aivastra-status-company"><span class="aivastra-status-company-tag">User:</span> <?php echo esc_html($companyName); ?></span>
            </div>

            <?php // Update connection keys sits right next to the username now, not
            // down with Refresh in a separate action row — it's about the
            // connection this badge row already describes, not a credits-balance
            // action like Refresh (moved up to the credits label itself) or
            // Buy credits (by the number). .aivastra-status-top's own flex-wrap
            // still lets this drop to its own full-width line when opened
            // (.aivastra-accordion[open]'s flex-basis: 100%), same as it did in
            // the old action row. ?>
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

            <?php // Status, user, Update connection keys and Disconnect all on one
            // line now — the two-row stacked corner this used to be left the row
            // as tall as its tallest side, with empty space under "Connected" on
            // the short side. margin-left: auto (CSS) keeps Disconnect pinned to
            // the far right regardless of how much the rest of this row holds. ?>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-status-disconnect-form">
              <input type="hidden" name="action" value="aivastra_tryon_disconnect">
              <?php wp_nonce_field('aivastra_tryon_disconnect'); ?>
              <button type="submit" class="aivastra-btn aivastra-btn-danger-ghost aivastra-btn-sm">
                <?php echo self::icon('log-out'); ?>
                Disconnect
              </button>
            </form>
          </div>

          <p class="aivastra-balance-label">
            Credits left
            <?php // AJAX (Aivastra_Refresh_Ajax) — see the comment where
            // handle_refresh() used to live, above handle_disconnect(). Icon-only
            // now, right on the label instead of a full "Refresh balance" button
            // in a separate row below — same #aivastra-refresh-balance id, so
            // refresh-balance.js needs no changes at all. ?>
            <button
              type="button"
              id="aivastra-refresh-balance"
              class="aivastra-balance-refresh-btn"
              aria-label="Refresh balance"
              data-nonce="<?php echo esc_attr(wp_create_nonce(Aivastra_Refresh_Ajax::NONCE_ACTION)); ?>"
            >
              <span class="aivastra-refresh-icon"><?php echo self::icon('refresh'); ?></span>
            </button>
            <?php // Filled in by refresh-balance.js on a successful refresh; empty and invisible (no reserved layout space — see the CSS) until then. Moved here from the credit-stat row, right beside the icon that triggers it, so the confirmation appears exactly where the merchant just clicked rather than down by the number. ?>
            <span class="aivastra-refresh-confirm" id="aivastra-refresh-confirm" aria-live="polite"></span>
          </p>
          <div class="aivastra-credit-stat">
            <span class="aivastra-credit-number" id="aivastra-credit-number"><?php echo esc_html(number_format_i18n((int) $credits)); ?></span>
            <?php // No "credits" word here any more — "Credits left" above
            // already says what the number is, and the Buy credits button's
            // own label carries the word too, so it isn't missing. ?>
            <?php // Right after the credit count itself, not down in a separate action
            // row — this is the merchant's most likely next move right when
            // they're looking at a low number, not a utility action. Links to
            // render_plans_page() (Plans & credits moved off this one-page
            // dashboard onto its own page, at the merchant's request). ?>
            <a href="<?php echo esc_url(add_query_arg(['page' => 'aivastra-tryon', 'section' => 'plans'], admin_url('admin.php'))); ?>" class="aivastra-btn aivastra-btn-dark aivastra-credit-buy-btn">
              Buy credits
            </a>
          </div>
          <?php // tryOnsRemaining is real (get_balance_summary()) — a Aivastra_Connection_Service::get_balance_summary() error (stale connection, API hiccup) is the only time this falls back to the plain last-checked timestamp, same text this line always showed before. No "roughly N days at your current rate" any more — the average-per-day arithmetic behind it (get_balance_summary()'s own daysRemaining) produces a wildly large, not-useful number for a low-usage store (tens of thousands of days), at the merchant's request. ?>
          <p class="aivastra-credit-meta" id="aivastra-credit-meta">
            <?php if ($tryOnsRemaining !== null): ?>
              About <?php echo esc_html(number_format_i18n($tryOnsRemaining)); ?> try-on<?php echo $tryOnsRemaining === 1 ? '' : 's'; ?> remaining
            <?php else: ?>
              Balance last checked <?php echo esc_html($creditsAsOf ?? 'unknown'); ?>
            <?php endif; ?>
          </p>
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
     * either saving a mapping (Aivastra_Category_Map_Ajax::handle()) or
     * skipping (handle_skip_onboarding()).
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
        if (($_GET['section'] ?? '') === 'categories') {
            self::render_categories_page($settings);
            return;
        }
        if (($_GET['section'] ?? '') === 'plans') {
            self::render_plans_page($settings);
            return;
        }
        ?>
        <?php // No boxed white panel around this page (or any other page in
        // the plugin — see render_onboarding_connect(), render_onboarding_categories(),
        // render_categories_page(), render_plans_page(), render_intro()) — a
        // fixed-height, internally-scrolling panel used to wrap every one of
        // them, which produced a second scrollbar nested inside wp-admin's
        // own page scrollbar the moment a page's content ran past its
        // calc()'d height. This page in particular (by far the most content
        // of any page here) hit that routinely, not as an edge case. Every
        // page instead flows directly in wp-admin's own body now — one
        // scrollbar, and the full page width is available to content
        // instead of a boxed panel with its own padding stacked on top of
        // the wrap's. ?>
        <div class="wrap aivastra-settings-wrap aivastra-dashboard-wrap aivastra-dashboard-flat">
          <?php self::render_app_header(); ?>

          <?php self::render_notices(); ?>

          <?php self::render_dashboard($settings); ?>
        </div>

        <?php self::render_chat_modal(); ?>
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
     * behind a click, in this order: Connection (credits balance + Buy credits),
     * the Try-On Activity line chart, Products overview, Try-On Button and
     * Support (Categories and Plans & Credits both moved to their own pages —
     * render_categories_page(), render_plans_page()). Connection leads
     * because the credits balance and its Buy credits button are what a
     * merchant most needs to see first; the chart was originally first
     * instead, per an earlier version of the same request. Each reuses its
     * old tab's render method completely unchanged — same forms, same save
     * handlers, same data — just called in sequence instead of behind a
     * section switch.
     *
     * The old Analytics tab's stat-tile grid (Virtual Try-Ons/Unique
     * Shoppers/Added to Cart/Add-to-Cart Rate/Credits Available) and Top
     * Products table — purpose-built for this page, modelled on a reference
     * WordPress plugin dashboard the merchant supplied screenshots of — were
     * removed at the merchant's later request ("unwanted for now"); $result
     * (GET /v1/dev/analytics) is still fetched here since render_activity_chart()
     * and get_balance_summary() (via render_connection_section()) both need it.
     */
    private static function render_dashboard(Aivastra_Connection_Settings $settings): void
    {
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $service->get_analytics();
        ?>
        <div class="aivastra-dashboard">
          <?php // No "Dashboard" heading (the page it's on already says so) and no "Last 30 days" period pill — the merchant asked for both to be dropped. ?>
          <?php // Connection first (credits balance + Buy credits button) — the merchant wants that found "clearly and soon", ahead of the chart below it. $result's `daily` rows (fetched below for the Try-On Activity chart) double as get_balance_summary()'s days-remaining input, so this doesn't make its own separate GET /v1/dev/analytics call — fetching $result before this call, even though the chart it's mainly for renders second, keeps that single-fetch property. ?>
          <?php self::render_connection_section($settings, true, $result['ok'] ? $result['daily'] : null); ?>

          <?php self::render_activity_chart($result['ok'] ? $result['daily'] : []); ?>

          <?php // Stat tiles (Virtual Try-Ons/Unique Shoppers/Added to Cart/Add-to-Cart
          // Rate/Credits Available) and the Top Products table removed at the
          // merchant's request — "unwanted for now". render_activity_chart() and
          // render_connection_section() above already cover try-on volume and
          // credits from the same GET /v1/dev/analytics call ($result), so
          // nothing here needs re-fetching if this comes back later. ?>

          <?php self::render_products_overview($settings); ?>

          <?php // Rest of the old sidebar tabs, unchanged, now stacked on this one page instead of behind a click. Categories and Plans & credits both moved off this page entirely — render_products_overview()'s Manage button links to render_categories_page(), and render_connection_section()'s Buy credits button links to render_plans_page(), so neither shows twice. ?>
          <?php self::render_widget_customization($settings); ?>
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
     * @param bool $showAdvanced Step 1 only (render_onboarding_connect()) —
     *   docks "Advanced: connect with API keys instead" here as a second
     *   dropdown beside Support instead of inline at the bottom of the
     *   connect form, now that the form flows on the bare page background
     *   with nothing below it to visually separate it from. Step 2 has no
     *   paste-key fallback (there's nothing left to connect by then), so it
     *   never passes true.
     */
    private static function render_onboarding_topbar(?string $backUrl = null, bool $showAdvanced = false): void
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

          <div class="aivastra-topbar-right">
            <?php // Both <details> menus below share the same floating-popover idiom
            // (.aivastra-topbar-support / .aivastra-topbar-advanced in the CSS) —
            // support-chat.js's outside-click/Escape handling covers both by
            // selector, not just Support. ?>
            <?php if ($showAdvanced): ?>
              <?php self::render_advanced_connect_accordion('aivastra-topbar-advanced'); ?>
            <?php endif; ?>
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
          <?php self::render_onboarding_topbar(admin_url('admin.php?page=aivastra-tryon'), true); ?>

          <div class="aivastra-page-flat-body">
            <?php self::render_progress_steps(1); ?>

            <?php self::render_notices(); ?>

            <div class="aivastra-onboarding-body">
              <?php self::render_connection_section($settings, false); ?>
            </div>
          </div>
        </div>

        <?php self::render_chat_modal(); ?>
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
          <?php self::render_onboarding_topbar(admin_url('admin.php?page=aivastra-tryon&section=connection')); ?>

          <div class="aivastra-page-flat-body">
            <?php self::render_progress_steps(2); ?>

            <div class="aivastra-onboarding-heading">
              <h2>Describe Your Garment type for Accurate Virtual Try-On Results</h2>
              <p>Choose the garment type, such as Upper Wear or Single-Piece Dress, for each category to ensure accurate virtual try-on results.</p>
            </div>

            <?php self::render_notices(false); ?>

            <div class="aivastra-onboarding-body">
              <?php // false, false, false: no boxed white card (flows on the page's
              // own background, same as the connect step — no
              // .aivastra-card wrapper here any more), no "Categories" card
              // heading/description, and no Linked/Unlinked split — this
              // step's own heading and subtext above already say what to do
              // (see render_category_mapping()'s doc comment for
              // $showGroups), so this shows one flat grid of every category
              // instead. ?>
              <?php self::render_category_mapping($settings, false, false, false); ?>
            </div>

            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-onboarding-skip">
              <input type="hidden" name="action" value="aivastra_tryon_skip_onboarding">
              <?php wp_nonce_field('aivastra_tryon_skip_onboarding'); ?>
              <button type="submit" class="aivastra-onboarding-skip-link">Skip for now</button>
            </form>
          </div>
        </div>

        <?php self::render_chat_modal(); ?>
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
     * reveal. Primary path is the embedded email/password form
     * (admin/assets/connect.js → Aivastra_Connect_Ajax →
     * POST /v1/merchant/wordpress-login) — everything happens server-to-
     * server in one AJAX call, no redirect anywhere, and a free account is
     * created automatically if the email doesn't match one yet (it only
     * needs a verification-email click, same as any direct signup). The
     * previous version of this form — a single "Log in with Ai Vastra"
     * button that round-tripped to the app.aivastra.com consent screen — is
     * now the "Continue with Google" link, since Google's own redirect-URI
     * requirement is the one case that can't be made to skip our domain
     * entirely (see handle_connect_start()). The original two-field paste
     * form stays available behind "Advanced", collapsed — some hosting
     * setups block the AJAX/redirect round trips, and it's a safety net for
     * already-connected merchants used to it.
     *
     * $showAdvanced also gates this form's own intro line, not just the
     * "Advanced" accordion — both exist for the same reason (give a merchant
     * who's just landed on "Update connection keys", with no surrounding
     * heading, enough context to know what the form in front of them is for)
     * and both are redundant on render_onboarding_connect(), which already
     * has its own centred page heading/description saying the same thing.
     */
    private static function render_connect_form(bool $showAdvanced = true): void
    {
        ?>
        <?php if ($showAdvanced): ?>
          <p class="aivastra-step-hint">Log in or create your free Ai Vastra account to connect your store — no copy/paste.</p>
        <?php endif; ?>
        <form id="aivastra-connect-form" class="aivastra-form">
          <div class="aivastra-step-body">
            <label for="aivastra_connect_email">Email</label>
            <input type="email" id="aivastra_connect_email" name="email" class="aivastra-input" autocomplete="email" required>
          </div>
          <div class="aivastra-step-body">
            <label for="aivastra_connect_password">Password</label>
            <input type="password" id="aivastra_connect_password" name="password" class="aivastra-input" autocomplete="current-password" required>
          </div>
          <div class="aivastra-step-body" id="aivastra-connect-phone-row" hidden>
            <label for="aivastra_connect_phone">Phone number</label>
            <p class="aivastra-step-hint">Needed once, to finish setting up your Ai Vastra business account.</p>
            <input type="tel" id="aivastra_connect_phone" name="phone" class="aivastra-input" autocomplete="tel">
          </div>
          <div id="aivastra-connect-message" class="aivastra-connect-message" role="status" aria-live="polite"></div>
        </form>
        <?php // A separate, fieldless form purely so "Continue with Google" can submit
        // it via the button's form="" attribute below — same admin-post.php
        // round trip as before, just no longer nested inside the email/password
        // form, so it can sit as its own row in .aivastra-connect-actions-row
        // instead of stacked under an "or" divider. ?>
        <form id="aivastra-google-connect-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
          <input type="hidden" name="action" value="aivastra_tryon_connect_start">
          <?php wp_nonce_field('aivastra_tryon_connect_start'); ?>
        </form>
        <div class="aivastra-connect-actions-row">
          <?php // "Log in" covers both — Aivastra_Connect_Ajax / POST
          // /v1/merchant/wordpress-login creates a free account automatically
          // when the email doesn't match one yet, same as this button used to
          // say explicitly ("Log in / Sign up") before the merchant asked for
          // the shorter label. ?>
          <button type="submit" form="aivastra-connect-form" id="aivastra-connect-submit" class="aivastra-btn aivastra-btn-primary">
            <?php echo self::icon('link'); ?>
            Log in
          </button>
          <button type="submit" form="aivastra-google-connect-form" class="aivastra-btn aivastra-btn-primary">Continue with Google</button>
        </div>
        <?php // false for render_onboarding_connect() (step 1) — it docks this in the
        // topbar instead (render_onboarding_topbar()'s $showAdvanced). Every other
        // caller (the "Update connection keys" reveal in the connected dashboard)
        // keeps it right here, inline. ?>
        <?php if ($showAdvanced): ?>
          <?php self::render_advanced_connect_accordion(); ?>
        <?php endif; ?>
        <?php
    }

    /**
     * "Advanced: connect with API keys instead" — the original two-field
     * paste form, kept as a fallback for hosting setups that block the
     * AJAX/redirect round trips above and for already-connected merchants
     * used to it. Extracted out of render_connect_form() so the exact same
     * markup (same nonce action, same POST handler) can render in either of
     * two very different spots: inline at the bottom of that form (the
     * default, still how the connected dashboard's "Update connection keys"
     * reveal shows it) or, via $extraClass, as a floating topbar dropdown for
     * step 1 of the onboarding wizard only (render_onboarding_topbar()).
     */
    private static function render_advanced_connect_accordion(string $extraClass = ''): void
    {
        ?>
        <details class="aivastra-accordion aivastra-connect-advanced<?php echo $extraClass !== '' ? ' ' . esc_attr($extraClass) : ''; ?>">
          <summary>
            Advanced: connect with API keys instead
            <?php echo self::icon('chevron'); ?>
          </summary>
          <div class="aivastra-accordion-body">
            <p class="aivastra-step-hint">If the login button above doesn&rsquo;t work for your hosting setup, paste two keys from your Ai Vastra account instead:</p>
            <div class="aivastra-onboarding-links">
              <a href="<?php echo esc_url(self::API_BASE . '/register?src=wordpress_plugin'); ?>" target="_blank" rel="noopener noreferrer" class="aivastra-btn aivastra-btn-ghost">Create a free account &rarr;</a>
              <a href="<?php echo esc_url(self::API_BASE . '/developers'); ?>" target="_blank" rel="noopener noreferrer" class="aivastra-btn aivastra-btn-ghost">Already have an account? Get your API keys &rarr;</a>
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
          </div>
        </details>
        <?php
    }

    /**
     * $showConnected: the "Connected successfully." notice — on by default.
     * render_onboarding_categories() (step 2, arrived at straight from a
     * successful connect) passes false: the progress row already advancing
     * to step 2, plus the whole page it lands on, is itself the confirmation
     * that connecting worked — a dismissible admin notice on top of that
     * read as one more thing to clear rather than useful information.
     */
    private static function render_notices(bool $showConnected = true): void
    {
        if ($showConnected && isset($_GET['aivastra_connected'])) {
            self::render_notice('success', 'Connected successfully.');
        }
        if (isset($_GET['aivastra_disconnected'])) {
            self::render_notice('success', 'Disconnected. All stored settings, including your saved categories, have been cleared.');
        }
        if (isset($_GET['aivastra_cancelled'])) {
            self::render_notice('info', 'Connection cancelled — nothing was changed.');
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
     *
     * $wrapInCard: false for render_plans_page(), the standalone "Buy credits"
     * destination (render_connection_section()'s credit stat links there) —
     * same reasoning as render_category_mapping()'s own $wrapInCard: a card
     * box around the only thing on a page is a second box nested inside the
     * shell panel's own. true (default) keeps render_dashboard()'s old
     * inline look... except render_dashboard() no longer calls this at all,
     * Plans having moved off the one-page dashboard entirely — the default
     * is kept true only so a future caller isn't surprised by an unwrapped
     * card if one shows up alongside other content again. Doubles as the
     * "standalone page" flag below: the large centred heading and the
     * highlighted-tile/feature-list treatment only make sense with a whole
     * page to themselves, not squeezed into a card alongside other content.
     */
    private static function render_plans(Aivastra_Connection_Settings $settings, bool $wrapInCard = true): void
    {
        $isStandalonePage = !$wrapInCard;
        $widgetKey = $settings->get_widget_key();
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $widgetKey !== null ? $service->list_plans($widgetKey) : ['ok' => false, 'plans' => []];
        ?>
        <?php if ($wrapInCard): ?><div class="aivastra-card aivastra-plans-card"><?php endif; ?>
          <h2 class="aivastra-card-heading<?php echo $isStandalonePage ? ' aivastra-plans-page-heading' : ''; ?>"><?php echo self::heading_icon('credit-card'); ?>Plans &amp; credits</h2>
          <?php if (!$result['ok']): ?>
            <p class="aivastra-empty-state">Could not load plans right now — try reloading this page.</p>
          <?php else: ?>
            <div class="aivastra-plans-grid">
              <?php foreach ($result['plans'] as $idx => $plan): ?>
                <?php
                // Styling (icon/subtext) cycles from the top if there are ever more
                // than four plans; the display name does not — past our four known
                // tiers, mislabelling a 5th plan "Silver" again would be worse than
                // just showing its real API name. isHighlighted/badge come straight
                // from GET /v1/dev/plans, same fields the consumer pricing page
                // reads — see the PLAN_META doc comment for why this plugin used to
                // ignore them and no longer does.
                $meta = self::PLAN_META[$idx] ?? self::PLAN_META[0];
                $displayName = self::PLAN_META[$idx]['name'] ?? $plan['name'];
                $highlighted = !empty($plan['isHighlighted']);
                $badge = $plan['badge'] ?? null;
                ?>
                <div class="aivastra-plan-outer<?php echo $highlighted ? ' aivastra-plan-outer-highlighted' : ''; ?>">
                  <div class="aivastra-plan-tile">
                    <?php if ($highlighted && $badge): ?>
                      <span class="aivastra-plan-badge">&#9733; <?php echo esc_html($badge); ?></span>
                    <?php endif; ?>
                    <div class="aivastra-plan-head">
                      <span class="aivastra-plan-icon">
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
                      <p class="aivastra-plan-features-heading">Included Features</p>
                      <?php foreach (self::PLAN_FEATURES as $feature): ?>
                        <div class="aivastra-plan-feature">
                          <span class="aivastra-plan-feature-check"><?php echo self::icon('check-circle'); ?></span>
                          <span><?php echo esc_html($feature); ?></span>
                        </div>
                      <?php endforeach; ?>
                    </div>

                    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-plan-buy-form">
                      <input type="hidden" name="action" value="aivastra_tryon_buy">
                      <input type="hidden" name="aivastra_plan_slug" value="<?php echo esc_attr($plan['slug']); ?>">
                      <?php wp_nonce_field('aivastra_tryon_buy'); ?>
                      <button type="submit" class="aivastra-btn aivastra-plan-buy-btn aivastra-btn-dark">
                        Buy credits <?php echo self::icon('arrow-right'); ?>
                      </button>
                    </form>
                  </div>
                </div>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>
        <?php if ($wrapInCard): ?></div><?php endif; ?>
        <?php
    }

    /**
     * "Enabled" here means the button will actually render on that product's
     * page right now — both conditions Aivastra_Widget_Loader::render()
     * checks: the per-product toggle isn't off (Aivastra_Product_Toggle) AND
     * its WooCommerce category resolves to a mapped aivastra category
     * (Aivastra_Category_Mapping::resolve() — null means hidden, see its doc
     * comment). Just the two counts, not a per-product table — a merchant's
     * whole catalog (hundreds of rows on a real store) made this card
     * unusably long; Manage links to render_categories_page() instead,
     * where the actual lever (category mapping) lives. Manage is a third
     * .aivastra-dashboard-stat tile in the same grid as the two count
     * tiles — not a button floating beside them — so it wraps onto its own
     * row together with them on a narrow screen instead of the button alone
     * getting squeezed out, and reads as three equal, self-explanatory
     * cards rather than two stats plus an unrelated control.
     *
     * update_object_term_cache()/update_postmeta_cache() batch-prime the
     * caches wp_get_post_terms()/get_post_meta() read per product below —
     * without this a store with hundreds of products (this merchant's real
     * store has 432) would run two extra queries per product instead of two
     * queries total.
     */
    private static function render_products_overview(Aivastra_Connection_Settings $settings): void
    {
        $productIds = get_posts([
            'post_type' => 'product',
            'post_status' => 'publish',
            'posts_per_page' => -1,
            'fields' => 'ids',
        ]);

        update_object_term_cache($productIds, 'product');
        update_postmeta_cache($productIds);

        $categoryMap = $settings->get_category_map();
        $enabledCount = 0;

        foreach ($productIds as $productId) {
            $termIds = wp_get_post_terms($productId, 'product_cat', ['fields' => 'ids']);
            $category = Aivastra_Category_Mapping::resolve(is_array($termIds) ? $termIds : [], $categoryMap);
            if (Aivastra_Product_Toggle::is_enabled($productId) && $category !== null) {
                $enabledCount++;
            }
        }
        ?>
        <div class="aivastra-card aivastra-products-overview-card">
          <h2 class="aivastra-card-heading"><?php echo self::heading_icon('grid'); ?>Products</h2>
          <div class="aivastra-dashboard-stats aivastra-products-stats">
            <div class="aivastra-dashboard-stat">
              <span class="aivastra-dashboard-stat-icon aivastra-dashboard-stat-icon--products">
                <?php echo self::icon('grid'); ?>
              </span>
              <span class="aivastra-dashboard-stat-label">Total Products</span>
              <span class="aivastra-dashboard-stat-value"><?php echo esc_html(number_format_i18n(count($productIds))); ?></span>
            </div>
            <div class="aivastra-dashboard-stat">
              <span class="aivastra-dashboard-stat-icon aivastra-dashboard-stat-icon--enabled">
                <?php echo self::icon('check-circle'); ?>
              </span>
              <span class="aivastra-dashboard-stat-label">Try-On Enabled</span>
              <span class="aivastra-dashboard-stat-value"><?php echo esc_html(number_format_i18n($enabledCount)); ?></span>
            </div>
            <a href="<?php echo esc_url(add_query_arg(['page' => 'aivastra-tryon', 'section' => 'categories'], admin_url('admin.php'))); ?>" class="aivastra-dashboard-stat aivastra-dashboard-stat--action">
              <span class="aivastra-dashboard-stat-icon aivastra-dashboard-stat-icon--manage">
                <?php echo self::icon('tag'); ?>
              </span>
              <span class="aivastra-dashboard-stat-label">Try-on setup</span>
              <span class="aivastra-dashboard-stat-value aivastra-dashboard-stat-action-value">Manage<?php echo self::icon('arrow-right'); ?></span>
            </a>
          </div>
        </div>
        <?php
    }

    /**
     * Standalone "Manage" destination for the Products card's stat tiles —
     * the same render_category_mapping() card the connected dashboard used
     * to show inline, now reachable from its own URL
     * (?page=aivastra-tryon&section=categories) instead of scrolled past.
     * Reuses render_onboarding_topbar() for the logo/Back/Support chrome —
     * the same "way back to the dashboard" affordance
     * render_onboarding_categories() has — but the wrap/body classes are
     * the dashboard's own (aivastra-dashboard-wrap / .aivastra-dashboard,
     * 1400px centred), not the onboarding shell's narrower 760px
     * .aivastra-onboarding-body: this page is a full dashboard sub-page with
     * a grid of category tiles, not a single narrow form card like the
     * connect/category-picker onboarding steps that body width was sized
     * for. render_category_mapping()'s own card box and small "Categories"
     * heading are both skipped ($wrapInCard/$showHeading: false) — this page
     * has nothing else on it, so a card around its only content was just a
     * second box nested inside the shell panel's own box, and this renders
     * its own larger, centered heading in place of the small card one.
     */
    private static function render_categories_page(Aivastra_Connection_Settings $settings): void
    {
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-dashboard-wrap">
          <?php self::render_onboarding_topbar(admin_url('admin.php?page=aivastra-tryon')); ?>

          <div class="aivastra-page-flat-body">
            <?php self::render_notices(); ?>

            <div class="aivastra-dashboard">
              <div class="aivastra-categories-heading">
                <h2>Select garments for the virtual try-on</h2>
                <p>Choose the garment type, such as Upper Wear or Single-Piece Dress, for each product to ensure accurate virtual try-on results.</p>
              </div>
              <?php self::render_category_mapping($settings, false, false); ?>
            </div>
          </div>
        </div>

        <?php self::render_chat_modal(); ?>
        <?php
    }

    /**
     * Standalone "Buy credits" destination for render_connection_section()'s
     * credit stat — the same render_plans() card the one-page dashboard used
     * to show inline, now on its own URL (?page=aivastra-tryon&section=plans)
     * at the merchant's request. Reuses render_onboarding_topbar() for the
     * logo/Back/Support chrome and the dashboard's own wrap/body classes
     * (aivastra-dashboard-wrap / .aivastra-dashboard, 1400px centred), same
     * as render_categories_page() right above. render_plans()'s own card box
     * is skipped too ($wrapInCard: false) for the same reason it is there —
     * this page has nothing else on it.
     *
     * section=plans already existed as a query arg before this page did
     * (handle_buy()'s redirects, both the error path and the
     * aivastra_checkout=1 success path that auto-opens the Razorpay modal —
     * see enqueue_assets()) — those redirects now land here instead of the
     * general dashboard, which is the more correct destination for either
     * outcome of a purchase attempt.
     */
    private static function render_plans_page(Aivastra_Connection_Settings $settings): void
    {
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-dashboard-wrap">
          <?php self::render_onboarding_topbar(admin_url('admin.php?page=aivastra-tryon')); ?>

          <div class="aivastra-page-flat-body aivastra-plans-page-body">
            <?php self::render_notices(); ?>

            <div class="aivastra-dashboard">
              <?php self::render_plans($settings, false); ?>
            </div>
          </div>
        </div>

        <?php self::render_chat_modal(); ?>
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

            <?php
            // Both button color controls in one row — the trio this used to
            // be (Button color, Accent color, Button gradient) is now a pair:
            // Accent color's own field is hidden (Aivastra_Widget_Customization
            // sanitize()/defaults() still carry the field and widget.js still
            // applies it if a value is somehow stored, but the admin form no
            // longer writes one), at the merchant's request — the popup
            // accent now always renders at its CSS default, changed to black
            // to match (assets/widget.css's --aivastra-accent).
            ?>
            <div class="aivastra-field-pair">
              <div class="aivastra-field-row aivastra-field-row-fixed">
                <label for="aivastra_widget_button_color">Button color</label>
                <input type="color" id="aivastra_widget_button_color" name="aivastra_widget[buttonColor]" class="aivastra-color-input" value="<?php echo esc_attr($c['buttonColor'] ?? '#0f172a'); ?>">
              </div>
              <div class="aivastra-field-row aivastra-field-row-grow">
                <label>Button gradient</label>
                <div class="aivastra-gradient-swatches" role="radiogroup" aria-label="Button gradient">
                  <label class="aivastra-gradient-swatch aivastra-gradient-swatch--none" title="None — use the solid button color above">
                    <input type="radio" name="aivastra_widget[buttonGradient]" class="aivastra-gradient-swatch-input" value="" <?php checked(empty($c['buttonGradient'])); ?>>
                    <span class="aivastra-gradient-swatch-ring" aria-hidden="true"></span>
                  </label>
                  <?php foreach (Aivastra_Widget_Customization::BUTTON_GRADIENTS as $slug => $css): ?>
                    <label class="aivastra-gradient-swatch" style="background:<?php echo esc_attr($css); ?>" title="<?php echo esc_attr(ucfirst($slug)); ?>">
                      <input type="radio" name="aivastra_widget[buttonGradient]" class="aivastra-gradient-swatch-input" value="<?php echo esc_attr($slug); ?>" <?php checked($c['buttonGradient'] ?? '', $slug); ?>>
                      <span class="aivastra-gradient-swatch-ring" aria-hidden="true"></span>
                    </label>
                  <?php endforeach; ?>
                </div>
              </div>
            </div>
            <p class="aivastra-field-hint">Applied directly to the try-on button (a picked gradient overrides the solid color), so it always shows even if your theme styles buttons on its own.</p>

            <?php
            // Collapsed by default (open only once the merchant has actually
            // customized something in here) — these five fields are the
            // popup's copy/behavior, not the button itself, and stacking
            // them open-by-default was most of what made this card so much
            // taller than every other dashboard card. Same <details> idiom
            // as the Connection card's "Update connection keys" accordion.
            // Paired with Button placement in one row via the same
            // .aivastra-field-pair used above — .aivastra-accordion[open]
            // already carries flex-basis:100% (added for .aivastra-
            // action-row's own wrapping row), which combined with
            // .aivastra-field-pair's flex-wrap here is what lets the
            // expanded copy fields fall to their own full-width line
            // instead of being squeezed into half the card.
            $hasPopupCopyOverrides = $c['heading'] !== null || $c['subheading'] !== null || $c['ctaLabel'] !== null
                || $c['addToCartLabel'] !== null || $c['shareLabel'] !== null
                || $c['addToCart'] !== true || $c['share'] !== true;
            ?>
            <div class="aivastra-field-pair aivastra-field-pair-wrap">
              <div class="aivastra-field-row">
                <label for="aivastra_widget_button_placement">Button placement</label>
                <select id="aivastra_widget_button_placement" name="aivastra_widget[buttonPlacement]" class="aivastra-select">
                  <option value="after_title" <?php selected($c['buttonPlacement'] ?? 'before_cart', 'after_title'); ?>>Right below the product title</option>
                  <option value="before_cart" <?php selected($c['buttonPlacement'] ?? 'before_cart', 'before_cart'); ?>>Before "Add to Cart" (default)</option>
                  <option value="after_cart" <?php selected($c['buttonPlacement'] ?? 'before_cart', 'after_cart'); ?>>After "Add to Cart"</option>
                </select>
              </div>
              <div class="aivastra-field-row">
                <label class="aivastra-field-row-label-ghost" aria-hidden="true">&nbsp;</label>
                <details class="aivastra-accordion"<?php echo $hasPopupCopyOverrides ? ' open' : ''; ?>>
                  <summary>
                    Popup copy &amp; behavior
                    <?php echo self::icon('chevron'); ?>
                  </summary>
                  <div class="aivastra-accordion-body">
                    <div class="aivastra-field-pair">
                      <div class="aivastra-field-row">
                        <label for="aivastra_widget_heading">Popup heading</label>
                        <input type="text" id="aivastra_widget_heading" name="aivastra_widget[heading]" class="aivastra-input" maxlength="60" placeholder="Virtual Try-On" value="<?php echo esc_attr($c['heading'] ?? ''); ?>">
                      </div>
                      <div class="aivastra-field-row">
                        <label for="aivastra_widget_subheading">Popup subheading</label>
                        <input type="text" id="aivastra_widget_subheading" name="aivastra_widget[subheading]" class="aivastra-input" maxlength="160" placeholder="Upload a full-body photo to see how it looks on you." value="<?php echo esc_attr($c['subheading'] ?? ''); ?>">
                      </div>
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
                  </div>
                </details>
              </div>
            </div>
            <p class="aivastra-field-hint">Some themes override the button's placement — check a live product page after saving.</p>

            <button type="submit" class="aivastra-btn aivastra-btn-primary">Save appearance</button>
          </form>
        </div>
        <?php
    }

    /**
     * Only shown once connected — a widget key is required to list the
     * merchant's aivastra categories (GET /v1/dev/categories).
     *
     * $wrapInCard: true for render_onboarding_categories(), where this is
     * one focused step alongside a progress row and a Skip link and reads
     * right as a card. render_categories_page() passes false — there, this
     * is the entire page's content, and a card box around it was just a
     * second, redundant frame nested inside the shell panel's own framing
     * (the exact "another div to center things" the merchant asked to
     * remove).
     *
     * $showHeading: the small "Categories" card heading + its one-line
     * description, on by default. render_categories_page() passes false and
     * renders its own larger, centered page heading instead — the two
     * aren't meant to ever show together, so this suppresses this one
     * rather than layering both. The per-state empty messages below (not
     * connected / no categories / no product categories) always render
     * regardless — they're informative either way, not a heading.
     *
     * $showGroups: the "Linked categories" / "Unlinked categories" h3s,
     * their counts, and "No categories linked yet..." — on by default (still
     * what render_categories_page() gets, where the split is the actual
     * content of an otherwise-heading-less page). render_onboarding_categories()
     * passes false: step 2's own page heading and subtext ("Describe Your
     * Garment type...") already say what to do, and on a first-ever run
     * every category starts Unlinked anyway, so the split reads as three
     * more redundant labels rather than useful information. false renders
     * every category — linked or not — as one flat grid instead, under a
     * bare "Categories" label (no icon, no count) — with $showHeading also
     * false in that same call, the grid otherwise had no label of any kind.
     */
    private static function render_category_mapping(Aivastra_Connection_Settings $settings, bool $wrapInCard = true, bool $showHeading = true, bool $showGroups = true): void
    {
        $widgetKey = $settings->get_widget_key();
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $widgetKey !== null ? $service->list_categories($widgetKey) : ['ok' => false, 'categories' => []];

        $terms = get_terms(['taxonomy' => 'product_cat', 'hide_empty' => false]);
        $productCategories = is_wp_error($terms) ? [] : $terms;
        $currentMap = $settings->get_category_map();

        // A term only counts as Linked once its stored slug still resolves to
        // a real Aivastra category — one deleted on the Aivastra side after
        // being mapped here falls back to Unlinked, same as never having been
        // mapped (matches Aivastra_Category_Mapping::resolve()'s own
        // null-if-not-currently-valid behavior on the storefront).
        $validSlugs = wp_list_pluck($result['categories'], 'slug');
        $linkedTerms = [];
        $unlinkedTerms = [];
        foreach ($productCategories as $term) {
            $mappedSlug = $currentMap[$term->term_id] ?? '';
            if ($mappedSlug !== '' && in_array($mappedSlug, $validSlugs, true)) {
                $linkedTerms[] = $term;
            } else {
                $unlinkedTerms[] = $term;
            }
        }
        ?>
        <?php if ($wrapInCard): ?><div class="aivastra-card aivastra-category-card"><?php endif; ?>
          <?php if ($showHeading): ?>
            <h2 class="aivastra-card-heading"><?php echo self::heading_icon('tag'); ?>Categories</h2>
          <?php endif; ?>
          <?php if (!$result['ok']): ?>
            <p class="aivastra-empty-state">Could not load your Ai Vastra categories right now — try reloading this page.</p>
          <?php elseif (empty($result['categories'])): ?>
            <p class="aivastra-empty-state">You don't have any try-on categories set up on your Ai Vastra account yet. The Try-On button won't show on any product until you add one and map it below.</p>
          <?php elseif (empty($productCategories)): ?>
            <p class="aivastra-empty-state">No WooCommerce product categories found — the Try-On button won't show on any product until its category is mapped below.</p>
          <?php else: ?>
            <?php if ($showHeading): ?>
              <p class="aivastra-card-description">Choose which try-on style each of your product categories should use. A category with no option selected won't show the Try-On button at all.</p>
            <?php endif; ?>
            <?php // No method/action — admin/assets/save-categories.js always
            // intercepts the submit and posts to admin-ajax.php instead, same
            // JS-only pattern as the embedded connect form above. The hidden
            // action field still carries the wp_ajax_* action name the JS
            // reads out, and wp_nonce_field()'s own _wpnonce input is what
            // check_ajax_referer() on the other end verifies. ?>
            <form id="aivastra-category-map-form" class="aivastra-form">
              <input type="hidden" name="action" value="aivastra_tryon_save_category_map">
              <?php wp_nonce_field('aivastra_tryon_save_category_map'); ?>

              <?php if ($showGroups): ?>
                <div class="aivastra-category-group">
                  <h3 class="aivastra-category-group-heading">Linked categories <span class="aivastra-category-group-count"><?php echo count($linkedTerms); ?></span></h3>
                  <?php if (empty($linkedTerms)): ?>
                    <p class="aivastra-empty-state">No categories linked yet — pick a try-on style below to link one.</p>
                  <?php else: ?>
                    <div class="aivastra-category-grid">
                      <?php foreach ($linkedTerms as $term): ?>
                        <?php self::render_category_tile($term, $result['categories'], $currentMap); ?>
                      <?php endforeach; ?>
                    </div>
                  <?php endif; ?>
                </div>

                <div class="aivastra-category-group">
                  <h3 class="aivastra-category-group-heading">Unlinked categories <span class="aivastra-category-group-count"><?php echo count($unlinkedTerms); ?></span></h3>
                  <?php if (empty($unlinkedTerms)): ?>
                    <p class="aivastra-empty-state">Every category is linked.</p>
                  <?php else: ?>
                    <div class="aivastra-category-grid">
                      <?php foreach ($unlinkedTerms as $term): ?>
                        <?php self::render_category_tile($term, $result['categories'], $currentMap); ?>
                      <?php endforeach; ?>
                    </div>
                  <?php endif; ?>
                </div>
              <?php else: ?>
                <?php // Just "Categories" — no icon, no count, no description (those
                // are what $showHeading/$showGroups suppress here). Without even
                // this much, the grid below sat with no label of any kind, and a
                // merchant new to the plugin had no cue these tiles are their
                // WooCommerce product categories rather than something else. ?>
                <h3 class="aivastra-category-group-heading">Categories</h3>
                <div class="aivastra-category-grid">
                  <?php foreach ($productCategories as $term): ?>
                    <?php self::render_category_tile($term, $result['categories'], $currentMap); ?>
                  <?php endforeach; ?>
                </div>
              <?php endif; ?>

              <div class="aivastra-save-row">
                <button type="submit" id="aivastra-category-map-submit" class="aivastra-btn aivastra-btn-primary">Save categories</button>
                <span class="aivastra-refresh-confirm" id="aivastra-category-map-confirm" aria-live="polite"></span>
              </div>
            </form>
          <?php endif; ?>
        <?php if ($wrapInCard): ?></div><?php endif; ?>
        <?php
    }

    /**
     * One tile — shared between the Linked and Unlinked groups above, which
     * differ only in which categories they pass in, not in how a tile
     * itself renders. Changing the select and saving is what moves a
     * category between the two groups (re-evaluated from $currentMap on the
     * next page load, not tracked client-side).
     *
     * @param array<int, array{slug:string,name:string}> $aivastraCategories
     * @param array<int, string> $currentMap
     */
    private static function render_category_tile(WP_Term $term, array $aivastraCategories, array $currentMap): void
    {
        $mappedSlug = $currentMap[$term->term_id] ?? '';
        ?>
        <div class="aivastra-category-tile">
          <span class="aivastra-category-tile-icon"><?php echo self::icon('tag'); ?></span>
          <label for="aivastra-cat-map-<?php echo esc_attr($term->term_id); ?>" class="aivastra-category-tile-name"><?php echo esc_html($term->name); ?></label>
          <select id="aivastra-cat-map-<?php echo esc_attr($term->term_id); ?>" name="aivastra_category_map[<?php echo esc_attr($term->term_id); ?>]" class="aivastra-select">
            <option value="">No option selected</option>
            <?php foreach ($aivastraCategories as $cat): ?>
              <option value="<?php echo esc_attr($cat['slug']); ?>" <?php selected($mappedSlug, $cat['slug']); ?>>
                <?php echo esc_html($cat['name']); ?>
              </option>
            <?php endforeach; ?>
          </select>
        </div>
        <?php
    }
}
