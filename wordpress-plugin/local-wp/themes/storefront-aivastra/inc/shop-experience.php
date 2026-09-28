<?php
declare(strict_types=1);

/**
 * Shop/collection archive experience matching shopify.aivastra.com's
 * collections pages: a left filter panel (Availability, Price), a
 * relabeled sort dropdown, a column-density toggle, and infinite scroll
 * in place of numbered pagination.
 *
 * WooCommerce already does more of this natively than it looks like:
 *  - `min_price`/`max_price` GET params are auto-applied to the main query
 *    by WC_Query::price_filter_post_clauses() regardless of whether its
 *    official widget is on the page — our price inputs just need those
 *    names.
 *  - WC_Query::get_catalog_ordering_args() already parses any
 *    `{key}-{asc|desc}` orderby value generically (title, date, price all
 *    work out of the box) — the sort dropdown only needed relabeling, not
 *    a new ordering implementation.
 * What WooCommerce has no equivalent for at all: stock-status filtering,
 * infinite scroll, and a column-density toggle — those are built below.
 */

if (!defined('ABSPATH')) {
    exit;
}

function aivastra_is_shop_experience_page(): bool
{
    return is_shop() || is_product_taxonomy();
}

/**
 * 1. Sort dropdown — relabeled to match the reference. Every key here is
 * either a native WooCommerce orderby ('menu_order', 'popularity', 'price',
 * 'price-desc') or a generic `{key}-{asc|desc}` combination WC's own
 * get_catalog_ordering_args() already parses without any extra code
 * ('title-asc', 'title-desc', 'date-asc', 'date-desc'). 'relevance' is
 * WooCommerce's own search-relevance key; outside of an actual search
 * (i.e. on every collection browse, since this is never a search results
 * page) WP_Query has no relevance signal to sort by and silently falls
 * back to default order — same honest limitation Shopify's own "Most
 * relevant" has on a plain collection browse with no search query.
 */
add_filter('woocommerce_catalog_orderby', function (): array {
    return [
        'menu_order' => 'Featured',
        'relevance' => 'Most relevant',
        'popularity' => 'Best selling',
        'title-asc' => 'Alphabetically, A-Z',
        'title-desc' => 'Alphabetically, Z-A',
        'price' => 'Price, low to high',
        'price-desc' => 'Price, high to low',
        'date-asc' => 'Date, old to new',
        'date-desc' => 'Date, new to old',
    ];
});

/**
 * 2. Stock-status filter — WooCommerce has no built-in query var for this
 * (unlike price), so it needs its own pre_get_posts hook.
 */
function aivastra_requested_stock_statuses(): array
{
    $requested = isset($_GET['stock_status']) ? (array) wp_unslash($_GET['stock_status']) : [];
    $allowed = ['instock', 'outofstock'];
    return array_values(array_intersect($allowed, array_map('sanitize_key', $requested)));
}

add_action('pre_get_posts', function (WP_Query $query): void {
    if (is_admin() || !$query->is_main_query() || !aivastra_is_shop_experience_page()) {
        return;
    }

    $statuses = aivastra_requested_stock_statuses();
    if (empty($statuses)) {
        return;
    }

    $metaQuery = (array) $query->get('meta_query');
    $metaQuery[] = [
        'key' => '_stock_status',
        'value' => $statuses,
        'compare' => 'IN',
    ];
    $query->set('meta_query', $metaQuery);
});

/**
 * 3. Highest price in the current view — for the price field's hint text,
 * same as the reference's "The highest price is Rs. X".
 */
function aivastra_current_shop_max_price(): float
{
    global $wpdb;

    $productIds = [];
    if (is_product_taxonomy()) {
        $term = get_queried_object();
        if ($term instanceof WP_Term) {
            $productIds = get_objects_in_term($term->term_id, $term->taxonomy);
        }
    }

    $sql = "SELECT MAX(CAST(meta_value AS DECIMAL(10,2))) FROM {$wpdb->postmeta} WHERE meta_key = '_price'";
    if (!empty($productIds)) {
        $placeholders = implode(',', array_fill(0, count($productIds), '%d'));
        $sql = $wpdb->prepare($sql . " AND post_id IN ({$placeholders})", $productIds); // phpcs:ignore
    }

    $max = $wpdb->get_var($sql); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
    return $max ? (float) $max : 0.0;
}

