<?php
/**
 * Homepage build matching https://shopify.aivastra.com/:
 * Clean, minimalist white design, exact hero headline and model visual,
 * Women's Wear collection section with View all link,
 * Men's Wear collection section with View all link.
 *
 * Re-runnable: updates the existing "Home" page in place.
 * Run with: wp eval-file wp-content/plugins/aivastra-tryon/local-wp/setup-homepage.php
 */

if (!defined('ABSPATH')) {
    exit;
}

$shopUrl = (string) get_permalink(wc_get_page_id('shop'));

$menTerm = get_term_by('slug', 'men', 'product_cat');
$womenTerm = get_term_by('slug', 'women', 'product_cat');
$menUrl = $menTerm instanceof WP_Term ? (string) get_term_link($menTerm) : $shopUrl;
$womenUrl = $womenTerm instanceof WP_Term ? (string) get_term_link($womenTerm) : $shopUrl;

$heroImageUrl = home_url('/wp-content/uploads/2026/09/shopify-hero.jpg');

$content = <<<HTML
<div class="aivastra-shopify-hero">
  <div class="aivastra-shopify-hero-inner">
    <div class="aivastra-shopify-hero-content">
      <h1 class="aivastra-shopify-hero-title">Ai Vastra WooCommerce Demo Store</h1>
      <p class="aivastra-shopify-hero-subtitle">Ai Vastra Demo Store created to visualize the virtual try-on experience at WooCommerce store</p>
    </div>
    <div class="aivastra-shopify-hero-media">
      <img src="{$heroImageUrl}" alt="Ai Vastra Demo" class="aivastra-shopify-hero-img" />
    </div>
  </div>
</div>

<section class="aivastra-shopify-section">
  <div class="aivastra-shopify-section-header">
    <h2 class="aivastra-shopify-section-title">Women's Wear</h2>
    <a href="{$womenUrl}" class="aivastra-shopify-view-all">View all</a>
  </div>
  <div class="aivastra-shopify-product-list">
    [products category="women" limit="10" columns="5" orderby="date" order="DESC"]
  </div>
</section>

<section class="aivastra-shopify-section">
  <div class="aivastra-shopify-section-header">
    <h2 class="aivastra-shopify-section-title">Men's Wear</h2>
    <a href="{$menUrl}" class="aivastra-shopify-view-all">View all</a>
  </div>
  <div class="aivastra-shopify-product-list">
    [products category="men" limit="10" columns="5" orderby="date" order="DESC"]
  </div>
</section>
HTML;

$frontPageId = (int) get_option('page_on_front');
if ($frontPageId > 0) {
    wp_update_post([
        'ID' => $frontPageId,
        'post_content' => $content,
        'post_title' => 'Home',
    ]);
    echo "Success: Homepage updated to match shopify.aivastra.com layout (page id {$frontPageId}).\n";
    return;
}

$existingHome = get_page_by_path('home');
if ($existingHome instanceof WP_Post) {
    wp_update_post([
        'ID' => $existingHome->ID,
        'post_content' => $content,
        'post_title' => 'Home',
    ]);
    update_option('show_on_front', 'page');
    update_option('page_on_front', $existingHome->ID);
    echo "Success: Homepage updated to match shopify.aivastra.com layout (page id {$existingHome->ID}).\n";
    return;
}

$pageId = wp_insert_post([
    'post_title' => 'Home',
    'post_content' => $content,
    'post_status' => 'publish',
    'post_type' => 'page',
]);
update_option('show_on_front', 'page');
update_option('page_on_front', $pageId);
echo "Success: Created Home page (page id {$pageId}) matching shopify.aivastra.com layout.\n";
