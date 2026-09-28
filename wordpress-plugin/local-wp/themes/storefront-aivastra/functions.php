<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

require_once get_stylesheet_directory() . '/inc/shop-experience.php';
require_once get_stylesheet_directory() . '/inc/search-modal.php';
require_once get_stylesheet_directory() . '/inc/product-page.php';
require_once get_stylesheet_directory() . '/inc/cart-drawer.php';
require_once get_stylesheet_directory() . '/inc/account-popover.php';

/**
 * "You may also like" matching the reference (WooCommerce's default is
 * "Related products").
 */
add_filter('woocommerce_product_related_products_heading', function (): string {
    return 'You may also like';
});

/**
 * Price display matching shopify.aivastra.com: "Rs. 2,999.00 INR" —
 * "Rs." symbol (not "₹") plus a trailing currency-code suffix, which
 * WooCommerce doesn't support out of the box.
 */
add_filter('woocommerce_currency_symbol', function (string $symbol, string $currency): string {
    return $currency === 'INR' ? 'Rs.' : $symbol;
}, 10, 2);

add_filter('woocommerce_price_format', function (string $format, string $symbolPos): string {
    if (get_woocommerce_currency() !== 'INR') {
        return $format;
    }
    return '%1$s %2$s INR';
}, 10, 2);

/**
 * Enqueue modern fonts and child theme stylesheet.
 */
