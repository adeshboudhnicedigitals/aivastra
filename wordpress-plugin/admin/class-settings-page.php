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
    // LOCAL DEV OVERRIDE: points at the host machine's `pnpm --filter
    // @aivastra/api dev` (port 4000 per apps/api/src/env.ts's API_PORT
    // default). host.docker.internal, not localhost — this plugin runs
    // inside the WordPress container, which has its own network namespace;
    // `localhost` there means the container itself, not the host machine.
    // Revert to 'https://api.aivastra.com' before any real/staging use.
    private const API_BASE = 'http://host.docker.internal:4000';

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
     * Re-verifies the full key and updates the displayed company/credits
     * snapshot — deliberately does NOT touch the stored widget key, so
     * refreshing the balance never requires re-entering it.
     */
    public static function handle_refresh(): void
    {
        check_admin_referer('aivastra_tryon_refresh');

        $fullKey = self::sanitize_key_input((string) ($_POST['aivastra_full_key'] ?? ''));
        $redirectArgs = ['page' => 'aivastra-tryon'];

        if ($fullKey === '') {
            $redirectArgs['aivastra_error'] = 'invalid_key_format';
        } else {
            $settings = new Aivastra_Connection_Settings();
            $service = new Aivastra_Connection_Service($settings, self::API_BASE);
            $result = $service->refresh($fullKey);
            $redirectArgs[$result['ok'] ? 'aivastra_refreshed' : 'aivastra_error'] =
                $result['ok'] ? '1' : ($result['error'] ?? 'unknown');
        }

        wp_safe_redirect(add_query_arg($redirectArgs, admin_url('options-general.php')));
        exit;
    }

    /**
     * Wipes the entire connection — widget key, snapshot, and category
     * mapping — via Aivastra_Connection_Settings::clear(). No fields, no
     * confirmation dance beyond WordPress's own nonce check; the button
     * itself is the confirmation (see the manual QA note in the plan this
     * was implemented from about not over-building a confirm-modal for a
     * reversible action — reconnecting just requires pasting keys again).
     */
    public static function handle_disconnect(): void
    {
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

    public static function render(): void
    {
        $settings = new Aivastra_Connection_Settings();
        $companyName = $settings->get_company_name();
        $creditsAsOf = $settings->get_credits_as_of();
        ?>
        <div class="wrap">
          <h1>Aivastra Try-On</h1>
          <?php if ($companyName !== null): ?>
            <p>Connected as <strong><?php echo esc_html($companyName); ?></strong>
               (as of <?php echo esc_html($creditsAsOf ?? 'unknown'); ?>).</p>
          <?php else: ?>
            <p>Not connected yet.</p>
          <?php endif; ?>
          <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="aivastra_tryon_connect">
            <?php wp_nonce_field('aivastra_tryon_connect'); ?>
            <table class="form-table">
              <tr>
                <th><label for="aivastra_full_key">Full API key</label></th>
                <td><input type="password" id="aivastra_full_key" name="aivastra_full_key" class="regular-text" autocomplete="off"></td>
              </tr>
              <tr>
                <th><label for="aivastra_widget_key">Widget API key</label></th>
                <td><input type="password" id="aivastra_widget_key" name="aivastra_widget_key" class="regular-text" autocomplete="off"></td>
              </tr>
            </table>
            <?php submit_button('Test connection'); ?>
          </form>

          <?php if ($companyName !== null): ?>
            <?php self::render_category_mapping($settings); ?>
          <?php endif; ?>
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
        <hr>
        <h2>Try-on category mapping</h2>
        <?php if (!$result['ok']): ?>
          <p>Could not load your aivastra categories right now — try reloading this page.</p>
        <?php elseif (empty($result['categories'])): ?>
          <p>No active try-on categories are configured on your aivastra account yet. Every product
             will use the <code>general</code> category until one exists.</p>
        <?php elseif (empty($productCategories)): ?>
          <p>No WooCommerce product categories found — every product uses the
             <code>general</code> try-on category.</p>
        <?php else: ?>
          <p>Pick which aivastra try-on workflow applies to each WooCommerce product category.
             A category left as "Default" falls back to <code>general</code>.</p>
          <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="aivastra_tryon_save_category_map">
            <?php wp_nonce_field('aivastra_tryon_save_category_map'); ?>
            <table class="form-table">
              <?php foreach ($productCategories as $term): ?>
                <tr>
                  <th><label for="aivastra-cat-map-<?php echo esc_attr($term->term_id); ?>"><?php echo esc_html($term->name); ?></label></th>
                  <td>
                    <select id="aivastra-cat-map-<?php echo esc_attr($term->term_id); ?>" name="aivastra_category_map[<?php echo esc_attr($term->term_id); ?>]">
                      <option value="">Default (general)</option>
                      <?php foreach ($result['categories'] as $cat): ?>
                        <option value="<?php echo esc_attr($cat['slug']); ?>" <?php selected($currentMap[$term->term_id] ?? '', $cat['slug']); ?>>
                          <?php echo esc_html($cat['name']); ?>
                        </option>
                      <?php endforeach; ?>
                    </select>
                  </td>
                </tr>
              <?php endforeach; ?>
            </table>
            <?php submit_button('Save category mapping'); ?>
          </form>
        <?php endif; ?>
        <?php
    }
}
