<?php
declare(strict_types=1);

/**
 * Header search overlay matching shopify.aivastra.com: clicking the search
 * icon opens an in-page modal (input + live results) instead of navigating
 * straight to a search-results page. WooCommerce has no equivalent of
 * Shopify's predictive search, so the live "Products" grid below is our own
 * thin AJAX layer over a normal WP_Query 's' search; "Recently viewed" is
 * tracked client-side in localStorage (assets/search-modal.js) since there's
 * no server-side view history to read.
 *
 * With the demo catalog currently empty (see docs/progress.md), both grids
 * simply render nothing — the sections hide themselves whenever they have no
 * items, which is also correct behavior once real products exist.
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Modal markup — mounted once in the footer of every page, since the
 * trigger icon lives in the navbar on every page.
 */
add_action('wp_footer', function (): void {
    ?>
    <div class="aivastra-search-overlay" hidden>
        <div class="aivastra-search-panel" role="dialog" aria-modal="true" aria-label="Search">
            <form class="aivastra-search-form" action="<?php echo esc_url(home_url('/shop/')); ?>" method="get">
                <svg class="aivastra-search-form-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input type="search" name="s" class="aivastra-search-input" placeholder="Search" autocomplete="off" />
                <button type="button" class="aivastra-search-close" aria-label="Close search">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </form>

            <div class="aivastra-search-recent" hidden>
                <div class="aivastra-search-section-head">
                    <h3>Recently viewed</h3>
                    <a href="#" class="aivastra-search-recent-clear">Clear</a>
                </div>
                <div class="aivastra-search-recent-grid"></div>
            </div>

            <div class="aivastra-search-products" hidden>
                <div class="aivastra-search-section-head">
                    <h3>Products</h3>
                </div>
                <div class="aivastra-search-products-grid"></div>
            </div>
        </div>
    </div>
    <?php
});

/**
 * Live product results — same 's' search WooCommerce's own search page runs,
 * just returned as an HTML fragment for the modal instead of a full page.
 */
add_action('wp_ajax_aivastra_search_products', 'aivastra_search_products_ajax');
add_action('wp_ajax_nopriv_aivastra_search_products', 'aivastra_search_products_ajax');

function aivastra_search_products_ajax(): void
{
    check_ajax_referer('aivastra_search_modal', 'nonce');

    $term = isset($_POST['term']) ? sanitize_text_field(wp_unslash($_POST['term'])) : '';

    $args = [
        'post_type' => 'product',
        'post_status' => 'publish',
        'posts_per_page' => 4,
        'orderby' => 'date',
        'order' => 'DESC',
    ];
    if ($term !== '') {
        $args['s'] = $term;
    }

    $query = new WP_Query($args);

    ob_start();
    if ($query->have_posts()) {
        while ($query->have_posts()) {
            $query->the_post();
            $product = wc_get_product(get_the_ID());
            if (!$product instanceof WC_Product) {
                continue;
            }
            ?>
            <a class="aivastra-search-card" href="<?php the_permalink(); ?>">
                <?php echo $product->get_image('woocommerce_thumbnail'); // phpcs:ignore WordPress.Security.EscapeOutput ?>
                <p class="aivastra-search-card-title"><?php the_title(); ?></p>
                <p class="aivastra-search-card-price"><?php echo $product->get_price_html(); // phpcs:ignore WordPress.Security.EscapeOutput ?></p>
            </a>
            <?php
        }
    }
    wp_reset_postdata();
    $html = ob_get_clean();

    wp_send_json_success(['html' => $html]);
}

/**
 * Assets + the current single-product's data (used to seed "Recently
 * viewed" client-side — see assets/search-modal.js).
 */
add_action('wp_enqueue_scripts', function (): void {
    $path = get_stylesheet_directory() . '/assets/search-modal.js';
    wp_enqueue_script(
        'aivastra-search-modal',
        get_stylesheet_directory_uri() . '/assets/search-modal.js',
        [],
        file_exists($path) ? (string) filemtime($path) : '1.0.0',
        true
    );

    $currentProduct = null;
    if (function_exists('is_product') && is_product()) {
        $product = wc_get_product(get_queried_object_id());
        if ($product instanceof WC_Product) {
            $currentProduct = [
                'id' => $product->get_id(),
                'title' => $product->get_name(),
                'url' => get_permalink($product->get_id()),
                'image' => wp_get_attachment_image_url($product->get_image_id(), 'woocommerce_thumbnail') ?: wc_placeholder_img_src(),
                'price' => $product->get_price_html(),
            ];
        }
    }

    wp_localize_script('aivastra-search-modal', 'aivastraSearchModal', [
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('aivastra_search_modal'),
        'currentProduct' => $currentProduct,
    ]);
}, 21);
