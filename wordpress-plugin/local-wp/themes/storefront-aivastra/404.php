<?php
/**
 * 404 page matching shopify.aivastra.com's broken-link page: "Page not
 * found", a short subtext, a black "Continue shopping" button, and a
 * "Discover something new" product carousel — replacing Storefront's
 * default 404 template (a WooCommerce product-search box, a "Popular
 * Products" section and a "Product Categories" sidebar nav), none of which
 * the reference has.
 *
 * @package storefront-aivastra
 */

get_header();

$shopUrl = function_exists('wc_get_page_permalink') ? wc_get_page_permalink('shop') : home_url('/shop/');
?>

<div id="primary" class="content-area">
    <main id="main" class="site-main aivastra-404" role="main">
        <div class="aivastra-404-content">
            <h1 class="aivastra-404-title"><?php esc_html_e('Page not found', 'storefront'); ?></h1>
            <p class="aivastra-404-subtitle"><?php esc_html_e('The link may be incorrect, or the page has been removed.', 'storefront'); ?></p>
            <a href="<?php echo esc_url($shopUrl); ?>" class="aivastra-404-continue"><?php esc_html_e('Continue shopping', 'storefront'); ?></a>
        </div>

        <?php if (storefront_is_woocommerce_activated()) : ?>
            <section class="aivastra-404-discover">
                <h2><?php esc_html_e('Discover something new', 'storefront'); ?></h2>
                <?php echo do_shortcode('[products limit="4" columns="4" orderby="date" order="DESC"]'); ?>
            </section>
        <?php endif; ?>
    </main>
</div>

<?php
get_footer();