add_action('wp_enqueue_scripts', function (): void {
    // Google Fonts: Inter (matching shopify.aivastra.com typography)
    wp_enqueue_style(
        'aivastra-google-fonts',
        'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
        [],
        null
    );

    wp_enqueue_style('storefront-style', get_template_directory_uri() . '/style.css');

    $deps = ['storefront-style'];
    if (wp_style_is('storefront-woocommerce-style', 'registered')) {
        $deps[] = 'storefront-woocommerce-style';
    }

    $stylePath = get_stylesheet_directory() . '/style.css';
    $version = file_exists($stylePath) ? (string) filemtime($stylePath) : wp_get_theme()->get('Version');

    wp_enqueue_style(
        'storefront-aivastra-style',
        get_stylesheet_directory_uri() . '/style.css',
        $deps,
        $version
    );

    // Force footer to white — Storefront injects an inline <style> from customizer
    // that sets background-color on .site-footer. We override it with !important here
    // so our simple white footer shows correctly regardless of saved customizer values.
    wp_add_inline_style('storefront-aivastra-style', '
        .site-footer { background-color: #ffffff !important; color: #6b7280 !important; }
        .site-footer .col-full { background-color: #ffffff !important; }
    ');
}, 999);

/**
 * Clean up default Storefront header hooks and replace with unified luxury navbar.
 */
add_action('init', function (): void {
    // Remove fragmented Storefront header actions
    remove_action('storefront_header', 'storefront_header_container', 0);
    remove_action('storefront_header', 'storefront_skip_links', 5);
    remove_action('storefront_header', 'storefront_site_branding', 20);
    remove_action('storefront_header', 'storefront_secondary_navigation', 30);
    remove_action('storefront_header', 'storefront_product_search', 40);
    remove_action('storefront_header', 'storefront_header_container_close', 41);
    remove_action('storefront_header', 'storefront_primary_navigation_wrapper', 42);
    remove_action('storefront_header', 'storefront_primary_navigation', 50);
    remove_action('storefront_header', 'storefront_header_cart', 60);
    remove_action('storefront_header', 'storefront_primary_navigation_wrapper_close', 68);

    // Mount unified navbar matching shopify.aivastra.com
    add_action('storefront_header', 'aivastra_custom_navbar', 20);

    // Remove Storefront default footer credit & widgets to mount modern clean footer
    remove_action('storefront_footer', 'storefront_credit', 20);
    remove_action('storefront_footer', 'storefront_footer_widgets', 10);
    add_action('storefront_footer', 'aivastra_luxury_footer', 20);
});

/**
 * Unified navbar matching shopify.aivastra.com:
 * [Logo] [Center Navigation: HOME, MEN, WOMEN, CONTACT] [Search, Account, Cart outline icons]
 */
function aivastra_custom_navbar(): void {
    $myAccountUrl = function_exists('wc_get_page_permalink') ? wc_get_page_permalink('myaccount') : home_url('/my-account');
    $cartUrl = function_exists('wc_get_page_permalink') ? wc_get_page_permalink('cart') : home_url('/cart');
    $cartCount = function_exists('WC') && WC()->cart ? WC()->cart->get_cart_contents_count() : 0;
    ?>
    <div class="col-full aivastra-navbar">
        <div class="aivastra-nav-brand">
            <?php storefront_site_title_or_logo(); ?>
        </div>

        <div class="aivastra-nav-menu">
            <?php storefront_primary_navigation(); ?>
        </div>

        <div class="aivastra-nav-actions">
            <!-- Minimal search icon — opens the predictive-search overlay (assets/search-modal.js);
                 the href is a plain-search fallback for when JS hasn't loaded. -->
            <a href="<?php echo esc_url(home_url('/shop/?s=')); ?>" class="aivastra-nav-icon aivastra-search-trigger" aria-label="Search" title="Search">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </a>

            <!-- Minimal account icon -->
            <a href="<?php echo esc_url($myAccountUrl); ?>" class="aivastra-nav-icon aivastra-account-trigger" aria-label="Account" title="Account">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </a>

            <!-- Minimal shopping bag icon matching shopify.aivastra.com -->
            <a href="<?php echo esc_url($cartUrl); ?>" class="aivastra-nav-icon aivastra-nav-cart aivastra-cart-trigger" aria-label="Shopping Bag" title="Cart">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                <span class="aivastra-nav-cart-badge<?php echo $cartCount > 0 ? '' : ' aivastra-badge-hidden'; ?>"<?php echo $cartCount > 0 ? '' : ' style="display:none;"'; ?>><?php echo esc_html((string)$cartCount); ?></span>
            </a>
        </div>
    </div>
    <?php
}

/**
 * Remove ugly "Home" page header on the front page and sidebar on catalog pages.
 */
add_action('wp', function (): void {
    if (is_front_page() || is_page('contact') || is_cart()) {
        // The reference cart page has no separate "Cart" title — its empty-state
        // heading ("Your cart is empty") is the only heading on the page.
        remove_action('storefront_page', 'storefront_page_header', 10);
    }
    if (is_product() || is_cart() || is_checkout() || is_front_page() || is_shop() || is_product_taxonomy() || is_page('contact') || is_account_page() || is_404()) {
        remove_action('storefront_sidebar', 'storefront_get_sidebar', 10);
    }
    if (is_shop() || is_product_taxonomy() || is_cart() || is_page('contact') || is_account_page() || is_404() || is_product()) {
        // The reference collection page never shows a breadcrumb — the "Men's
        // Wear" heading sits ~48px below the header. Storefront's default
        // breadcrumb block alone (padding + a 1.618em-derived margin-bottom)
        // was adding ~150px of dead space above the heading here. The
        // reference cart and contact pages have no breadcrumb either, and
        // My account (never itself rendered by the reference — it redirects
        // to Shopify's hosted login) is kept consistent with every other page.
        // The reference 404 page ("Page not found") has no breadcrumb either.
        // Single product pages ("Home / Men's Wear / <product>") don't show
        // one either.
        remove_action('storefront_before_content', 'woocommerce_breadcrumb', 10);
    }
});

/**
 * Simple Shopify-style footer matching shopify.aivastra.com:
 * Centered email signup, minimal copyright, pure white background.
 */
function aivastra_luxury_footer(): void {
    $year = (int) date('Y');
    ?>
    <div class="aivastra-simple-footer" id="shopify-footer">
        <div class="aivastra-simple-footer-inner">
            <div class="aivastra-simple-footer-row">
                <div class="aivastra-simple-footer-text">
                    <h2 class="aivastra-simple-footer-heading">Join our email list</h2>
                    <p class="aivastra-simple-footer-sub">Get exclusive deals and early access to new products.</p>
                </div>

                <form class="aivastra-simple-footer-form" onsubmit="event.preventDefault(); this.querySelector('input').value=''; this.querySelector('input').placeholder='Subscribed!';">
                    <input type="email" placeholder="Email address" aria-label="Email address" required />
                    <button type="submit" aria-label="Subscribe">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </button>
                </form>
            </div>

            <div class="aivastra-simple-footer-divider"></div>

            <div class="aivastra-simple-footer-copy">
                <span>&copy; <?php echo esc_html((string) $year); ?> AI Vastra Demo, Powered by WordPress</span>
                <a href="#">Terms and Policies</a>
            </div>
        </div>
    </div>
    <?php
}
