<?php
declare(strict_types=1);

/**
 * Slide-out cart drawer matching shopify.aivastra.com:
 * - Slides in from the right edge with dimmed backdrop overlay.
 * - Circular close button at top-right.
 * - Exact empty state when cart is empty ("Your cart is empty", "Have an account? Log in...", "Continue shopping").
 * - Interactive cart items list, quantity steppers, subtotal, and checkout button when cart has items.
 * - AJAX endpoints for retrieving cart fragments, updating quantities, removing items, and adding items.
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Helper to render cart drawer item rows.
 */
function aivastra_render_cart_drawer_items(): string {
    if (!function_exists('WC') || !WC()->cart || WC()->cart->is_empty()) {
        return '';
    }

    ob_start();
    foreach (WC()->cart->get_cart() as $cartItemKey => $cartItem) {
        $_product = apply_filters('woocommerce_cart_item_product', $cartItem['data'], $cartItem, $cartItemKey);
        if (!$_product || !$_product->exists() || $cartItem['quantity'] <= 0) {
            continue;
        }

        $productPermalink = apply_filters(
            'woocommerce_cart_item_permalink',
            $_product->is_visible() ? $_product->get_permalink($cartItem) : '',
            $cartItem,
            $cartItemKey
        );
        $thumbnail = $_product->get_image([80, 80]);
        $productPrice = apply_filters('woocommerce_cart_item_price', WC()->cart->get_product_price($_product), $cartItem, $cartItemKey);
        ?>
        <div class="aivastra-cart-drawer-item" data-cart-key="<?php echo esc_attr($cartItemKey); ?>">
            <div class="aivastra-cart-drawer-item-img">
                <?php if ($productPermalink) : ?>
                    <a href="<?php echo esc_url($productPermalink); ?>"><?php echo $thumbnail; ?></a>
                <?php else : ?>
                    <?php echo $thumbnail; ?>
                <?php endif; ?>
            </div>
            <div class="aivastra-cart-drawer-item-info">
                <div class="aivastra-cart-drawer-item-header">
                    <h3 class="aivastra-cart-drawer-item-title">
                        <?php if ($productPermalink) : ?>
                            <a href="<?php echo esc_url($productPermalink); ?>"><?php echo esc_html($_product->get_name()); ?></a>
                        <?php else : ?>
                            <?php echo esc_html($_product->get_name()); ?>
                        <?php endif; ?>
                    </h3>
                    <button type="button" class="aivastra-cart-drawer-item-remove" data-cart-key="<?php echo esc_attr($cartItemKey); ?>" aria-label="Remove item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="aivastra-cart-drawer-item-price"><?php echo $productPrice; ?></div>
                <div class="aivastra-cart-drawer-item-actions">
                    <div class="aivastra-cart-drawer-qty-stepper">
                        <button type="button" class="aivastra-cart-drawer-qty-btn aivastra-cart-drawer-qty-minus" data-cart-key="<?php echo esc_attr($cartItemKey); ?>" aria-label="Decrease quantity">−</button>
                        <input type="number" class="aivastra-cart-drawer-qty-input" data-cart-key="<?php echo esc_attr($cartItemKey); ?>" value="<?php echo esc_attr((string) $cartItem['quantity']); ?>" min="1" step="1" readonly />
                        <button type="button" class="aivastra-cart-drawer-qty-btn aivastra-cart-drawer-qty-plus" data-cart-key="<?php echo esc_attr($cartItemKey); ?>" aria-label="Increase quantity">+</button>
                    </div>
                </div>
            </div>
        </div>
        <?php
    }

    return ob_get_clean() ?: '';
}

/**
 * Output the cart drawer markup in the footer.
 */
