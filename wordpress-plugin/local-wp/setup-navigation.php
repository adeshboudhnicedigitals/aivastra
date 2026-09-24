<?php
/**
 * Navigation menu matching https://shopify.aivastra.com/:
 * HOME, MEN, WOMEN, CONTACT.
 *
 * Re-runnable: clears and rebuilds the menu items each time.
 * Run with: wp eval-file wp-content/plugins/aivastra-tryon/local-wp/setup-navigation.php
 */

if (!defined('ABSPATH')) {
    exit;
}

function aivastra_add_menu_item(int $menuId, string $title, string $url, int $parentId = 0): int
{
    $itemId = wp_update_nav_menu_item($menuId, 0, [
        'menu-item-title' => $title,
        'menu-item-url' => $url,
        'menu-item-status' => 'publish',
        'menu-item-parent-id' => $parentId,
    ]);
    if (is_wp_error($itemId)) {
        throw new RuntimeException("Failed to add menu item {$title}: " . $itemId->get_error_message());
    }
    return $itemId;
}

$menuName = 'Main Menu';
$menu = wp_get_nav_menu_object($menuName);
$menuId = $menu ? (int) $menu->term_id : wp_create_nav_menu($menuName);
if (is_wp_error($menuId)) {
    throw new RuntimeException('Failed to create menu: ' . $menuId->get_error_message());
}

foreach (wp_get_nav_menu_items($menuId) ?: [] as $item) {
    wp_delete_post($item->ID, true);
}

// 1. HOME
aivastra_add_menu_item($menuId, 'HOME', home_url('/'));

// 2. MEN
$menTerm = get_term_by('slug', 'men', 'product_cat');
if ($menTerm instanceof WP_Term) {
    $menParentId = aivastra_add_menu_item($menuId, 'MEN', (string) get_term_link($menTerm));
    $menChildren = get_terms(['taxonomy' => 'product_cat', 'parent' => $menTerm->term_id, 'hide_empty' => false]);
    foreach ($menChildren as $child) {
        aivastra_add_menu_item($menuId, $child->name, (string) get_term_link($child), $menParentId);
    }
}

// 3. WOMEN
$womenTerm = get_term_by('slug', 'women', 'product_cat');
if ($womenTerm instanceof WP_Term) {
    $womenParentId = aivastra_add_menu_item($menuId, 'WOMEN', (string) get_term_link($womenTerm));
    $womenChildren = get_terms(['taxonomy' => 'product_cat', 'parent' => $womenTerm->term_id, 'hide_empty' => false]);
    foreach ($womenChildren as $child) {
        aivastra_add_menu_item($menuId, $child->name, (string) get_term_link($child), $womenParentId);
    }
}

// 4. CONTACT — a real page (matches shopify.aivastra.com/pages/contact),
// not an anchor jump to the footer.
$contactPage = get_page_by_path('contact');
$contactUrl = $contactPage instanceof WP_Post ? (string) get_permalink($contactPage) : home_url('/contact');
aivastra_add_menu_item($menuId, 'CONTACT', $contactUrl);

$locations = get_theme_mod('nav_menu_locations', []);
$locations['primary'] = $menuId;
set_theme_mod('nav_menu_locations', $locations);

WP_CLI::success("Main Menu updated (HOME, MEN, WOMEN, CONTACT) matching shopify.aivastra.com.");
