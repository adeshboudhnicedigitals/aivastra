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
    ];

    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'register_menu']);
        add_action('admin_enqueue_scripts', [self::class, 'enqueue_assets']);
        add_action('admin_post_aivastra_tryon_connect', [self::class, 'handle_connect']);
        add_action('admin_post_aivastra_tryon_refresh', [self::class, 'handle_refresh']);
        add_action('admin_post_aivastra_tryon_disconnect', [self::class, 'handle_disconnect']);
        add_action('admin_post_aivastra_tryon_save_category_map', [self::class, 'handle_save_category_map']);
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
        $redirectArgs = ['page' => 'aivastra-tryon'];

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

    private static function icon(string $name): string
    {
        return self::ICONS[$name] ?? '';
    }

    public static function render(): void
    {
        $settings = new Aivastra_Connection_Settings();
        $companyName = $settings->get_company_name();
        $credits = $settings->get_credits();
        $creditsAsOf = $settings->get_credits_as_of();
        $connected = $companyName !== null;
        ?>
        <div class="wrap aivastra-settings-wrap">
          <div class="aivastra-page-header">
            <h1>Aivastra Try-On</h1>
            <p class="aivastra-page-subtitle">Manage the connection powering your storefront's virtual try-on button.</p>
          </div>

          <?php self::render_notices(); ?>

          <?php if ($connected): ?>
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
          <?php else: ?>
            <div class="aivastra-card aivastra-connect-card">
              <h2 class="aivastra-connect-heading">Connect your Aivastra account</h2>
              <p class="aivastra-connect-description">Paste two keys from your Aivastra dashboard to enable virtual try-on on your storefront.</p>
              <?php self::render_connect_form(); ?>
            </div>
          <?php endif; ?>

          <?php if ($connected): ?>
            <?php self::render_category_mapping($settings); ?>
          <?php endif; ?>
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
          <h2 class="aivastra-card-heading">Try-on category mapping</h2>
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