add_action('wp_footer', function (): void {
    if (!function_exists('WC')) {
        return;
    }

    $isEmpty = !WC()->cart || WC()->cart->is_empty();
    $cartCount = WC()->cart ? WC()->cart->get_cart_contents_count() : 0;
    $subtotal = WC()->cart ? WC()->cart->get_cart_subtotal() : '₹0.00';
    $myAccountUrl = wc_get_page_permalink('myaccount');
    $shopUrl = wc_get_page_permalink('shop');
    $checkoutUrl = wc_get_checkout_url();
    ?>
    <!-- Cart Drawer Backdrop Overlay -->
    <div class="aivastra-cart-drawer-overlay" aria-hidden="true"></div>

    <!-- Cart Drawer Panel -->
    <aside class="aivastra-cart-drawer" role="dialog" aria-modal="true" aria-label="Cart" aria-hidden="true">
        <div class="aivastra-cart-drawer-inner<?php echo $isEmpty ? ' is-empty' : ''; ?>">
            <!-- Drawer Header -->
            <div class="aivastra-cart-drawer-header">
                <div class="aivastra-cart-drawer-header-title" <?php echo $isEmpty ? 'style="display:none;"' : ''; ?>>
                    <h2 class="aivastra-cart-drawer-title">Your cart</h2>
                    <span class="aivastra-cart-drawer-count-badge"><?php echo esc_html((string) $cartCount); ?></span>
                </div>
                <button type="button" class="aivastra-cart-drawer-close" aria-label="Close cart">
                    <span class="svg-wrapper">
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M11.1765 12.025C11.4108 12.2594 11.7907 12.2594 12.025 12.025C12.2594 11.7907 12.2594 11.4108 12.025 11.1765L8.84931 8.00078L12.025 4.82505C12.2594 4.59073 12.2594 4.21083 12.025 3.97652C11.7907 3.7422 11.4108 3.7422 11.1765 3.97652L8.00078 7.15225L4.82505 3.97652C4.59073 3.7422 4.21083 3.7422 3.97652 3.97652C3.7422 4.21083 3.7422 4.59073 3.97652 4.82505L7.15225 8.00078L3.97652 11.1765C3.7422 11.4108 3.7422 11.7907 3.97652 12.025C4.21083 12.2594 4.59073 12.2594 4.82505 12.025L8.00078 8.84931L11.1765 12.025Z" fill="currentColor"/>
                        </svg>
                    </span>
                </button>
            </div>

            <!-- Empty State Container matching shopify.aivastra.com -->
            <div class="aivastra-cart-drawer-empty" <?php echo $isEmpty ? '' : 'style="display:none;"'; ?>>
                <h2 class="aivastra-cart-drawer-empty-heading">Your cart is empty</h2>
                <p class="aivastra-cart-drawer-empty-account">
                    Have an account? <a href="<?php echo esc_url($myAccountUrl); ?>">Log in</a> to check out faster.
                </p>
                <a href="<?php echo esc_url($shopUrl); ?>" class="aivastra-cart-drawer-continue-btn">
                    Continue shopping
                </a>
            </div>

            <!-- Filled State Container -->
            <div class="aivastra-cart-drawer-filled" <?php echo $isEmpty ? 'style="display:none;"' : ''; ?>>
                <div class="aivastra-cart-drawer-items-list">
                    <?php echo aivastra_render_cart_drawer_items(); ?>
                </div>

                <div class="aivastra-cart-drawer-footer">
                    <div class="aivastra-cart-drawer-subtotal-row">
                        <span class="aivastra-cart-drawer-subtotal-label">Estimated total</span>
                        <span class="aivastra-cart-drawer-subtotal-amount"><?php echo $subtotal; ?></span>
                    </div>
                    <p class="aivastra-cart-drawer-tax-note">Taxes and shipping calculated at checkout.</p>
                    <a href="<?php echo esc_url($checkoutUrl); ?>" class="aivastra-cart-drawer-checkout-btn">
                        Check out
                    </a>
                </div>
            </div>
        </div>
    </aside>
    <?php
});

/**
 * Enqueue drawer JavaScript and localize parameters.
 */
add_action('wp_enqueue_scripts', function (): void {
    if (!function_exists('WC')) {
        return;
    }

    $jsPath = get_stylesheet_directory() . '/assets/cart-drawer.js';
    $version = file_exists($jsPath) ? (string) filemtime($jsPath) : '1.0.0';

    wp_enqueue_script(
        'aivastra-cart-drawer',
        get_stylesheet_directory_uri() . '/assets/cart-drawer.js',
        [],
        $version,
        true
    );

    wp_localize_script('aivastra-cart-drawer', 'aivastraCartDrawer', [
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('aivastra_cart_drawer_nonce'),
        'shopUrl' => wc_get_page_permalink('shop'),
        'cartUrl' => wc_get_cart_url(),
        'checkoutUrl' => wc_get_checkout_url(),
        'myAccountUrl' => wc_get_page_permalink('myaccount'),
        'currencySymbol' => get_woocommerce_currency_symbol(),
    ]);
});

/**
 * AJAX handler: Get cart state and rendered HTML.
 */
