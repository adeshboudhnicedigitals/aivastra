<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

require_once get_stylesheet_directory() . '/inc/shop-experience.php';

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
            <!-- Minimal search icon -->
            <a href="<?php echo esc_url(home_url('/shop/?s=')); ?>" class="aivastra-nav-icon" aria-label="Search" title="Search">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </a>

            <!-- Minimal account icon -->
            <a href="<?php echo esc_url($myAccountUrl); ?>" class="aivastra-nav-icon" aria-label="Account" title="Account">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </a>

            <!-- Minimal shopping bag icon matching shopify.aivastra.com -->
            <a href="<?php echo esc_url($cartUrl); ?>" class="aivastra-nav-icon aivastra-nav-cart" aria-label="Shopping Bag" title="Cart">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                <?php if ($cartCount > 0) : ?>
                    <span class="aivastra-nav-cart-badge"><?php echo esc_html((string)$cartCount); ?></span>
                <?php endif; ?>
            </a>
        </div>
    </div>
    <?php
}

/**
 * Remove ugly "Home" page header on the front page and sidebar on catalog pages.
 */
add_action('wp', function (): void {
    if (is_front_page() || is_page('contact')) {
        remove_action('storefront_page', 'storefront_page_header', 10);
    }
    if (is_product() || is_cart() || is_checkout() || is_front_page() || is_shop() || is_product_taxonomy() || is_page('contact')) {
        remove_action('storefront_sidebar', 'storefront_get_sidebar', 10);
    }
    if (is_shop() || is_product_taxonomy()) {
        // The reference collection page never shows a breadcrumb — the "Men's
        // Wear" heading sits ~48px below the header. Storefront's default
        // breadcrumb block alone (padding + a 1.618em-derived margin-bottom)
        // was adding ~150px of dead space above the heading here.
        remove_action('storefront_before_content', 'woocommerce_breadcrumb', 10);
    }
});

/**
 * Single product page: Add clean Lucide icon perks below Add to Cart.
 */
add_action('woocommerce_single_product_summary', function (): void {
    ?>
    <div class="aivastra-product-perks">
        <div class="aivastra-perk-item">
            <span class="aivastra-perk-icon-svg">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
            </span>
            <div>
                <strong>Virtual Try-On</strong>
                <p>Preview this garment on your photo before ordering</p>
            </div>
        </div>
        <div class="aivastra-perk-item">
            <span class="aivastra-perk-icon-svg">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-5.28a2 2 0 0 0-.586-1.414L18.414 7.3A2 2 0 0 0 17 6.72H14v11.28"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>
            </span>
            <div>
                <strong>Standard Delivery</strong>
                <p>Tracked flat-rate shipping across all pin codes</p>
            </div>
        </div>
        <div class="aivastra-perk-item">
            <span class="aivastra-perk-icon-svg">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
            </span>
            <div>
                <strong>Cash on Delivery</strong>
                <p>Pay on delivery available on domestic orders</p>
            </div>
        </div>
        <div class="aivastra-perk-item">
            <span class="aivastra-perk-icon-svg">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </span>
            <div>
                <strong>7-Day Returns</strong>
                <p>Simple size exchange and return window</p>
            </div>
        </div>
    </div>
    <?php
}, 35);

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
