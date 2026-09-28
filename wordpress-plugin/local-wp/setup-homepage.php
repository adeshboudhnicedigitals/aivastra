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

require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';

$shopUrl = (string) get_permalink(wc_get_page_id('shop'));

$menTerm = get_term_by('slug', 'men', 'product_cat');
$womenTerm = get_term_by('slug', 'women', 'product_cat');
$menUrl = $menTerm instanceof WP_Term ? (string) get_term_link($menTerm) : $shopUrl;
$womenUrl = $womenTerm instanceof WP_Term ? (string) get_term_link($womenTerm) : $shopUrl;

// Sideloaded from the plugin's own branding/ folder rather than hardcoded to a
// wp-content/uploads/<year>/<month> path — a fresh environment has no such
// upload until this script puts one there.
$existingHero = get_posts([
    'post_type' => 'attachment',
    'title' => 'Aivastra Shopify Hero',
    'posts_per_page' => 1,
]);
if (!empty($existingHero)) {
    $heroImageUrl = (string) wp_get_attachment_url($existingHero[0]->ID);
} else {
    $heroSourcePath = __DIR__ . '/branding/shopify-hero.jpg';
    if (!file_exists($heroSourcePath)) {
        throw new RuntimeException("Branding asset not found: {$heroSourcePath}");
    }
    $upload = wp_upload_bits('shopify-hero.jpg', null, file_get_contents($heroSourcePath));
    if (!empty($upload['error'])) {
        throw new RuntimeException("Upload failed for {$heroSourcePath}: {$upload['error']}");
    }
    $heroAttachmentId = wp_insert_attachment([
        'post_title' => 'Aivastra Shopify Hero',
        'post_mime_type' => 'image/jpeg',
        'post_status' => 'inherit',
    ], $upload['file']);
    wp_update_attachment_metadata(
        $heroAttachmentId,
        wp_generate_attachment_metadata($heroAttachmentId, $upload['file'])
    );
    $heroImageUrl = (string) $upload['url'];
}

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