/**
 * 4. Toolbar wrapper — a single horizontal row, not a sidebar. This
 * matches the reference collection template's `filter_style: "horizontal"`
 * setting: Availability + Price render as dropdown pills (below), and
 * WooCommerce's own sorting hooks (priority 9-31 on this same action, added
 * by Storefront's storefront-woocommerce-template-hooks.php) and our
 * density toggle (priority 35) land inside this same still-open div, so
 * everything ends up as one flex row. Closed at priority 40, after all of
 * those have printed but before the product grid itself.
 */
add_action('woocommerce_before_shop_loop', function (): void {
    if (!aivastra_is_shop_experience_page()) {
        return;
    }
    echo '<div class="aivastra-shop-toolbar">';
    aivastra_render_shop_filters();
}, 1);

add_action('woocommerce_before_shop_loop', function (): void {
    if (!aivastra_is_shop_experience_page()) {
        return;
    }
    echo '</div>';
}, 40);

/**
 * 5. Filter dropdowns — price range (native WC query vars) + stock status
 * (custom, above), each a collapsed <details>/<summary> pill matching the
 * reference's "Availability ⌄" / "Price ⌄" toolbar buttons instead of an
 * always-expanded sidebar section. "Clear all" links back to the bare
 * archive URL.
 */
function aivastra_render_shop_filters(): void
{
    $baseUrl = is_product_taxonomy() ? (string) get_term_link(get_queried_object()) : (string) wc_get_page_permalink('shop');
    $minPrice = isset($_GET['min_price']) ? sanitize_text_field(wp_unslash($_GET['min_price'])) : '';
    $maxPrice = isset($_GET['max_price']) ? sanitize_text_field(wp_unslash($_GET['max_price'])) : '';
    $statuses = aivastra_requested_stock_statuses();
    $highest = aivastra_current_shop_max_price();
    $hasActiveFilters = ($minPrice !== '' || $maxPrice !== '' || !empty($statuses));
    ?>
    <?php if ($hasActiveFilters) : ?>
        <div class="aivastra-shop-active-filters">
            <span>Active filters:</span>
            <a href="<?php echo esc_url($baseUrl); ?>" class="aivastra-shop-clear-all">Clear all</a>
        </div>
    <?php endif; ?>

    <form method="get" action="<?php echo esc_url($baseUrl); ?>" class="aivastra-shop-filter-form">
        <details class="aivastra-shop-filter-dropdown" name="aivastra-shop-filter">
            <summary>Availability</summary>
            <div class="aivastra-shop-filter-panel">
                <label class="aivastra-shop-checkbox">
                    <input type="checkbox" name="stock_status[]" value="instock" <?php checked(in_array('instock', $statuses, true)); ?> onchange="this.form.submit()" />
                    <span>In stock</span>
                </label>
                <label class="aivastra-shop-checkbox">
                    <input type="checkbox" name="stock_status[]" value="outofstock" <?php checked(in_array('outofstock', $statuses, true)); ?> onchange="this.form.submit()" />
                    <span>Out of stock</span>
                </label>
            </div>
        </details>

        <details class="aivastra-shop-filter-dropdown" name="aivastra-shop-filter">
            <summary>Price</summary>
            <div class="aivastra-shop-filter-panel aivastra-shop-filter-panel--price">
                <div class="aivastra-shop-price-row">
                    <input type="number" name="min_price" min="0" placeholder="₹ Min" value="<?php echo esc_attr($minPrice); ?>" />
                    <span>to</span>
                    <input type="number" name="max_price" min="0" placeholder="₹ Max" value="<?php echo esc_attr($maxPrice); ?>" />
                </div>
                <?php if ($highest > 0) : ?>
                    <p class="aivastra-shop-price-hint">The highest price is <?php echo wc_price($highest); ?></p>
                <?php endif; ?>
                <button type="submit" class="aivastra-shop-filter-submit">Apply</button>
            </div>
        </details>
    </form>
    <?php
}

/**
 * 6. Column-density toggle — persisted per-browser in localStorage
 * (js/shop-experience.js), no server state.
 */
