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
    // etc. — all run as PHP wp_remote_post() calls inside the WordPress
    // container's own network namespace). For local development against
    // `pnpm --filter @aivastra/api dev` (port 4000), override this to reach
    // the host from inside the container, NOT `localhost` (that's the
    // container itself). `host.docker.internal` only resolves if local-wp's
    // compose file sets `extra_hosts: host.docker.internal: host-gateway` —
    // it doesn't by default (Docker Desktop adds it automatically; plain
    // Docker Engine on Linux doesn't). Verified working alternative: the
    // docker bridge gateway IP, e.g. 'http://172.19.0.1:4000' — get the
    // actual value via `docker network inspect local-wp_default` (or `docker
    // inspect local-wp-wordpress-1 --format '{{json .NetworkSettings.Networks}}'`),
    // it can differ per machine/network recreation. Public: Aivastra_Checkout_Ajax
    // (includes/class-checkout-ajax.php) needs the same base URL and has no
    // other way to reach it. See BROWSER_API_BASE below for the
    // browser-facing counterpart this constant used to also cover — they
    // diverge in local dev, which is why Google sign-in specifically needs
    // that one instead.
    //
    // For local development against `pnpm --filter @aivastra/api dev` (port
    // 4000), override this to local-wp's own docker bridge gateway IP (e.g.
    // 'http://172.20.0.1:4000', confirmed reachable from inside
    // local-wp-wordpress-1 via `docker network inspect local-wp_default`) so
    // handle_connect_callback()'s exchange_connect_code() — a PHP
    // wp_remote_post() running inside this container — reaches the SAME
    // local api/redis instance that google.routes.ts's skip-path minted the
    // one-time code in. Pointing this at production while BROWSER_API_BASE
    // points at localhost is what silently breaks the flow: the code only
    // ever existed in local Redis, so production's
    // /v1/wordpress/connect/exchange 400s on it, exchange_connect_code()
    // returns ok:false, and render_connect_popup_close() falls back to the
    // plain admin.php redirect with aivastra_error set — which looks like
    // nothing happened beyond a reload back to the connect step. Never leave
    // this overridden in a commit/push — it must read 'https://app.aivastra.com'
    // in anything that reaches production.
    public const API_BASE = 'https://app.aivastra.com';

    // The browser-facing counterpart to API_BASE above — every URL this
    // class hands to the browser itself rather than calling server-to-server:
    // handle_connect_start()'s Google-init redirect, and the plain `<a href>`
    // links to /register, /forgot-password and /developers. Same value as
    // API_BASE in production (one host), but they diverge locally: a browser
    // on the HOST machine can't resolve the docker-gateway address
    // API_BASE needs there. For local development, override this to
    // 'http://localhost:4000' — plain `localhost`, since this one never runs
    // inside the WordPress container. Google sign-in specifically also needs
    // GOOGLE_CALLBACK_URL in .env to already be
    // 'http://localhost:4000/v1/auth/google/callback' (it is, by default) —
    // the Google-init redirect must share that exact host or the API's
    // google_state/google_next cookies set during /v1/auth/google/init never
    // reach the /v1/auth/google/callback request that reads them back. Never
    // leave this overridden in a commit/push, or production's Google button
    // and register/forgot-password/developers links start pointing at a
    // developer's own machine.
    public const BROWSER_API_BASE = 'https://app.aivastra.com';

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
    // URL stops showing that step and moves on to Step 3
    // (render_onboarding_button()) instead of re-showing it. Deleted by
    // uninstall.php alongside the rest of the plugin's options. Public:
    // Aivastra_Category_Map_Ajax (includes/class-category-map-ajax.php) needs
    // it too, same cross-class reason API_BASE is public.
    public const CATEGORIES_DONE_OPTION_KEY = 'aivastra_tryon_categories_done';

    // Set once a merchant finishes or skips the onboarding wizard's Step 3
    // (button customization — render_onboarding_button()), the last step, so
    // the bare page URL stops showing the wizard entirely and goes straight
    // to the dashboard. Deleted by uninstall.php alongside the rest of the
    // plugin's options.
    public const ONBOARDING_DONE_OPTION_KEY = 'aivastra_tryon_onboarding_done';

    // Step labels for the onboarding wizard's progress row, in order — read
    // by render_progress_steps() so every step's number and the total stay
    // in sync with this one list.
    private const ONBOARDING_STEPS = ['Connect account', 'Categories & Funnels', 'Customize button'];

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
        'activity' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
        'gift' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8"/><path d="M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8"/></svg>',
        'mail' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
        'lock' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
        'eye' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
        'eye-off' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>',
    ];

    // Google's own multi-colour "G" mark (not a lucide icon, so it lives
    // outside ICONS above — that array's single-colour stroke="currentColor"
    // convention doesn't apply to a fixed-brand-colour logo). Same artwork
    // Google's own sign-in button guidelines ship.
    private const GOOGLE_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>';

    // WordPress-only display-name override, at the merchant's request — GET
    // /v1/dev/plans's own `name`/`slug`/price/credits/badge stay exactly as
    // the API returns them (unchanged here, unchanged in the app and
    // Shopify); only the heading text shown on this card is swapped, matched
    // by plan position. If the account ever has more than four active plans,
    // render_plans() falls back to the plan's real API name for the extra
    // ones rather than mislabelling them. Icon/subtext/feature-list fields
    // this array used to carry were dropped along with the tile elements
    // that rendered them — see render_plans()'s own doc comment for why
    // (apps/shopify/src/components/PackGrid.tsx, the tile this was
    // redesigned to match exactly, has none of those elements either).
    private const PLAN_META = [
        ['name' => 'Silver'],
        ['name' => 'Gold'],
        ['name' => 'Platinum'],
        ['name' => 'Diamond'],
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
     * Loads the admin-only stylesheet, scoped to just this plugin's screens.
     * Gated on $_GET['page'] rather than the $hookSuffix argument — WordPress
     * derives a submenu's hook suffix from $admin_page_hooks[$parent], which
     * register_menu()'s add_menu_page() call sets to
     * sanitize_title($menu_title) (the sidebar label "Ai Vastra", → "ai-vastra"),
     * not the menu slug ("aivastra-tryon") — so the submenus' real hook
     * suffixes are "ai-vastra_page_aivastra-tryon-manage" etc., not the more
     * intuitive-looking "{parent_slug}_page_{menu_slug}" this method first
     * (incorrectly) assumed, which silently skipped loading assets on those
     * pages. $_GET['page'] sidesteps that WP-internal naming entirely — same
     * value add_menu_page()/add_submenu_page() were given as $menu_slug.
     */
    public static function enqueue_assets(string $hookSuffix): void
    {
        $pluginPages = [
            'aivastra-tryon',
            'aivastra-tryon-manage',
            'aivastra-tryon-analytics',
            'aivastra-tryon-billing',
            'aivastra-tryon-customize',
            'aivastra-tryon-support',
        ];
        if (!in_array($_GET['page'] ?? '', $pluginPages, true)) {
            return;
        }
        // Same Google Fonts URL apps/shopify/index.html loads for its own
        // AppFont.tsx override (see that file's own comment) — this is what
        // actually makes "Public Sans" in settings-page.css's font-family
        // render as that typeface instead of silently falling through to the
        // next stack entry; enqueuing only the weights (400/500/600/700) that
        // stack's own numeric font-weight values (450/550/650/700) resolve to.
        wp_enqueue_style(
            'aivastra-tryon-public-sans',
            'https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&display=swap',
            [],
            null
        );
        wp_enqueue_style(
            'aivastra-tryon-settings',
            AIVASTRA_TRYON_URL . 'admin/assets/settings-page.css',
            ['aivastra-tryon-public-sans'],
            AIVASTRA_TRYON_VERSION . '.' . filemtime(AIVASTRA_TRYON_DIR . 'admin/assets/settings-page.css')
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
        // No nonce here — the form's own wp_nonce_field() (render_category_routing_table())
        // already carries it as _wpnonce, read straight out via FormData the
        // same way the rest of that form's fields are.
        wp_localize_script('aivastra-tryon-save-categories', 'aivastraSaveCategories', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
        ]);
        wp_enqueue_script(
            'aivastra-tryon-product-eligibility',
            AIVASTRA_TRYON_URL . 'admin/assets/product-eligibility.js',
            [],
            AIVASTRA_TRYON_VERSION,
            true
        );
        wp_localize_script('aivastra-tryon-product-eligibility', 'aivastraProductEligibility', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce(Aivastra_Product_Eligibility_Ajax::NONCE_ACTION),
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
     *
     * The explicit add_submenu_page() calls below turn the single item into a
     * real sidebar flyout — WordPress always renders one once a top-level
     * page has more than one submenu, no extra markup needed. There is no
     * visible "Dashboard" row in that flyout — the top-level "Ai Vastra"
     * label/icon itself opens the dashboard — but the FIRST add_submenu_page()
     * call below still registers one anyway, reusing the parent's own slug
     * ('aivastra-tryon') the same standard WP convention WooCommerce uses for
     * its "Home" row. This isn't decorative: WordPress's _wp_menu_output()
     * (wp-admin/menu-header.php) hardcodes the top-level link's own href to
     * `admin.php?page={first registered submenu's slug}` whenever a top-level
     * item has ANY submenu at all — never to the top-level's own registered
     * page — so without a first entry sharing the parent's slug, clicking
     * "Ai Vastra" would silently open whichever page happens to be registered
     * first (Manage) instead of the dashboard. Registering it first with the
     * same slug also means add_submenu_page()'s own "auto-insert a link back
     * to the parent" behavior (wp-admin/includes/plugin.php) never fires,
     * since that only triggers when the first child's slug differs from the
     * parent's — so there is exactly one such entry, not two. It's hidden
     * from the rendered flyout via the `.wp-submenu-head + li` rule in
     * settings-page.css (targeting it by position — it's always the first
     * item right after the flyout's own heading row — not by slug, since CSS
     * can't select on an href's query string reliably across browsers);
     * hiding it this way, rather than skipping its registration, is what
     * keeps it "current" (and so correctly un-bolds every visible row) when a
     * merchant is actually on the dashboard, instead of WordPress falling
     * back to bolding the first *visible* row (Manage) as current, which is
     * what happened when this used remove_submenu_page() instead. Every
     * other entry gets its own slug/callback — render_manage() (product
     * category mapping), render_analytics(), the render_billing() alias for
     * the existing Plans & Credits page, render_customize() (try-on button
     * appearance) and render_support_submenu() — each gated through
     * render_gated() exactly like the dashboard, so a merchant who hits any
     * of their URLs directly (sidebar click, bookmark) before connecting
     * still sees the welcome/connect/onboarding flow first.
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
        add_submenu_page(
            'aivastra-tryon',
            'Ai Vastra Dashboard',
            'Dashboard',
            'manage_woocommerce',
            'aivastra-tryon',
            [self::class, 'render']
        );
        add_submenu_page(
            'aivastra-tryon',
            'Manage Products',
            'Manage',
            'manage_woocommerce',
            'aivastra-tryon-manage',
            [self::class, 'render_manage']
        );
        add_submenu_page(
            'aivastra-tryon',
            'Ai Vastra Analytics',
            'Analytics',
            'manage_woocommerce',
            'aivastra-tryon-analytics',
            [self::class, 'render_analytics']
        );
        add_submenu_page(
            'aivastra-tryon',
            'Plans & Credits',
            'Billing',
            'manage_woocommerce',
            'aivastra-tryon-billing',
            [self::class, 'render_billing']
        );
        add_submenu_page(
            'aivastra-tryon',
            'Customize Try-On Button',
            'Customize',
            'manage_woocommerce',
            'aivastra-tryon-customize',
            [self::class, 'render_customize']
        );
        add_submenu_page(
            'aivastra-tryon',
            'Ai Vastra Support',
            'Support',
            'manage_woocommerce',
            'aivastra-tryon-support',
            [self::class, 'render_support_submenu']
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
     * branded /login form. Google requires an exact-match registered
     * redirect URI (GOOGLE_CALLBACK_URL, fixed to api.aivastra.com) — it can
     * never redirect straight into a WordPress site's admin-post.php — so
     * this still has to bounce through our own domain once; what changed
     * from the previous version of this method is skipping our own login
     * page on the way there, not the number of hops. `next` is this same
     * plugin's own /connect/wordpress?state=&site_url=&site_name=&redirect_uri=
     * URL, round-tripped through /v1/auth/google/init as an opaque,
     * re-encoded query value — but apps/api/src/modules/auth/google.routes.ts's
     * own callback now reads that `next` directly and completes the connect
     * server-to-server itself whenever it can, so the browser usually never
     * actually lands on that consent page at all; it's kept in this exact
     * shape purely as the fallback for when that skip-path can't finish
     * (see that file's own doc comment for when). wp_redirect() (not
     * wp_safe_redirect()) is correct here — the target is built from the
     * fixed, plugin-controlled BROWSER_API_BASE constant, not user input, so
     * there is nothing for the allowed-hosts check to guard against.
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
        ], self::BROWSER_API_BASE . '/v1/auth/google/init');

        wp_redirect($googleInitUrl);
        exit;
    }

    /**
     * Step 2: the browser lands back here from app.aivastra.com with either
     * `code` (approved) or `error=access_denied` (the admin clicked Cancel
     * on the consent screen). The transient is the only thing authenticating
     * this request — there is no nonce, since app.aivastra.com's redirect is
     * cross-site and carries no WordPress session.
     *
     * No wp_safe_redirect() straight to admin.php any more — "Continue with
     * Google" now submits with target="_blank" (render_connect_form()'s own
     * doc comment) rather than navigating wp-admin's own tab away (the
     * merchant's original complaint: "it is going to another page... out
     * from the plugin"; a sized window.open() popup was tried first, but the
     * merchant asked for a plain tab instead), so landing here is now almost
     * always inside that new tab, not the main one. Ending with a full
     * admin.php page load would just render the entire wp-admin dashboard
     * inside that extra tab. render_connect_popup_close() instead posts the
     * result back to window.opener and closes the tab, and falls back to the
     * exact same admin.php redirect this method always did if there's no
     * reachable opener (popup/tab blocked, or this somehow loaded in the
     * main tab directly).
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

        self::render_connect_popup_close(
            isset($redirectArgs['aivastra_connected']),
            add_query_arg($redirectArgs, admin_url('admin.php'))
        );
    }

    /**
     * Lands here from Google's consent screen inside the new tab "Continue
     * with Google" opens (target="_blank" on its form, render_connect_form()'s
     * own doc comment), not the main wp-admin tab. If window.opener is
     * reachable — the normal case, since this URL is this same site's own
     * admin-post.php, same-origin with the tab that opened this one, and no
     * rel="noopener" is set anywhere in the chain — this posts the result
     * back and closes the tab; connect.js's message listener then reloads
     * the opener so it re-renders the now-connected dashboard, the same
     * outcome the old full-tab redirect produced, just without ever
     * navigating wp-admin's main tab away to get there. If window.opener
     * isn't reachable (popup blocker, or this somehow loaded in the main tab
     * directly), this falls back to $fallbackUrl — the exact same admin.php
     * redirect this method always did before.
     */
    private static function render_connect_popup_close(bool $connected, string $fallbackUrl): void
    {
        ?>
        <!doctype html>
        <html>
        <head><meta charset="utf-8"><title>Ai Vastra</title></head>
        <body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#303030;text-align:center;padding:24px;box-sizing:border-box;">
          <p><?php echo $connected ? esc_html('Connected! This tab will close automatically.') : esc_html('Could not connect. This tab will close automatically — please try again.'); ?></p>
          <script>
            (function () {
              try {
                if (window.opener && !window.opener.closed) {
                  window.opener.postMessage({ aivastraConnected: <?php echo $connected ? 'true' : 'false'; ?> }, window.location.origin);
                  window.close();
                  return;
                }
              } catch (e) {}
              window.location.href = <?php echo wp_json_encode($fallbackUrl); ?>;
            })();
          </script>
        </body>
        </html>
        <?php
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
     * Also deletes both onboarding wp_options — CATEGORIES_DONE_OPTION_KEY
     * (step 2) and ONBOARDING_DONE_OPTION_KEY (the whole 3-step wizard) —
     * neither of which Aivastra_Connection_Settings::clear() touches.
     * Deleting only one of the two (as this method used to) is its own bug:
     * a merchant who reconnects (same account or a different one) with
     * CATEGORIES_DONE_OPTION_KEY still '1' from before has
     * should_show_categories_step() report "already done" while
     * should_show_button_step() reports "not done yet" — landing the
     * reconnect straight on step 3, silently skipping step 2
     * (categories/funnels) entirely, because that flag survived the
     * disconnect. Contradicts this very method's own doc comment above
     * ("a fresh connect afterward could be a different aivastra account...
     * a stale mapping must not survive a disconnect") — both onboarding-done
     * flags are exactly that kind of stale state and need to go too.
     */
    public static function handle_disconnect(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_disconnect');

        (new Aivastra_Connection_Settings())->clear();
        delete_option(self::CATEGORIES_DONE_OPTION_KEY);
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
     * "Skip for now" on the onboarding wizard's Step 2 or Step 3 — a
     * merchant who isn't ready to map categories, or doesn't want to touch
     * the button's appearance, yet needs a way off that step without being
     * forced to fill it in first. Both steps' skip links post to this same
     * handler/nonce; which one fired is read off state rather than a
     * separate param, same idea as Aivastra_Category_Map_Ajax::handle()'s own
     * $wasOnboarding check. Step 2 not yet done → this was that step's skip,
     * so only CATEGORIES_DONE_OPTION_KEY advances (the wizard moves on to
     * Step 3, it doesn't end). Step 2 already done → this was Step 3's skip,
     * so ONBOARDING_DONE_OPTION_KEY also gets set, ending the wizard. No
     * `section` query arg on the redirect (unlike before Step 3 existed) —
     * that was an escape hatch that would skip Step 3 too; the persisted
     * flags alone now decide which step, if any, shows next.
     */
    public static function handle_skip_onboarding(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_skip_onboarding');

        if (get_option(self::CATEGORIES_DONE_OPTION_KEY) !== '1') {
            update_option(self::CATEGORIES_DONE_OPTION_KEY, '1', false);
        } else {
            update_option(self::ONBOARDING_DONE_OPTION_KEY, '1', false);
        }

        wp_safe_redirect(add_query_arg(['page' => 'aivastra-tryon'], admin_url('admin.php')));
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
                ['page' => 'aivastra-tryon-billing', 'aivastra_error' => $result['error'] ?? 'unknown'],
                admin_url('admin.php')
            ));
            exit;
        }

        set_transient('aivastra_tryon_checkout_' . get_current_user_id(), $result, 15 * MINUTE_IN_SECONDS);

        wp_safe_redirect(add_query_arg(
            ['page' => 'aivastra-tryon-billing', 'aivastra_checkout' => '1'],
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

        // Step 3 of onboarding (render_onboarding_button()) posts to this
        // same handler/nonce as the standalone Customize page — captured
        // before the option write below, same "was this the step that
        // completes the wizard" idea as Aivastra_Category_Map_Ajax::handle()'s
        // own $wasOnboarding, just via a real redirect since this form isn't
        // AJAX. Completing it finishes the wizard outright (there's no
        // further step to land on), so this lands on the dashboard instead of
        // back on Customize.
        $wasOnboarding = get_option(self::CATEGORIES_DONE_OPTION_KEY) === '1'
            && get_option(self::ONBOARDING_DONE_OPTION_KEY) !== '1';
        if ($wasOnboarding) {
            update_option(self::ONBOARDING_DONE_OPTION_KEY, '1', false);
            wp_safe_redirect(add_query_arg(['page' => 'aivastra-tryon'], admin_url('admin.php')));
            exit;
        }

        wp_safe_redirect(add_query_arg(
            ['page' => 'aivastra-tryon-customize', 'aivastra_widget_saved' => '1'],
            admin_url('admin.php')
        ));
        exit;
    }

    private static function icon(string $name): string
    {
        return self::ICONS[$name] ?? '';
    }

    private static function google_icon(): string
    {
        return self::GOOGLE_ICON;
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
     * Activity chart — a smooth line in place of a plain bar chart, at the
     * merchant's original request to match a reference dashboard screenshot
     * (big headline number, uppercase axis label, gridlines with a numeric
     * y-axis). Used to sit on the Dashboard; moved to the standalone
     * Analytics page (render_analytics_card()) at a later request, replacing
     * that page's own plainer bar-chart rendering of the same $daily rows —
     * see render_dashboard()'s own doc comment for why. Deliberately its own
     * self-contained 14-day window (ANALYTICS_DAILY_WINDOW_DAYS server-side)
     * rather than mixing in the stat tiles' 30-day cards.tryOns total —
     * those are two different windows from the same GET /v1/dev/analytics
     * call, and labelling this card's headline number with the 30-day total
     * while the line below it only covers 14 days would silently misstate
     * what the chart shows. No period-over-period change badge (the
     * reference screenshot has one) since the API returns one window, not a
     * comparison to a prior one — nothing here to compute that from
     * honestly. No date-range picker either, since the window is fixed
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
     * Shopper journey funnel — horizontal bar per step, ported from
     * apps/shopify/src/components/BarChart.tsx's horizontal orientation
     * (bar capped at 70% of row width, 4px corner radius, "{count} ·
     * {label}" drawn to the right of the bar) since that's the exact shape
     * on the merchant's reference screenshot. Plain percentage-geometry SVG,
     * no charting dependency — same reasoning as render_activity_chart()'s
     * own hand-rolled line chart.
     *
     * Steps 1, 2, 4 and 5 are advisory, client-reported
     * merchant_widget_events counts (see GET /v1/dev/analytics's own doc
     * comment) and can undercount if a shopper's browser blocks that
     * request; "Generated a try-on" (step 3) is the one real, unforgeable
     * number, drawn from the jobs table — so unlike a strict funnel, a later
     * step can show a higher count than an earlier one. No "unattributed
     * try-ons" footnote (apps/shopify's funnel has one): that exists there
     * only because Shopify can tell *which* jobs failed to join to a
     * shopper row; the WordPress dev-API has no shopper-identity join to
     * fail in the first place, so there is nothing to subtract from.
     *
     * @param array{buttonClick:int,upload:int,tryOn:int,resultView:int,addToCart:int} $funnel
     */
    private static function render_funnel_chart(array $funnel): void
    {
        $steps = [
            ['label' => 'Clicked try-on', 'value' => (int) $funnel['buttonClick']],
            ['label' => 'Uploaded a photo', 'value' => (int) $funnel['upload']],
            ['label' => 'Generated a try-on', 'value' => (int) $funnel['tryOn']],
            ['label' => 'Viewed the result', 'value' => (int) $funnel['resultView']],
            ['label' => 'Added to cart', 'value' => (int) $funnel['addToCart']],
        ];
        $max = 1;
        foreach ($steps as $s) {
            $max = max($max, $s['value']);
        }
        $rowHeight = 34;
        $svgHeight = count($steps) * $rowHeight;
        ?>
        <div class="aivastra-card aivastra-funnel-card">
          <h2 class="aivastra-card-heading"><?php echo self::heading_icon('activity'); ?>Shopper journey</h2>
          <svg class="aivastra-funnel-svg" width="100%" height="<?php echo (int) $svgHeight; ?>" role="img" aria-label="Shopper journey by step">
            <?php foreach ($steps as $i => $s): ?>
              <?php $barWidth = round(($s['value'] / $max) * 70, 2); ?>
              <rect x="0" y="<?php echo esc_attr((string) ($i * $rowHeight + 6)); ?>" width="<?php echo esc_attr((string) $barWidth); ?>%" height="<?php echo esc_attr((string) ($rowHeight - 14)); ?>" rx="4" class="aivastra-funnel-bar" />
              <text x="72%" y="<?php echo esc_attr((string) ($i * $rowHeight + $rowHeight / 2 + 4)); ?>" class="aivastra-funnel-label"><?php echo esc_html(number_format_i18n($s['value']) . ' · ' . $s['label']); ?></text>
            <?php endforeach; ?>
          </svg>
          <p class="aivastra-card-description aivastra-funnel-note">Steps 1, 2, 4 and 5 are measured in the shopper's browser and can be blocked. Try-ons are measured on our servers and are exact — so a later step can show more shoppers than an earlier one.</p>
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
            <?php // Cloned from apps/catalogues-web's own /login page at the
            // merchant's explicit request — same split as that page's own
            // .auth-card: form column left, a photo panel with a gradient-
            // anchored headline right (the merchant asked for this back after
            // an earlier pass of this step dropped it), no surrounding
            // topbar/progress-steps chrome either way. render_onboarding_connect()
            // is what dropped the topbar/steps above this; see its own doc
            // comment. ?>
            <div class="aivastra-connect-card">
              <div class="aivastra-connect-card-form">
                <div class="aivastra-logo-row">
                  <img src="<?php echo esc_url(AIVASTRA_TRYON_URL . 'admin/assets/images/logo.svg'); ?>" alt="" class="aivastra-logo-mark">
                  <img src="<?php echo esc_url(AIVASTRA_TRYON_URL . 'admin/assets/images/logo-text.svg'); ?>" alt="Ai Vastra" class="aivastra-logo-text">
                </div>
                <div class="aivastra-connect-card-heading">
                  <h1>Welcome Back</h1>
                  <?php // 100 — same static fallback apps/catalogues-web's own
                  // /login page defaults to before its live GET /v1/config/free-plan
                  // fetch resolves. That fetch isn't repeated here: it's a
                  // cross-origin call from the merchant's own site to
                  // app.aivastra.com, and CORS there (apps/api/src/server.ts)
                  // only allows Shopify origins and origins already on an
                  // established store/api-key record — neither exists yet at
                  // this unauthenticated step, so the request would just fail
                  // silently every time rather than ever showing a live number. ?>
                  <p class="aivastra-connect-perk"><?php echo self::icon('gift'); ?> Get 100 Free credits to start.</p>
                </div>
                <?php self::render_connect_form(false); ?>
              </div>
              <?php // welcome-result.jpg — the same "finished try-on" photo the
              // intro page's third card already uses, so this step's payoff
              // image stays consistent with what the merchant already saw one
              // click earlier rather than introducing a new asset. ?>
              <div class="aivastra-connect-card-photo">
                <img src="<?php echo esc_url(AIVASTRA_TRYON_URL . 'admin/assets/images/welcome-result.jpg'); ?>" alt="" width="1080" height="1440">
                <div class="aivastra-connect-card-overlay"></div>
                <div class="aivastra-connect-card-caption">
                  <h3>Turn product photos into real try-ons</h3>
                  <p>Let shoppers see themselves in your products with AI-generated model photos — no photoshoot required.</p>
                </div>
              </div>
            </div>
            <?php
            return;
        }

        $credits = $settings->get_credits();
        $creditsAsOf = $settings->get_credits_as_of();

        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $balanceSummary = $service->get_balance_summary($dailyRows);
        $tryOnsRemaining = $balanceSummary['ok'] ? $balanceSummary['tryOnsRemaining'] : null;
        // Prefer the live value (this request's own GET /v1/dev/me, via
        // get_balance_summary()) over the persisted snapshot — same
        // freshness reasoning as $tryOnsRemaining above. Falls back to the
        // persisted flag (Aivastra_Connection_Settings::get_unlimited())
        // only when that live call itself failed, same as $creditsAsOf's own
        // fallback below.
        $unlimited = $balanceSummary['ok'] ? $balanceSummary['unlimited'] : $settings->get_unlimited();
        ?>
        <div class="aivastra-card aivastra-status-card">
          <?php // Connected badge, "User: {name}" tag, "Update connection keys"
          // reveal and the Disconnect button that used to sit here as
          // .aivastra-status-top were removed at the merchant's request — the
          // badge/user tag were pure status noise once Logout (this form's exact
          // same handle_disconnect() action/nonce, just relabelled) lives in the
          // navbar's "..." menu (render_navbar()) on every connected page, and
          // "Update connection keys" has no replacement: reconnecting with
          // different credentials now means Logout, then the normal connect form. ?>
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
            <?php // $unlimited merchants aren't metered against a credit balance at
            // all — showing the raw number (which still exists and still moves
            // on actual usage under the hood) read as a confusingly low,
            // about-to-run-out balance on an account that in fact can't run
            // out. "Unlimited" replaces it outright rather than showing both. ?>
            <?php if ($unlimited): ?>
              <span class="aivastra-credit-number" id="aivastra-credit-number">Unlimited</span>
            <?php else: ?>
              <span class="aivastra-credit-number" id="aivastra-credit-number"><?php echo esc_html(number_format_i18n((int) $credits)); ?></span>
            <?php endif; ?>
          </div>
          <?php // tryOnsRemaining is real (get_balance_summary()) — a Aivastra_Connection_Service::get_balance_summary() error (stale connection, API hiccup) is the only time this falls back to the plain last-checked timestamp, same text this line always showed before. No "roughly N days at your current rate" any more — the average-per-day arithmetic behind it (get_balance_summary()'s own daysRemaining) produces a wildly large, not-useful number for a low-usage store (tens of thousands of days), at the merchant's request. ?>
          <p class="aivastra-credit-meta" id="aivastra-credit-meta">
            <?php if ($unlimited): ?>
              You're on an unlimited plan — try-ons aren't metered against a credit balance.
            <?php elseif ($tryOnsRemaining !== null): ?>
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
        return $connected && !isset($_GET['section']) && get_option(self::CATEGORIES_DONE_OPTION_KEY) !== '1';
    }

    /**
     * Step 3 of the wizard (render_onboarding_button()) — same shape as
     * should_show_categories_step() just one flag further along: only once
     * Step 2 is done (CATEGORIES_DONE_OPTION_KEY) and before the wizard as a
     * whole is (ONBOARDING_DONE_OPTION_KEY, set by either saving the widget
     * appearance form — handle_save_widget_customization() — or skipping —
     * handle_skip_onboarding()).
     */
    public static function should_show_button_step(bool $connected): bool
    {
        return $connected
            && !isset($_GET['section'])
            && get_option(self::CATEGORIES_DONE_OPTION_KEY) === '1'
            && get_option(self::ONBOARDING_DONE_OPTION_KEY) !== '1';
    }

    public static function render(): void
    {
        self::render_gated([self::class, 'render_dashboard_page']);
    }

    /**
     * Manage submenu (register_menu()) — product category mapping, the same
     * page previously reachable only via the Products card's "Manage" stat
     * tile (render_products_overview()).
     */
    public static function render_manage(): void
    {
        self::render_gated([self::class, 'render_categories_page']);
    }

    /**
     * Analytics submenu (register_menu()) — the stat-tile grid, try-ons bar
     * chart and Top Products table (render_analytics_card()), previously
     * built but unused dead code from before the dashboard was flattened.
     * Its own standalone page, same shape as Manage/Customize.
     */
    public static function render_analytics(): void
    {
        self::render_gated([self::class, 'render_analytics_page']);
    }

    /**
     * Billing submenu (register_menu()) — a direct-slug alias onto the
     * existing Plans & Credits page (render_plans_page()), which was already
     * built and reachable via ?page=aivastra-tryon&section=plans
     * (render_gated()'s own section=plans short-circuit below, still kept
     * for handle_buy()'s legacy redirect targets and any existing bookmark).
     * This gives it a proper sidebar row and a clean URL the same way Manage
     * and Customize have one, without duplicating render_plans_page() itself.
     */
    public static function render_billing(): void
    {
        self::render_gated([self::class, 'render_plans_page']);
    }

    /**
     * Customize submenu (register_menu()) — the try-on button's appearance
     * form, previously stacked inline on the one-page dashboard
     * (render_dashboard()'s doc comment), now its own page the same way
     * Categories and Plans already were.
     */
    public static function render_customize(): void
    {
        self::render_gated([self::class, 'render_customize_page']);
    }

    /**
     * Support submenu (register_menu()) — the same two-channel contact card
     * (render_support_card()) that still also shows inline at the bottom of
     * the Dashboard page (render_dashboard()) — duplicated here, not moved,
     * since a merchant looking for help may not scroll the whole dashboard
     * first, and the existing render_dashboard() flow isn't being disturbed.
     */
    public static function render_support_submenu(): void
    {
        self::render_gated([self::class, 'render_support_page']);
    }

    /**
     * Shared entry gate for every sidebar submenu page (Manage, Analytics,
     * Billing, Customize, Support) and the dashboard itself — the welcome
     * screen, the connect step, and the mandatory categories and button-
     * customization onboarding steps all have to come before any one of
     * them, not just the dashboard, since a merchant can land on any
     * submenu's URL directly (sidebar click, bookmark) before ever
     * connecting. $contentRenderer is only called once every gate is clear,
     * and is responsible for its own full page markup (wrap, chrome, chat
     * modal) — render_dashboard_page(), render_categories_page(),
     * render_analytics_page(), render_plans_page(), render_customize_page()
     * and render_support_page() already are, each independently, the same
     * shape should_show_intro()/render_onboarding_connect()/
     * render_onboarding_categories()/render_onboarding_button() are below.
     */
    private static function render_gated(callable $contentRenderer): void
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
        if (self::should_show_button_step($connected)) {
            self::render_onboarding_button($settings);
            return;
        }
        if (($_GET['section'] ?? '') === 'plans') {
            self::render_plans_page($settings);
            return;
        }
        $contentRenderer($settings);
    }

    /**
     * The top-level "Ai Vastra" sidebar label/icon's own page (register()) —
     * no separate "Dashboard" submenu row (register_menu()'s doc comment).
     * One-page overview: Connection, Try-On Activity chart, Products
     * overview, Support.
     *
     * Same wrap/navbar/.aivastra-page-flat-body shape as every other
     * connected page now (render_categories_page() et al) — this page used
     * to carry its own .aivastra-dashboard-flat padding directly on the wrap
     * instead, back when render_app_header() (not render_navbar()) sat
     * inside that padding deliberately. render_navbar() must sit flush
     * against the content area's edges on every page, Dashboard included, so
     * this page's own content now gets its padding from
     * .aivastra-page-flat-body like the rest, and .aivastra-dashboard-flat
     * (dead now — no page still carries it) was removed. No boxed white
     * panel around this page (or any other page in the plugin — see
     * render_onboarding_connect(), render_onboarding_categories(),
     * render_categories_page(), render_plans_page(), render_intro()) — a
     * fixed-height, internally-scrolling panel used to wrap every one of
     * them, which produced a second scrollbar nested inside wp-admin's own
     * page scrollbar the moment a page's content ran past its calc()'d
     * height. This page in particular (by far the most content of any page
     * here) hit that routinely, not as an edge case. Every page instead
     * flows directly in wp-admin's own body now — one scrollbar.
     */
    private static function render_dashboard_page(Aivastra_Connection_Settings $settings): void
    {
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-dashboard-wrap">
          <?php self::render_navbar(); ?>

          <div class="aivastra-page-flat-body">
            <?php self::render_notices(); ?>

            <?php self::render_dashboard($settings); ?>
          </div>
        </div>

        <?php self::render_chat_modal(); ?>
        <?php
    }

    /**
     * The persistent top bar shared by every connected page (Dashboard,
     * Manage, Analytics, Billing, Customize, Support) — logo left, a single
     * "..." icon button right opening Email us/Start a chat/Help &
     * documentation. Modelled on a reference dashboard's navbar the merchant
     * supplied screenshots of, which uses exactly this one-button shape.
     * Replaces two header variants that used to diverge per page: the old
     * render_app_header() (Dashboard only — logo + version pill, a labeled
     * "Get Support" button, and a separate circular "?" link to the docs)
     * and render_onboarding_topbar() called with no $backUrl everywhere else
     * (logo + a labeled "Support" button, no docs link at all). The version
     * pill and the Back link are both dropped — neither appears on the
     * reference navbar, and Back is redundant with the sidebar now that
     * every page has its own entry there. render_onboarding_topbar() itself
     * is untouched and still used, unchanged, by the two onboarding-only
     * steps that need its $backUrl/$showAdvanced options
     * (render_onboarding_connect(), render_onboarding_categories()).
     * Reuses .aivastra-topbar-support's own <details>/dropdown mechanics —
     * support-chat.js's outside-click/Escape close and "Start a chat"
     * handling both target that class generically — only the trigger's look
     * changes, via the added .aivastra-navbar-more modifier class.
     *
     * Logout at the bottom of this menu is the former .aivastra-status-top
     * Disconnect button (render_connection_section()'s own doc comment) —
     * same handle_disconnect() admin-post action and
     * aivastra_tryon_disconnect nonce, relabelled and moved here since every
     * caller of render_navbar() is already a connected-only page
     * (render_gated()'s own doc comment), so there's no "not connected yet"
     * state this menu needs to account for.
     */
    private static function render_navbar(): void
    {
        ?>
        <div class="aivastra-navbar">
          <div class="aivastra-navbar-left">
            <img src="<?php echo esc_url(AIVASTRA_TRYON_URL . 'admin/assets/images/logo.svg'); ?>" alt="" class="aivastra-logo-mark">
            <img src="<?php echo esc_url(AIVASTRA_TRYON_URL . 'admin/assets/images/logo-text.svg'); ?>" alt="Ai Vastra" class="aivastra-logo-text">
          </div>

          <details class="aivastra-topbar-support aivastra-navbar-more">
            <summary class="aivastra-navbar-more-trigger" aria-label="More options" title="More options">
              <?php echo self::lucide('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', 18); ?>
            </summary>
            <div class="aivastra-topbar-support-menu">
              <a href="mailto:support@aivastra.com" class="aivastra-topbar-support-item">Email us</a>
              <button type="button" class="aivastra-topbar-support-item aivastra-start-chat-trigger">Start a chat</button>
              <a href="<?php echo esc_url(self::BROWSER_API_BASE . '/developers'); ?>" target="_blank" rel="noopener noreferrer" class="aivastra-topbar-support-item">Help &amp; documentation</a>
              <div class="aivastra-topbar-support-divider"></div>
              <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="aivastra_tryon_disconnect">
                <?php wp_nonce_field('aivastra_tryon_disconnect'); ?>
                <button type="submit" class="aivastra-topbar-support-item aivastra-topbar-support-item--danger">
                  <?php echo self::icon('log-out'); ?>
                  Logout
                </button>
              </form>
            </div>
          </details>
        </div>
        <?php
    }

    /**
     * The connected Dashboard submenu's one page — replaces the old
     * Connection/Plans/Try-On Button/Categories/Analytics/Support tabs
     * (render_nav(), removed) at the merchant's request: everything the
     * tabs held is still here, just stacked on one scroll instead of gated
     * behind a click, in this order: Connection (credits balance + Buy credits),
     * Plans & credits, Products overview and Support (Categories, Plans &
     * Credits, and Try-On Button customization all moved to their own
     * sidebar pages — render_categories_page()/render_manage(),
     * render_plans_page(), render_customize_page()/render_customize()).
     * Each reuses its old tab's render method completely unchanged — same
     * forms, same save handlers, same data — just called in sequence instead
     * of behind a section switch.
     *
     * The Try-On Activity line chart (render_activity_chart()) used to sit
     * here too, between Plans and Products overview; it moved to the
     * standalone Analytics page (render_analytics_card()) at the merchant's
     * later request — a quick one-glance homepage and a dedicated reporting
     * page, not both showing the same 14-day chart. The old Analytics tab's
     * own stat-tile grid (Virtual Try-Ons/Unique Shoppers/Added to Cart/
     * Add-to-Cart Rate/Credits Available) and Top Products table — purpose-
     * built for this page, modelled on a reference WordPress plugin
     * dashboard the merchant supplied screenshots of — were removed at an
     * earlier request ("unwanted for now") and never came back here; $result
     * (GET /v1/dev/analytics) is still fetched here since get_balance_summary()
     * (via render_connection_section()) needs its daily rows.
     */
    /**
     * Redesigned to match a reference dashboard screenshot the merchant
     * supplied, the same way render_categories_page() was modelled on that
     * reference's own Manage page — see this method's inline notes for what
     * didn't transfer and why.
     */
    private static function render_dashboard(Aivastra_Connection_Settings $settings): void
    {
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $service->get_analytics();
        ?>
        <div class="aivastra-dashboard">
          <?php // Page title restored (was dropped when this was the only page in
          // the plugin and the sidebar label already said "Ai Vastra") — now that
          // Manage/Analytics/Billing/Customize/Support each have their own
          // .aivastra-manage-header/-title, Dashboard needs the same so it doesn't
          // read as the one page with no heading at all. ?>
          <div class="aivastra-manage-header">
            <h2 class="aivastra-manage-title">Dashboard</h2>
            <p class="aivastra-page-subtitle">Here's how virtual try-on is performing on your store.</p>
          </div>

          <?php // Connection first (credits balance) — the merchant wants that found "clearly and soon", ahead of the chart below it. $result's `daily` rows (fetched below for the Try-On Activity chart) double as get_balance_summary()'s days-remaining input, so this doesn't make its own separate GET /v1/dev/analytics call — fetching $result before this call, even though the chart it's mainly for renders second, keeps that single-fetch property. ?>
          <?php self::render_connection_section($settings, true, $result['ok'] ? $result['daily'] : null); ?>

          <?php // Plans & credits, duplicated here (not moved) from its own Billing
          // submenu — same reasoning as Support below: the reference screenshot
          // puts pricing directly on the homepage, and render_plans(true) already
          // renders as a self-contained card, so showing it both places costs
          // nothing extra to keep in sync (one shared method, not copied markup). ?>
          <?php self::render_plans($settings); ?>

          <?php // The reference's 3-stat row (Try-Ons/Products Synced/Try-On Enabled)
          // folds into render_products_overview()'s existing tile grid below
          // (Try-Ons added as a new first tile) rather than a second, separate
          // stat row — see that method's own doc comment for the
          // Products-Synced-has-no-WordPress-equivalent reasoning, same as the
          // Manage page. The reference's "Today's try-ons"/"14 emails collected"
          // and "Sync status" (Active/Processing/Failed) cards are dropped
          // entirely: this plugin tracks no shopper emails anywhere (confirmed by
          // a full grep — the only emails in this plugin are the merchant's own
          // account email), and there is no sync pipeline a status could ever
          // describe. ?>
          <?php self::render_products_overview($settings, $result['ok'] ? $result['cards']['tryOns'] : null); ?>

          <?php // Support is the only old tab still stacked inline here, AND
          // duplicated onto its own sidebar page (render_support_submenu()/
          // render_support_page()) — unlike Categories and Try-On Button
          // customization, which moved off this page entirely onto their own
          // sidebar entries (the Customize submenu owns
          // render_widget_customization()), Support stays here too at the
          // merchant's request: a shortcut for anyone already on the dashboard
          // shouldn't have to leave it to reach Support. ?>
          <?php self::render_support_card(); ?>
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
     * rather than the tabbed settings screen connected merchants get —
     * render_onboarding_categories() is step 2, render_onboarding_button()
     * is step 3 (ONBOARDING_STEPS, render_progress_steps()).
     *
     * Still no render_onboarding_topbar() here (no logo row/Support menu,
     * no "Advanced: connect with API keys instead" accordion — that fallback
     * only ever docked in the topbar's own $showAdvanced and isn't offered on
     * this step at all) — this step still otherwise matches a screenshot of
     * apps/catalogues-web's own /login page exactly, at the merchant's
     * earlier explicit request. render_progress_steps(1) alone is the one
     * piece of that chrome restored on top of the bare card below, per a
     * later, separate request: landing on this page with no "step 1 of 3"
     * indicator while steps 2 and 3 both show one read as broken/incomplete
     * rather than intentionally bare. render_progress_steps() needs no
     * topbar/flat-body wrapper to render correctly — .aivastra-connect-wrap
     * (below) is already a centred flex column, same as
     * .aivastra-page-flat-body gives every other onboarding step.
     */
    private static function render_onboarding_connect(Aivastra_Connection_Settings $settings): void
    {
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-connect-wrap">
          <h1 class="screen-reader-text">Connect your Ai Vastra account</h1>

          <?php self::render_progress_steps(1); ?>

          <?php self::render_notices(); ?>

          <?php self::render_connection_section($settings, false); ?>
        </div>

        <?php self::render_chat_modal(); ?>
        <?php
    }

    /**
     * Step 2 of the onboarding wizard: map WooCommerce categories to Ai
     * Vastra try-on categories right after connecting, rather than leaving
     * the Try-On button hidden on every product until a merchant finds the
     * Manage page's Routing tab on their own. Reuses
     * render_category_routing_table() — the same list/dropdown table the
     * Manage page's Routing tab renders — rather than a separate tile-grid
     * layout, so a merchant sees one consistent garment-type-mapping UI
     * throughout the plugin instead of two different ones. $categoriesResult
     * is fetched here the same way render_categories_page() fetches it for
     * that same table, since this step has no stats row to share the fetch
     * with.
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
        $widgetKey = $settings->get_widget_key();
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $categoriesResult = $widgetKey !== null ? $service->list_categories($widgetKey) : ['ok' => false, 'categories' => []];
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
              <?php // true, false: boxed white card around the table — without it the
              // table's header band and rows read as floating directly on the
              // page background, easy to mistake for plain text ("too
              // confusing" per merchant feedback) — but no "Routing"
              // heading/description inside it, since this step's own heading
              // and subtext above already say what to do. ?>
              <?php self::render_category_routing_table($settings, $categoriesResult, true, false); ?>
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
     * Step 3 of the onboarding wizard, the last one: customize the try-on
     * button's appearance right after mapping categories, rather than
     * leaving it on its stock colors/copy until a merchant finds the
     * Customize submenu on their own. Reuses render_widget_customization()
     * — the exact same form, fields and admin-post.php handler
     * (handle_save_widget_customization()) the standalone Customize page
     * uses — rather than a separate onboarding-only form, so there's only
     * ever one place this plugin's button-appearance fields are defined.
     * handle_save_widget_customization() is what tells "this save completes
     * the wizard" apart from "this save came from the regular Customize
     * page" and redirects accordingly; this function itself doesn't need to
     * know which case it is.
     */
    private static function render_onboarding_button(Aivastra_Connection_Settings $settings): void
    {
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-onboarding-wrap">
          <?php self::render_onboarding_topbar(admin_url('admin.php?page=aivastra-tryon&section=connection')); ?>

          <div class="aivastra-page-flat-body">
            <?php self::render_progress_steps(3); ?>

            <div class="aivastra-onboarding-heading">
              <h2>Customize Your Try-On Button</h2>
              <p>Match the try-on button and popup to your store's look — colors, placement and copy. You can always change this later from Customize.</p>
            </div>

            <?php self::render_notices(false); ?>

            <div class="aivastra-onboarding-body">
              <?php // true, false: boxed white card (same reasoning as step 2's own
              // render_category_routing_table() call just above) and no
              // "Try-on button" heading/description inside it — this step's
              // own heading and subtext above already say what to do. ?>
              <?php self::render_widget_customization($settings, true, false); ?>
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
     * Analytics submenu's content below its own page header
     * (render_analytics_page(), which renders the "Analytics" title +
     * subtitle directly, same split as render_categories_page()'s own
     * .aivastra-manage-header vs. its stat/card sections) — a bare stat-tile
     * row (.aivastra-stat-grid, same "InlineGrid of standalone Cards, not one
     * card wrapping everything" shape as .aivastra-manage-stats), the
     * Try-On Activity line chart (render_activity_chart(), moved here from
     * the Dashboard — see render_dashboard()'s own doc comment), and a
     * Products Card, mirroring apps/shopify/src/pages/AnalyticsPage.tsx's
     * own section-per-Card layout instead of the single big box this used to
     * be stacked inside.
     *
     * Only shown once connected — GET /v1/dev/analytics needs the stored full
     * key (aggregate business data, unlike balance/plans/categories, which
     * accept the widget key). `cards.tryOns` and the chart's daily line are
     * real (drawn from the jobs table by apps/api/src/modules/dev/analytics.ts);
     * everything else, including the entire product table, is advisory —
     * client-reported by assets/widget.js and forgeable — which is why the
     * product table is labeled as such instead of implying it is as exact as
     * the top-line try-on count.
     *
     * AnalyticsPage.tsx itself has three more sections this one doesn't:
     * Emails captured (+ CSV export), Turned away, and a Shopper journey
     * funnel, plus a date-range picker instead of a fixed 30-day window.
     * Those all read from shopify_shoppers / funnel step events — tables the
     * WordPress dev-API path (apps/api/src/modules/dev/analytics.ts) has no
     * counterpart for, since POST /v1/dev/tryon carries no shopper identity
     * at all (see devAnalyticsCards()'s own doc comment). Matching those too
     * is a backend feature-parity decision, not a styling one.
     */
    private static function render_analytics_card(Aivastra_Connection_Settings $settings): void
    {
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $service->get_analytics();
        if (!$result['ok']) {
            ?>
            <div class="aivastra-card">
              <p class="aivastra-empty-state">Could not load analytics right now — try reloading this page.</p>
            </div>
            <?php
            return;
        }
        ?>
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

        <?php self::render_activity_chart($result['daily']); ?>

        <?php if ($result['funnel'] !== null): ?>
          <?php self::render_funnel_chart($result['funnel']); ?>
        <?php endif; ?>

        <?php if (!empty($result['products'])): ?>
          <div class="aivastra-card">
            <h2 class="aivastra-card-heading"><?php echo self::heading_icon('grid'); ?>Products (estimated)</h2>
            <table class="aivastra-analytics-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Try-ons</th>
                  <th>Shoppers</th>
                  <th>Added to cart</th>
                  <th>Add-to-cart rate</th>
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
                    <td><?php echo esc_html(round(((float) $p['addToCartRate']) * 100, 1)); ?>%</td>
                  </tr>
                <?php endforeach; ?>
              </tbody>
            </table>
          </div>
        <?php endif; ?>
        <?php
    }

    /**
     * Support submenu's page content (register_menu(), render_support_submenu()),
     * also stacked inline at the bottom of the Dashboard (render_dashboard())
     * — same two contact channels as the Shopify embedded admin's Support tab
     * (apps/shopify/src/pages/SupportPage.tsx), static links, no backend of
     * its own, so it's always shown regardless of connection state.
     * $wrapInCard: false for render_support_page(), its only standalone-page
     * caller — same "don't nest a card inside the shell panel's own box"
     * reasoning as render_categories_page()'s/render_plans_page()'s own
     * $wrapInCard; the Dashboard's inline call keeps the default (true) since
     * it sits alongside other cards there.
     */
    private static function render_support_card(bool $wrapInCard = true): void
    {
        ?>
        <?php if ($wrapInCard): ?><div class="aivastra-card aivastra-support-card"><?php endif; ?>
          <?php if ($wrapInCard): ?>
            <h2 class="aivastra-card-heading"><?php echo self::heading_icon('life-buoy'); ?>Support</h2>
            <p class="aivastra-card-description">Two ways to reach the team.</p>
          <?php endif; ?>
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
        <?php if ($wrapInCard): ?></div><?php endif; ?>
        <?php
        // No render_chat_modal() call here — render_support_page() and the
        // connected dashboard's app header (render()) each mount their own
        // instance on every tab, this card's own .aivastra-start-chat-trigger
        // button opens whichever one that page rendered.
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
        <?php // Google first, divider, then email/password — same order as
        // apps/catalogues-web's own /login page, cloned here at the
        // merchant's explicit request. A separate, fieldless form purely so
        // this button can submit via its own action/nonce, independent of
        // the email/password form below. target="_blank" opens this
        // submission into a normal new browser tab rather than navigating
        // this one away from wp-admin — the merchant tried a sized
        // window.open() popup first and explicitly asked for a plain tab
        // instead ("previously it is opening in new tab that option is
        // good"). No rel="noopener" here on purpose: window.opener must stay
        // reachable from the new tab for render_connect_popup_close() to
        // post back and auto-close it (see that method and connect.js's
        // own doc comments). handle_connect_start()/handle_connect_callback()
        // need no request-shape changes for this, only the opener-aware
        // final response they already send. ?>
        <form id="aivastra-google-connect-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" target="_blank">
          <input type="hidden" name="action" value="aivastra_tryon_connect_start">
          <?php wp_nonce_field('aivastra_tryon_connect_start'); ?>
          <button type="submit" class="aivastra-btn aivastra-btn-google aivastra-btn-block">
            <?php echo self::google_icon(); ?>
            Continue with Google
          </button>
        </form>

        <p class="aivastra-connect-divider"><span>Or Continue With</span></p>

        <?php // Aivastra_Connect_Ajax / POST /v1/merchant/wordpress-login
        // creates a free account automatically when the email doesn't match
        // one yet — this one field covers both log in and sign up, same as
        // "Email or Username" does on the reference page's own form
        // (findUserByIdentifier accepts either). ?>
        <form id="aivastra-connect-form" class="aivastra-form aivastra-connect-form-fields">
          <div class="aivastra-step-body">
            <label for="aivastra_connect_email">Email or Username*</label>
            <div class="aivastra-field-icon-wrap">
              <span class="aivastra-field-icon" aria-hidden="true"><?php echo self::icon('mail'); ?></span>
              <input type="text" id="aivastra_connect_email" name="email" class="aivastra-input" autocomplete="username" placeholder="Enter your email or username" required>
            </div>
          </div>
          <div class="aivastra-step-body">
            <div class="aivastra-field-label-row">
              <label for="aivastra_connect_password">Password*</label>
              <a href="<?php echo esc_url(self::BROWSER_API_BASE . '/forgot-password'); ?>" target="_blank" rel="noopener noreferrer" class="aivastra-field-label-link">Forgot Password?</a>
            </div>
            <div class="aivastra-field-icon-wrap has-toggle">
              <span class="aivastra-field-icon" aria-hidden="true"><?php echo self::icon('lock'); ?></span>
              <input type="password" id="aivastra_connect_password" name="password" class="aivastra-input" autocomplete="current-password" placeholder="Enter password" required>
              <button type="button" class="aivastra-field-toggle" id="aivastra-connect-password-toggle" aria-label="Show password" aria-pressed="false">
                <?php echo self::icon('eye'); ?>
              </button>
            </div>
          </div>
          <div class="aivastra-step-body" id="aivastra-connect-phone-row" hidden>
            <label for="aivastra_connect_phone">Phone number</label>
            <p class="aivastra-step-hint">Needed once, to finish setting up your Ai Vastra business account.</p>
            <input type="tel" id="aivastra_connect_phone" name="phone" class="aivastra-input" autocomplete="tel">
          </div>
          <div id="aivastra-connect-message" class="aivastra-connect-message" role="status" aria-live="polite"></div>
          <button type="submit" id="aivastra-connect-submit" class="aivastra-btn aivastra-btn-primary aivastra-btn-block">Continue</button>
        </form>

        <?php // Not a link out to a separate register page — the form above
        // already creates an account inline when the email doesn't match
        // one yet, which is the whole point of the embedded flow this
        // button sits under. "Sign Up" just focuses Email so a merchant
        // following the reference page's own habit lands in the right
        // place rather than leaving the plugin. ?>
        <p class="aivastra-connect-signup">
          Don&rsquo;t have an account? <button type="button" class="aivastra-connect-signup-link" id="aivastra-connect-signup">Sign Up</button>
        </p>

        <?php // false for render_onboarding_connect() (step 1) — removed
        // there entirely at the merchant's explicit request, along with the
        // topbar it used to dock in. Only the "Update connection keys"
        // reveal in the connected dashboard still offers this fallback. ?>
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
              <a href="<?php echo esc_url(self::BROWSER_API_BASE . '/register?src=wordpress_plugin'); ?>" target="_blank" rel="noopener noreferrer" class="aivastra-btn aivastra-btn-ghost">Create a free account &rarr;</a>
              <a href="<?php echo esc_url(self::BROWSER_API_BASE . '/developers'); ?>" target="_blank" rel="noopener noreferrer" class="aivastra-btn aivastra-btn-ghost">Already have an account? Get your API keys &rarr;</a>
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
     * same reasoning as render_category_routing_table()'s own $wrapInCard: a card
     * box around the only thing on a page is a second box nested inside the
     * shell panel's own. true (default) keeps render_dashboard()'s old
     * inline look... except render_dashboard() no longer calls this at all,
     * Plans having moved off the one-page dashboard entirely — the default
     * is kept true only so a future caller isn't surprised by an unwrapped
     * card if one shows up alongside other content again. Doubles as the
     * "standalone page" flag below: the large centred page-title treatment
     * only makes sense with a whole page to itself.
     *
     * Each tile is apps/shopify/src/components/PackGrid.tsx's own pack card,
     * line for line — name + a plain Badge (not the old gradient-ring "Most
     * Popular" ribbon, which is this file's own invention; apps/shopify's
     * real highlighted-pack treatment is just `<Badge tone="success">Best
     * value</Badge>`, nothing more), one big price, "{N} try-ons", a subdued
     * "{N} credits · never expire" line, then a full-width primary button —
     * at the merchant's explicit request to match apps/shopify "exact...
     * complete should be same". The icon chip, GST+per-unit caption lines,
     * the divider and the "Included Features" checklist all come from this
     * plugin's own earlier design, not from apps/shopify, which has none of
     * them. GST is the one line kept anyway, not dropped silently: it's a
     * real price-transparency disclosure (India), unlike the rest, so it
     * stays as a small caption directly under the price instead of being cut
     * for the sake of a pixel-exact card.
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
                // isHighlighted/badge come straight from GET /v1/dev/plans, same
                // fields the consumer pricing page reads.
                $displayName = self::PLAN_META[$idx]['name'] ?? $plan['name'];
                $highlighted = !empty($plan['isHighlighted']);
                $badge = $plan['badge'] ?? null;
                ?>
                <div class="aivastra-plan-outer">
                  <div class="aivastra-plan-tile">
                    <div class="aivastra-plan-head">
                      <span class="aivastra-plan-name"><?php echo esc_html($displayName); ?></span>
                      <?php if ($highlighted && $badge): ?>
                        <span class="aivastra-badge aivastra-badge-success"><?php echo esc_html($badge); ?></span>
                      <?php endif; ?>
                    </div>

                    <div class="aivastra-plan-price-row">
                      <span class="aivastra-plan-price-big">&#8377;<?php echo esc_html(number_format_i18n((int) $plan['priceInr'])); ?></span>
                      <span class="aivastra-plan-gst">+ GST</span>
                    </div>

                    <?php if (!empty($plan['unitCountLabel'])): ?>
                      <p class="aivastra-plan-tryons"><?php echo esc_html($plan['unitCountLabel']); ?></p>
                    <?php endif; ?>
                    <p class="aivastra-plan-credits"><?php echo esc_html(number_format_i18n((int) $plan['credits'])); ?> credits &middot; never expire</p>

                    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="aivastra-plan-buy-form">
                      <input type="hidden" name="action" value="aivastra_tryon_buy">
                      <input type="hidden" name="aivastra_plan_slug" value="<?php echo esc_attr($plan['slug']); ?>">
                      <?php wp_nonce_field('aivastra_tryon_buy'); ?>
                      <button type="submit" class="aivastra-btn aivastra-plan-buy-btn aivastra-btn-primary">
                        Buy credits
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
     * unusably long; Manage links to the Manage sidebar submenu
     * (render_categories_page(), via render_manage()) instead, where the
     * actual lever (category mapping) lives. Manage is a third
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
     *
     * @param ?int $tryOnsTotal render_dashboard()'s own GET /v1/dev/analytics
     *   `cards.tryOns` figure, passed in rather than re-fetched here — this
     *   is the one tile in this card that didn't exist before the reference-
     *   dashboard redesign (its "Try-Ons" stat), added as a tile in this same
     *   grid rather than a second, separate stat row since the other two
     *   tiles already live here. Null when that analytics call failed, same
     *   as every other caller of $result['ok'] in render_dashboard() — the
     *   tile itself still renders, just with an em dash instead of a number.
     */
    private static function render_products_overview(Aivastra_Connection_Settings $settings, ?int $tryOnsTotal = null): void
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
              <span class="aivastra-dashboard-stat-icon aivastra-dashboard-stat-icon--tryons">
                <?php echo self::icon('activity'); ?>
              </span>
              <span class="aivastra-dashboard-stat-label">Try-Ons</span>
              <span class="aivastra-dashboard-stat-value"><?php echo $tryOnsTotal !== null ? esc_html(number_format_i18n($tryOnsTotal)) : '&mdash;'; ?></span>
            </div>
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
            <a href="<?php echo esc_url(admin_url('admin.php?page=aivastra-tryon-manage')); ?>" class="aivastra-dashboard-stat aivastra-dashboard-stat--action">
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
     * The Manage sidebar submenu's page content (register_menu(),
     * render_manage()) — redesigned to match a reference dashboard's Manage
     * page the merchant supplied screenshots of: a left-aligned header, three
     * stat cards, a "Where your products land" breakdown, then two tabs
     * (Routing / Eligibility) — replacing the single always-visible
     * category-mapping tile grid this page used to be entirely
     * (render_category_routing_table() below — the onboarding wizard's own
     * categories step, render_onboarding_categories(), now reuses this same
     * table rather than that old tile grid, which has since been removed).
     * Reuses render_navbar() for the shared logo/menu chrome; the wrap/body
     * classes are the dashboard's own (aivastra-dashboard-wrap /
     * .aivastra-dashboard, 1400px centred).
     *
     * The reference this was modelled on is Shopify's embedded admin
     * "Manage" page, which routes PRODUCTS individually into a "basket" (a
     * per-product row, backed by a product-sync pipeline Shopify's app
     * maintains). Neither concept transfers directly: WordPress has no
     * product-sync step (products are native WooCommerce posts, read live),
     * and this plugin has no per-product routing table — routing here is,
     * and stays, per WooCommerce PRODUCT CATEGORY
     * (Aivastra_Category_Mapping/render_category_routing_table() below, the
     * exact same mechanism this page already used before this redesign) at
     * the merchant's explicit request ("per-category is enough now, we'll
     * build per-product routing later"). "Basket" is also Shopify-specific
     * terminology with no WordPress equivalent; every place the reference
     * says "basket" this page instead says "garment type" (the dev-API
     * catalog slug/name a category is mapped to — GET /v1/dev/categories).
     * The reference's "Products Synced" stat and "Sync products" button are
     * dropped entirely for the same reason — there is no sync step here —
     * replaced by a plain "Total Products" count read live from WooCommerce.
     *
     * The Eligibility tab (render_product_eligibility_list()) is a NEW bulk,
     * per-product checkbox list, not a global "enable all except
     * exclusions" switch — no such switch exists anywhere in this plugin's
     * data model. The only per-product eligibility mechanism that already
     * existed before this page was Aivastra_Product_Toggle's single
     * checkbox on a product's own WooCommerce edit screen; this tab is a
     * bulk-editable view over that same per-product meta, not a new concept
     * layered on top of it.
     */
    private static function render_categories_page(Aivastra_Connection_Settings $settings): void
    {
        $widgetKey = $settings->get_widget_key();
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $categoriesResult = $widgetKey !== null ? $service->list_categories($widgetKey) : ['ok' => false, 'categories' => []];
        $stats = self::get_manage_page_stats($settings, $categoriesResult);

        $tab = ($_GET['tab'] ?? 'routing') === 'eligibility' ? 'eligibility' : 'routing';
        $routingUrl = admin_url('admin.php?page=aivastra-tryon-manage&tab=routing');
        $eligibilityUrl = admin_url('admin.php?page=aivastra-tryon-manage&tab=eligibility');
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-dashboard-wrap">
          <?php self::render_navbar(); ?>

          <div class="aivastra-page-flat-body">
            <?php self::render_notices(); ?>

            <div class="aivastra-dashboard aivastra-manage-page">
              <div class="aivastra-manage-header">
                <h2 class="aivastra-manage-title">Manage</h2>
                <p class="aivastra-page-subtitle">Control which products offer Try-On.</p>
              </div>

              <div class="aivastra-manage-stats">
                <div class="aivastra-manage-stat-card">
                  <span class="aivastra-manage-stat-label"><?php echo self::icon('grid'); ?>Total Products</span>
                  <span class="aivastra-manage-stat-value"><?php echo esc_html(number_format_i18n($stats['totalProducts'])); ?></span>
                </div>
                <div class="aivastra-manage-stat-card">
                  <span class="aivastra-manage-stat-label"><?php echo self::icon('check-circle'); ?>Try-On Enabled</span>
                  <span class="aivastra-manage-stat-value">
                    <?php echo esc_html(number_format_i18n($stats['enabledCount'])); ?><span class="aivastra-manage-stat-value-of">/<?php echo esc_html(number_format_i18n($stats['totalProducts'])); ?></span>
                  </span>
                  <span class="aivastra-manage-stat-hint">Products with the Try-On button showing</span>
                </div>
                <div class="aivastra-manage-stat-card">
                  <span class="aivastra-manage-stat-label"><?php echo self::icon('tag'); ?>Categories</span>
                  <span class="aivastra-manage-stat-value"><?php echo esc_html(number_format_i18n($stats['linkedCategoryCount'])); ?> linked</span>
                  <span class="aivastra-manage-stat-hint"><?php echo esc_html(number_format_i18n($stats['unlinkedCategoryCount'])); ?> unlinked</span>
                </div>
              </div>

              <div class="aivastra-card aivastra-manage-landing-card">
                <h2 class="aivastra-card-heading"><?php echo self::heading_icon('grid'); ?>Where your products land</h2>
                <?php if (!$stats['categoriesOk']): ?>
                  <p class="aivastra-empty-state">Could not load your Ai Vastra garment types right now — try reloading this page.</p>
                <?php elseif (empty($stats['garmentTypes']) && $stats['notRoutedCount'] === 0): ?>
                  <p class="aivastra-empty-state">No published products yet.</p>
                <?php else: ?>
                  <ul class="aivastra-manage-landing-list">
                    <?php foreach ($stats['garmentTypes'] as $type): ?>
                      <li class="aivastra-manage-landing-row">
                        <span class="aivastra-manage-landing-name"><?php echo self::icon('tag'); ?><?php echo esc_html($type['name']); ?></span>
                        <span class="aivastra-manage-landing-count"><?php echo esc_html(number_format_i18n($type['count'])); ?> <?php echo $type['count'] === 1 ? 'product' : 'products'; ?></span>
                      </li>
                    <?php endforeach; ?>
                    <?php if ($stats['notRoutedCount'] > 0): ?>
                      <li class="aivastra-manage-landing-row aivastra-manage-landing-row--unrouted">
                        <span class="aivastra-manage-landing-name"><?php echo self::icon('log-out'); ?>Not routed (try-on unavailable)</span>
                        <span class="aivastra-manage-landing-count"><?php echo esc_html(number_format_i18n($stats['notRoutedCount'])); ?> <?php echo $stats['notRoutedCount'] === 1 ? 'product' : 'products'; ?></span>
                      </li>
                    <?php endif; ?>
                  </ul>
                <?php endif; ?>
              </div>

              <div class="aivastra-manage-tabs" role="tablist">
                <a href="<?php echo esc_url($routingUrl); ?>" class="aivastra-manage-tab<?php echo $tab === 'routing' ? ' is-active' : ''; ?>" role="tab" aria-selected="<?php echo $tab === 'routing' ? 'true' : 'false'; ?>">Routing</a>
                <a href="<?php echo esc_url($eligibilityUrl); ?>" class="aivastra-manage-tab<?php echo $tab === 'eligibility' ? ' is-active' : ''; ?>" role="tab" aria-selected="<?php echo $tab === 'eligibility' ? 'true' : 'false'; ?>">Eligibility</a>
              </div>

              <?php if ($tab === 'eligibility'): ?>
                <?php self::render_product_eligibility_list(); ?>
              <?php else: ?>
                <?php self::render_category_routing_table($settings, $categoriesResult); ?>
              <?php endif; ?>
            </div>
          </div>
        </div>

        <?php self::render_chat_modal(); ?>
        <?php
    }

    /**
     * Stats for the Manage page's header stat row and "Where your products
     * land" card (render_categories_page()) — extends the same
     * product-category iteration render_products_overview() already does
     * for its own Total Products/Try-On Enabled tiles, grouping by resolved
     * garment type for the landing breakdown too, so there is exactly one
     * place that walks every published product rather than two slightly
     * different ones.
     *
     * @param array{ok:bool, categories:array<int, array{slug:string,name:string}>} $categoriesResult
     * @return array{
     *   totalProducts:int,
     *   enabledCount:int,
     *   linkedCategoryCount:int,
     *   unlinkedCategoryCount:int,
     *   garmentTypes:array<int, array{slug:string,name:string,count:int}>,
     *   notRoutedCount:int,
     *   categoriesOk:bool,
     * }
     */
    private static function get_manage_page_stats(Aivastra_Connection_Settings $settings, array $categoriesResult): array
    {
        $categories = $categoriesResult['categories'];
        $validSlugs = wp_list_pluck($categories, 'slug');

        $terms = get_terms(['taxonomy' => 'product_cat', 'hide_empty' => false]);
        $productCategories = is_wp_error($terms) ? [] : $terms;
        $currentMap = $settings->get_category_map();

        $linkedCategoryCount = 0;
        foreach ($productCategories as $term) {
            $mappedSlug = $currentMap[$term->term_id] ?? '';
            if ($mappedSlug !== '' && in_array($mappedSlug, $validSlugs, true)) {
                $linkedCategoryCount++;
            }
        }

        $productIds = get_posts([
            'post_type' => 'product',
            'post_status' => 'publish',
            'posts_per_page' => -1,
            'fields' => 'ids',
        ]);
        update_object_term_cache($productIds, 'product');
        update_postmeta_cache($productIds);

        $countsBySlug = [];
        $enabledCount = 0;
        $notRoutedCount = 0;
        foreach ($productIds as $productId) {
            $termIds = wp_get_post_terms($productId, 'product_cat', ['fields' => 'ids']);
            $slug = Aivastra_Category_Mapping::resolve(is_array($termIds) ? $termIds : [], $currentMap);
            if ($slug === null) {
                $notRoutedCount++;
                continue;
            }
            $countsBySlug[$slug] = ($countsBySlug[$slug] ?? 0) + 1;
            if (Aivastra_Product_Toggle::is_enabled($productId)) {
                $enabledCount++;
            }
        }

        $garmentTypes = [];
        foreach ($categories as $cat) {
            $count = $countsBySlug[$cat['slug']] ?? 0;
            if ($count > 0) {
                $garmentTypes[] = ['slug' => $cat['slug'], 'name' => $cat['name'], 'count' => $count];
            }
        }

        return [
            'totalProducts' => count($productIds),
            'enabledCount' => $enabledCount,
            'linkedCategoryCount' => $linkedCategoryCount,
            'unlinkedCategoryCount' => count($productCategories) - $linkedCategoryCount,
            'garmentTypes' => $garmentTypes,
            'notRoutedCount' => $notRoutedCount,
            'categoriesOk' => $categoriesResult['ok'],
        ];
    }

    /**
     * Routing tab (render_categories_page()) — the exact same per-category
     * mapping mechanism this page used before the redesign
     * (Aivastra_Category_Mapping, save-categories.js,
     * Aivastra_Category_Map_Ajax — all three completely unchanged), restyled
     * to pixel-match a reference "Individual product routing" table the
     * merchant supplied a screenshot of: plain bold card title with no icon
     * chip (unlike every other .aivastra-card-heading on this plugin, which
     * does carry one — .aivastra-routing-card-heading below overrides that
     * specifically for this card), a light grey table header band, a
     * rounded icon tile on each row standing in for that reference's product
     * photo (categories have no photo of their own to show), and row
     * dividers/hover matching its spacing. Routing stays per WooCommerce
     * PRODUCT CATEGORY, not per product, at the merchant's explicit request
     * — see render_categories_page()'s own doc comment — so the title text
     * itself stays "Routing"/"product categories", not the reference's own
     * per-product copy; only the visual chrome was matched. $categoriesResult
     * is the already-fetched GET /v1/dev/categories response
     * (render_categories_page()), passed in rather than re-fetched here
     * since get_manage_page_stats() right above needs that same data.
     *
     * $wrapInCard/$showHeading: render_onboarding_categories() passes both
     * false so the table flows on the onboarding page's own background with
     * no boxed card and no "Routing" heading/description, since that step's
     * own heading and subtext above already say what to do.
     */
    private static function render_category_routing_table(Aivastra_Connection_Settings $settings, array $categoriesResult, bool $wrapInCard = true, bool $showHeading = true): void
    {
        $terms = get_terms(['taxonomy' => 'product_cat', 'hide_empty' => false]);
        $productCategories = is_wp_error($terms) ? [] : $terms;
        $currentMap = $settings->get_category_map();
        ?>
        <?php if ($wrapInCard): ?><div class="aivastra-card aivastra-routing-card"><?php endif; ?>
          <?php if ($showHeading): ?>
            <h2 class="aivastra-card-heading aivastra-routing-card-heading">Routing</h2>
            <p class="aivastra-card-description">Choose which try-on garment type each of your product categories should use. A category with no garment type selected won't show the Try-On button at all.</p>
          <?php endif; ?>
          <?php if (!$categoriesResult['ok']): ?>
            <p class="aivastra-empty-state">Could not load your Ai Vastra garment types right now — try reloading this page.</p>
          <?php elseif (empty($categoriesResult['categories'])): ?>
            <p class="aivastra-empty-state">You don't have any try-on garment types set up on your Ai Vastra account yet. The Try-On button won't show on any product until you add one and map it below.</p>
          <?php elseif (empty($productCategories)): ?>
            <p class="aivastra-empty-state">No WooCommerce product categories found — the Try-On button won't show on any product until its category is mapped below.</p>
          <?php else: ?>
            <form id="aivastra-category-map-form" class="aivastra-form">
              <input type="hidden" name="action" value="aivastra_tryon_save_category_map">
              <?php wp_nonce_field('aivastra_tryon_save_category_map'); ?>
              <table class="aivastra-routing-table">
                <thead>
                  <tr>
                    <th>Product category</th>
                    <th>Garment type</th>
                  </tr>
                </thead>
                <tbody>
                  <?php foreach ($productCategories as $term): ?>
                    <?php $mappedSlug = $currentMap[$term->term_id] ?? ''; ?>
                    <tr>
                      <td>
                        <span class="aivastra-routing-table-category">
                          <span class="aivastra-routing-table-icon"><?php echo self::icon('tag'); ?></span>
                          <?php echo esc_html($term->name); ?>
                        </span>
                      </td>
                      <td>
                        <select id="aivastra-cat-map-<?php echo esc_attr($term->term_id); ?>" name="aivastra_category_map[<?php echo esc_attr($term->term_id); ?>]" class="aivastra-select">
                          <option value="">No garment type selected</option>
                          <?php foreach ($categoriesResult['categories'] as $cat): ?>
                            <option value="<?php echo esc_attr($cat['slug']); ?>" <?php selected($mappedSlug, $cat['slug']); ?>><?php echo esc_html($cat['name']); ?></option>
                          <?php endforeach; ?>
                        </select>
                      </td>
                    </tr>
                  <?php endforeach; ?>
                </tbody>
              </table>
              <div class="aivastra-save-row">
                <button type="submit" id="aivastra-category-map-submit" class="aivastra-btn aivastra-btn-primary">Save</button>
                <span class="aivastra-refresh-confirm" id="aivastra-category-map-confirm" aria-live="polite"></span>
              </div>
            </form>
          <?php endif; ?>
        <?php if ($wrapInCard): ?></div><?php endif; ?>
        <?php
    }

    /**
     * Eligibility tab (render_categories_page()) — a bulk, per-product view
     * over Aivastra_Product_Toggle's existing single checkbox meta box
     * (_aivastra_tryon_enabled), the ONLY per-product eligibility mechanism
     * this plugin has. There is no global "enable all except exclusions"
     * switch anywhere in this plugin's data model for this tab to surface
     * instead — see render_categories_page()'s own doc comment. Each row's
     * checkbox saves instantly via product-eligibility.js/
     * Aivastra_Product_Eligibility_Ajax — no page-wide Save button, same
     * instant-save idiom as the Connection card's "Refresh balance".
     */
    private static function render_product_eligibility_list(): void
    {
        $productIds = get_posts([
            'post_type' => 'product',
            'post_status' => 'publish',
            'posts_per_page' => -1,
            'fields' => 'ids',
            'orderby' => 'title',
            'order' => 'ASC',
        ]);
        update_postmeta_cache($productIds);
        ?>
        <div class="aivastra-card aivastra-eligibility-card">
          <h2 class="aivastra-card-heading"><?php echo self::heading_icon('check-circle'); ?>Eligibility</h2>
          <p class="aivastra-card-description">Turn the Try-On button off for a specific product without changing its category routing. This is the same per-product switch available on that product's own edit screen, gathered here in one place.</p>
          <?php if (empty($productIds)): ?>
            <p class="aivastra-empty-state">No published products yet.</p>
          <?php else: ?>
            <ul class="aivastra-eligibility-list">
              <?php foreach ($productIds as $productId): ?>
                <li class="aivastra-eligibility-row">
                  <span class="aivastra-eligibility-row-name"><?php echo esc_html(get_the_title($productId)); ?></span>
                  <span class="aivastra-eligibility-row-status" aria-live="polite"></span>
                  <label class="aivastra-switch">
                    <input type="checkbox" class="aivastra-eligibility-checkbox" data-product-id="<?php echo esc_attr($productId); ?>" <?php checked(Aivastra_Product_Toggle::is_enabled($productId)); ?>>
                    <span class="aivastra-switch-track" aria-hidden="true"></span>
                  </label>
                </li>
              <?php endforeach; ?>
            </ul>
          <?php endif; ?>
        </div>
        <?php
    }

    /**
     * The Billing sidebar submenu's page content (register_menu(),
     * render_billing()) — the same render_plans() card the one-page
     * dashboard used to show inline, now on its own URL
     * (?page=aivastra-tryon-billing) at the merchant's request. Reuses
     * render_navbar() for the shared logo/menu chrome and the
     * dashboard's own wrap/body classes (aivastra-dashboard-wrap /
     * .aivastra-dashboard, 1400px centred), same as render_categories_page()
     * right above. render_plans()'s own card box is skipped too
     * ($wrapInCard: false) for the same reason it is there — this page has
     * nothing else on it.
     *
     * Still also reachable via the legacy ?page=aivastra-tryon&section=plans
     * query arg (render_gated()'s own short-circuit) — handle_buy()'s
     * redirects (both the error path and the aivastra_checkout=1 success path
     * that auto-opens the Razorpay modal, see enqueue_assets()) and the
     * Connection card's "Buy credits" link now point at the direct
     * aivastra-tryon-billing URL instead, but the old query-arg path is kept
     * working for any existing bookmark.
     */
    private static function render_plans_page(Aivastra_Connection_Settings $settings): void
    {
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-dashboard-wrap">
          <?php self::render_navbar(); ?>

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
     * The Customize sidebar submenu's page content (register_menu(),
     * render_customize()) — the try-on button appearance form
     * (render_widget_customization()), previously stacked inline on the
     * one-page dashboard (render_dashboard()'s doc comment). Same
     * wrap/topbar/body pattern as render_categories_page() and
     * render_plans_page() right above. A separate page heading introduces
     * the appearance card, which groups button settings and popup content.
     */
    private static function render_customize_page(Aivastra_Connection_Settings $settings): void
    {
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-dashboard-wrap">
          <?php self::render_navbar(); ?>

          <div class="aivastra-page-flat-body">
            <?php self::render_notices(); ?>

            <div class="aivastra-dashboard">
              <div class="aivastra-manage-header">
                <h2 class="aivastra-manage-title">Customize</h2>
                <p class="aivastra-page-subtitle">Make the try-on experience feel at home in your store.</p>
              </div>
              <?php self::render_widget_customization($settings); ?>
            </div>
          </div>
        </div>

        <?php self::render_chat_modal(); ?>
        <?php
    }

    /**
     * The Analytics sidebar submenu's page content (register_menu(),
     * render_analytics()) — a page title + subtitle (same
     * .aivastra-manage-header/-title/.aivastra-page-subtitle shape as
     * render_categories_page()'s "Manage" header, matching
     * AnalyticsPage.tsx's own `<Page title="Analytics">`) followed by the
     * stat-tile row, bar chart and Products table (render_analytics_card()).
     * Same wrap/topbar/body pattern as render_categories_page()/
     * render_plans_page()/render_customize_page() above.
     */
    private static function render_analytics_page(Aivastra_Connection_Settings $settings): void
    {
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-dashboard-wrap">
          <?php self::render_navbar(); ?>

          <div class="aivastra-page-flat-body">
            <?php self::render_notices(); ?>

            <div class="aivastra-dashboard">
              <div class="aivastra-manage-header">
                <h2 class="aivastra-manage-title">Analytics</h2>
                <p class="aivastra-page-subtitle">Last 30 days. Try-ons are measured on our servers and are exact; everything else is measured in the shopper's browser and can undercount if blocked.</p>
              </div>

              <?php self::render_analytics_card($settings); ?>
            </div>
          </div>
        </div>

        <?php self::render_chat_modal(); ?>
        <?php
    }

    /**
     * The Support sidebar submenu's page content (register_menu(),
     * render_support_submenu()) — the same two-channel contact card
     * (render_support_card()) also stacked inline at the bottom of the
     * Dashboard (render_dashboard()). Same wrap/topbar/body pattern as the
     * other standalone pages above: render_support_card()'s own card box is
     * skipped ($wrapInCard: false) here too — this page has nothing else on
     * it — while the Dashboard's inline call keeps its card box since it
     * sits alongside other cards there.
     */
    private static function render_support_page(): void
    {
        ?>
        <div class="wrap aivastra-settings-wrap aivastra-dashboard-wrap">
          <?php self::render_navbar(); ?>

          <div class="aivastra-page-flat-body">
            <?php self::render_notices(); ?>

            <div class="aivastra-dashboard">
              <div class="aivastra-manage-header">
                <h2 class="aivastra-manage-title">Support</h2>
                <p class="aivastra-page-subtitle">Get help with setup, billing, or your store’s try-on experience.</p>
              </div>
              <?php self::render_support_card(false); ?>
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
     *
     * The standalone Customize page uses the card beneath its page heading.
     * Popup content stays visible as a separate section within the same form.
     *
     * $showHeading: on by default (what render_customize_page() gets).
     * render_onboarding_button() (step 3) passes false — that step's own page
     * heading and subtext already say what to do, same reasoning as
     * render_category_routing_table()'s own $showHeading.
     */
    private static function render_widget_customization(Aivastra_Connection_Settings $settings, bool $wrapInCard = true, bool $showHeading = true): void
    {
        $c = $settings->get_widget_customization();
        ?>
        <?php if ($wrapInCard): ?><div class="aivastra-card aivastra-widget-customization-card"><?php endif; ?>
          <?php if ($showHeading): ?>
            <h2 class="aivastra-card-heading"><?php echo self::heading_icon('palette'); ?>Try-on button</h2>
            <p class="aivastra-card-description">Customize the colors and text shoppers see in the try-on button and popup. Leave a field blank to use the default.</p>
          <?php endif; ?>
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

            <div class="aivastra-field-pair aivastra-field-pair-wrap">
              <div class="aivastra-field-row">
                <label for="aivastra_widget_button_placement">Button placement</label>
                <select id="aivastra_widget_button_placement" name="aivastra_widget[buttonPlacement]" class="aivastra-select">
                  <option value="after_title" <?php selected($c['buttonPlacement'] ?? 'before_cart', 'after_title'); ?>>Right below the product title</option>
                  <option value="before_cart" <?php selected($c['buttonPlacement'] ?? 'before_cart', 'before_cart'); ?>>Before "Add to Cart" (default)</option>
                  <option value="after_cart" <?php selected($c['buttonPlacement'] ?? 'before_cart', 'after_cart'); ?>>After "Add to Cart"</option>
                </select>
              </div>
            </div>
            <p class="aivastra-field-hint">Some themes override the button's placement — check a live product page after saving.</p>
            <fieldset class="aivastra-customize-section">
              <legend>Popup content &amp; actions</legend>
              <p class="aivastra-field-hint">Leave text fields blank to use the default wording.</p>
              <div class="aivastra-customize-fields">
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
            </fieldset>
            <div class="aivastra-save-row">
              <button type="submit" class="aivastra-btn aivastra-btn-primary">Save appearance</button>
            </div>
          </form>
        <?php if ($wrapInCard): ?></div><?php endif; ?>
        <?php
    }

}
