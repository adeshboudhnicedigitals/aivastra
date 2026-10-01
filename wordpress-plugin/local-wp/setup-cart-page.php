<?php
/**
 * Cart page empty-state copy matching https://shopify.aivastra.com/cart:
 * "Your cart is empty" (no icon), a "Have an account? Log in..." prompt,
 * a black "Continue shopping" button, and a "You may also like" cross-sell
 * heading — replacing WooCommerce's own default empty-cart block content
 * (crying-face icon, "Your cart is currently empty!", a dot separator,
 * "New in store") that ships unedited on every fresh WooCommerce install.
 *
 * Re-runnable: matches on the wp:woocommerce/empty-cart-block boundaries,
 * so running this twice just replaces the same block with itself.
 *
 * Run with: wp eval-file wp-content/plugins/aivastra-tryon/local-wp/setup-cart-page.php
 */

if (!defined('ABSPATH')) {
    exit;
}

$cartPageId = (int) wc_get_page_id('cart');
if ($cartPageId <= 0) {
    throw new RuntimeException('WooCommerce Cart page not found.');
}

$page = get_post($cartPageId);
if (!$page instanceof WP_Post) {
    throw new RuntimeException("Cart page (id {$cartPageId}) not found.");
}

$shopUrl = (string) get_permalink(wc_get_page_id('shop'));
$myAccountUrl = (string) wc_get_page_permalink('myaccount');

$newEmptyCartBlock = <<<HTML
<!-- wp:woocommerce/empty-cart-block -->
<div class="wp-block-woocommerce-empty-cart-block"><!-- wp:heading {"textAlign":"center","className":"wc-block-cart__empty-cart__title"} -->
<h2 class="wp-block-heading has-text-align-center wc-block-cart__empty-cart__title">Your cart is empty</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","className":"aivastra-empty-cart-account"} -->
<p class="has-text-align-center aivastra-empty-cart-account">Have an account? <a href="{$myAccountUrl}">Log in</a> to check out faster.</p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons"><!-- wp:button {"className":"aivastra-empty-cart-continue"} -->
<div class="wp-block-button aivastra-empty-cart-continue"><a class="wp-block-button__link wp-element-button" href="{$shopUrl}">Continue shopping</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons -->

<!-- wp:heading {"textAlign":"center"} -->
<h2 class="wp-block-heading has-text-align-center">You may also like</h2>
<!-- /wp:heading -->

<!-- wp:woocommerce/product-new {"columns":4,"rows":1} /--></div>
<!-- /wp:woocommerce/empty-cart-block -->
HTML;

$pattern = '#<!-- wp:woocommerce/empty-cart-block -->.*?<!-- /wp:woocommerce/empty-cart-block -->#s';
$updatedContent = preg_replace($pattern, $newEmptyCartBlock, $page->post_content, 1, $count);

if ($count !== 1) {
    throw new RuntimeException("Expected exactly one wp:woocommerce/empty-cart-block in the Cart page; found {$count}.");
}

wp_update_post([
    'ID' => $cartPageId,
    'post_content' => $updatedContent,
]);

echo "Success: Cart page empty-state updated to match shopify.aivastra.com copy (page id {$cartPageId}).\n";