add_action('woocommerce_before_shop_loop', function (): void {
    if (!aivastra_is_shop_experience_page()) {
        return;
    }
    ?>
    <div class="aivastra-shop-density" role="group" aria-label="Column grid">
        <button type="button" class="aivastra-density-btn" data-cols="3" aria-label="3 columns">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="4" width="5" height="16" rx="1"/><rect x="9.5" y="4" width="5" height="16" rx="1"/><rect x="17" y="4" width="5" height="16" rx="1"/></svg>
        </button>
        <button type="button" class="aivastra-density-btn" data-cols="4" aria-label="4 columns">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="1" y="4" width="4" height="16" rx="1"/><rect x="7" y="4" width="4" height="16" rx="1"/><rect x="13" y="4" width="4" height="16" rx="1"/><rect x="19" y="4" width="4" height="16" rx="1"/></svg>
        </button>
        <button type="button" class="aivastra-density-btn is-active" data-cols="5" aria-label="5 columns">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="0.5" y="4" width="3.4" height="16" rx="1"/><rect x="5.3" y="4" width="3.4" height="16" rx="1"/><rect x="10.1" y="4" width="3.4" height="16" rx="1"/><rect x="14.9" y="4" width="3.4" height="16" rx="1"/><rect x="19.7" y="4" width="3.4" height="16" rx="1"/></svg>
        </button>
    </div>
    <?php
}, 35);

/**
 * 7. Infinite scroll — replaces numbered pagination with a sentinel +
 * AJAX loader (js/shop-experience.js).
 *
 * Storefront's own template hooks (storefront-woocommerce-template-hooks.php)
 * print pagination TWICE at priority 30, not WooCommerce's default single
 * instance at priority 10: once after the loop (`woocommerce_pagination`)
 * and once again before the loop (`storefront_woocommerce_pagination`, its
 * "page number at the top" wrapper). Both must be removed at priority 30 —
 * removing only WooCommerce's default priority-10 hook is a silent no-op
 * once Storefront has already relocated it.
 *
 * Storefront duplicates its whole sort/result-count/pagination group on
 * BOTH `woocommerce_before_shop_loop` and `woocommerce_after_shop_loop`
 * (storefront-woocommerce-template-hooks.php, priorities 9/10/20/30/31 on
 * each) — one above the loop, one below. Above is what we want (folded into
 * .aivastra-shop-toolbar); below is a redundant second sort dropdown +
 * "Showing 1–16 of 372 results" printing under the infinite-scroll sentinel,
 * which the reference never has. The "Showing..." text itself is dropped
 * everywhere too — the reference toolbar never renders a visible result
 * count (only a `data-results-count` attribute it doesn't display).
 */
add_action('wp', function (): void {
    if (aivastra_is_shop_experience_page()) {
        remove_action('woocommerce_after_shop_loop', 'storefront_sorting_wrapper', 9);
        remove_action('woocommerce_after_shop_loop', 'woocommerce_catalog_ordering', 10);
        remove_action('woocommerce_after_shop_loop', 'woocommerce_result_count', 20);
        remove_action('woocommerce_after_shop_loop', 'woocommerce_pagination', 30);
        remove_action('woocommerce_after_shop_loop', 'storefront_sorting_wrapper_close', 31);
        remove_action('woocommerce_before_shop_loop', 'storefront_woocommerce_pagination', 30);
        remove_action('woocommerce_before_shop_loop', 'woocommerce_result_count', 20);
    }
});

add_action('woocommerce_after_shop_loop', function (): void {
    if (!aivastra_is_shop_experience_page()) {
        return;
    }
    global $wp_query;
    $maxPages = max(1, (int) $wp_query->max_num_pages);
    if ($maxPages <= 1) {
        return;
    }
    ?>
    <div
        class="aivastra-shop-infinite-sentinel"
        data-page="1"
        data-max-pages="<?php echo esc_attr((string) $maxPages); ?>"
        data-query="<?php echo esc_attr(wp_json_encode(aivastra_current_archive_query_vars())); ?>"
    >
        <span class="aivastra-shop-infinite-spinner" aria-hidden="true"></span>
    </div>
    <?php
}, 5);