function aivastra_ajax_get_cart_drawer(): void {
    check_ajax_referer('aivastra_cart_drawer_nonce', 'nonce');

    if (!function_exists('WC') || !WC()->cart) {
        wp_send_json_error(['message' => 'WooCommerce cart unavailable']);
    }

    WC()->cart->calculate_totals();

    $isEmpty = WC()->cart->is_empty();
    $count = WC()->cart->get_cart_contents_count();
    $subtotal = WC()->cart->get_cart_subtotal();
    $itemsHtml = aivastra_render_cart_drawer_items();

    wp_send_json_success([
        'is_empty' => $isEmpty,
        'item_count' => $count,
        'subtotal' => $subtotal,
        'items_html' => $itemsHtml,
    ]);
}
add_action('wp_ajax_aivastra_cart_drawer_get', 'aivastra_ajax_get_cart_drawer');
add_action('wp_ajax_nopriv_aivastra_cart_drawer_get', 'aivastra_ajax_get_cart_drawer');

/**
 * AJAX handler: Update cart item quantity.
 */
function aivastra_ajax_update_cart_drawer_qty(): void {
    check_ajax_referer('aivastra_cart_drawer_nonce', 'nonce');

    if (!function_exists('WC') || !WC()->cart) {
        wp_send_json_error(['message' => 'WooCommerce cart unavailable']);
    }

    $cartKey = isset($_POST['cart_key']) ? sanitize_text_field((string) $_POST['cart_key']) : '';
    $quantity = isset($_POST['quantity']) ? (int) $_POST['quantity'] : 1;

    if ($cartKey === '') {
        wp_send_json_error(['message' => 'Missing cart key']);
    }

    if ($quantity <= 0) {
        WC()->cart->remove_cart_item($cartKey);
    } else {
        WC()->cart->set_quantity($cartKey, $quantity, true);
    }

    WC()->cart->calculate_totals();

    wp_send_json_success([
        'is_empty' => WC()->cart->is_empty(),
        'item_count' => WC()->cart->get_cart_contents_count(),
        'subtotal' => WC()->cart->get_cart_subtotal(),
        'items_html' => aivastra_render_cart_drawer_items(),
    ]);
}
add_action('wp_ajax_aivastra_cart_drawer_update_qty', 'aivastra_ajax_update_cart_drawer_qty');
add_action('wp_ajax_nopriv_aivastra_cart_drawer_update_qty', 'aivastra_ajax_update_cart_drawer_qty');

/**
 * AJAX handler: Remove item from cart.
 */
function aivastra_ajax_remove_cart_drawer_item(): void {
    check_ajax_referer('aivastra_cart_drawer_nonce', 'nonce');

    if (!function_exists('WC') || !WC()->cart) {
        wp_send_json_error(['message' => 'WooCommerce cart unavailable']);
    }

    $cartKey = isset($_POST['cart_key']) ? sanitize_text_field((string) $_POST['cart_key']) : '';
    if ($cartKey === '') {
        wp_send_json_error(['message' => 'Missing cart key']);
    }

    WC()->cart->remove_cart_item($cartKey);
    WC()->cart->calculate_totals();

    wp_send_json_success([
        'is_empty' => WC()->cart->is_empty(),
        'item_count' => WC()->cart->get_cart_contents_count(),
        'subtotal' => WC()->cart->get_cart_subtotal(),
        'items_html' => aivastra_render_cart_drawer_items(),
    ]);
}
add_action('wp_ajax_aivastra_cart_drawer_remove', 'aivastra_ajax_remove_cart_drawer_item');
add_action('wp_ajax_nopriv_aivastra_cart_drawer_remove', 'aivastra_ajax_remove_cart_drawer_item');

/**
 * AJAX handler: Add to cart.
 */
function aivastra_ajax_add_to_cart_drawer(): void {
    check_ajax_referer('aivastra_cart_drawer_nonce', 'nonce');

    if (!function_exists('WC') || !WC()->cart) {
        wp_send_json_error(['message' => 'WooCommerce cart unavailable']);
    }

    $productId = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
    $quantity = isset($_POST['quantity']) ? absint($_POST['quantity']) : 1;

    if ($productId <= 0) {
        wp_send_json_error(['message' => 'Invalid product']);
    }

    $passedValidation = apply_filters('woocommerce_add_to_cart_validation', true, $productId, $quantity);
    if ($passedValidation && WC()->cart->add_to_cart($productId, $quantity) !== false) {
        WC()->cart->calculate_totals();
        wp_send_json_success([
            'is_empty' => false,
            'item_count' => WC()->cart->get_cart_contents_count(),
            'subtotal' => WC()->cart->get_cart_subtotal(),
            'items_html' => aivastra_render_cart_drawer_items(),
        ]);
    } else {
        wp_send_json_error(['message' => 'Failed to add product to cart']);
    }
}
add_action('wp_ajax_aivastra_cart_drawer_add', 'aivastra_ajax_add_to_cart_drawer');
add_action('wp_ajax_nopriv_aivastra_cart_drawer_add', 'aivastra_ajax_add_to_cart_drawer');