/**
 * Query vars the AJAX handler needs to reproduce the exact same result
 * set as the page's own main query, for the next page of results.
 */
function aivastra_current_archive_query_vars(): array
{
    return [
        'category' => is_product_taxonomy() ? (get_queried_object()->slug ?? '') : '',
        'orderby' => isset($_GET['orderby']) ? sanitize_text_field(wp_unslash($_GET['orderby'])) : '',
        'min_price' => isset($_GET['min_price']) ? sanitize_text_field(wp_unslash($_GET['min_price'])) : '',
        'max_price' => isset($_GET['max_price']) ? sanitize_text_field(wp_unslash($_GET['max_price'])) : '',
        'stock_status' => aivastra_requested_stock_statuses(),
    ];
}

add_action('wp_ajax_aivastra_load_more_products', 'aivastra_load_more_products');
add_action('wp_ajax_nopriv_aivastra_load_more_products', 'aivastra_load_more_products');

function aivastra_load_more_products(): void
{
    check_ajax_referer('aivastra_shop_experience', 'nonce');

    $page = max(2, (int) ($_POST['page'] ?? 2));
    $vars = is_array($_POST['query'] ?? null) ? wp_unslash($_POST['query']) : [];

    $args = [
        'post_type' => 'product',
        'post_status' => 'publish',
        'paged' => $page,
        'posts_per_page' => wc_get_default_products_per_row() * wc_get_default_product_rows_per_page(),
    ];

    if (!empty($vars['category'])) {
        $args['tax_query'] = [[
            'taxonomy' => 'product_cat',
            'field' => 'slug',
            'terms' => sanitize_title((string) $vars['category']),
        ]];
    }

    $statuses = array_values(array_intersect(['instock', 'outofstock'], array_map('sanitize_key', (array) ($vars['stock_status'] ?? []))));
    $metaQuery = [];
    if (!empty($statuses)) {
        $metaQuery[] = ['key' => '_stock_status', 'value' => $statuses, 'compare' => 'IN'];
    }
    $minPrice = isset($vars['min_price']) && $vars['min_price'] !== '' ? (float) $vars['min_price'] : null;
    $maxPrice = isset($vars['max_price']) && $vars['max_price'] !== '' ? (float) $vars['max_price'] : null;
    if ($minPrice !== null || $maxPrice !== null) {
        $metaQuery[] = [
            'key' => '_price',
            'value' => [$minPrice ?? 0, $maxPrice ?? PHP_INT_MAX],
            'type' => 'DECIMAL(10,2)',
            'compare' => 'BETWEEN',
        ];
    }
    if (!empty($metaQuery)) {
        $args['meta_query'] = $metaQuery; // phpcs:ignore WordPress.DB.SlowDBQuery
    }

    $ordering = WC()->query->get_catalog_ordering_args((string) ($vars['orderby'] ?? ''));
    $args['orderby'] = $ordering['orderby'];
    $args['order'] = $ordering['order'];
    if (!empty($ordering['meta_key'])) {
        $args['meta_key'] = $ordering['meta_key']; // phpcs:ignore WordPress.DB.SlowDBQuery
    }

    $query = new WP_Query($args);

    ob_start();
    if ($query->have_posts()) {
        while ($query->have_posts()) {
            $query->the_post();
            wc_get_template_part('content', 'product');
        }
    }
    wp_reset_postdata();
    $html = ob_get_clean();

    wp_send_json_success([
        'html' => $html,
        'hasMore' => $page < (int) $query->max_num_pages,
    ]);
}

/**
 * 8. Assets.
 */
add_action('wp_enqueue_scripts', function (): void {
    if (!aivastra_is_shop_experience_page()) {
        return;
    }
    $path = get_stylesheet_directory() . '/assets/shop-experience.js';
    wp_enqueue_script(
        'aivastra-shop-experience',
        get_stylesheet_directory_uri() . '/assets/shop-experience.js',
        [],
        file_exists($path) ? (string) filemtime($path) : '1.0.0',
        true
    );
    wp_localize_script('aivastra-shop-experience', 'aivastraShopExperience', [
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('aivastra_shop_experience'),
    ]);
}, 20);
