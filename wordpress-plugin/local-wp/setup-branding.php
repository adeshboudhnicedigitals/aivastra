<?php
/**
 * One-time site identity for the demo store: title, tagline, header logo,
 * and favicon — built from the plugin's own brand assets (admin/assets/images)
 * so the storefront matches the Aivastra Try-On settings page it's demoing.
 *
 * Re-runnable: looks up existing attachments by title before importing, so it
 * won't pile up duplicate media items on a second run.
 *
 * Expects a sibling `branding/header-logo.png` and `branding/favicon.png`
 * (rendered from the plugin's admin/assets/images SVGs — ImageMagick's SVG
 * delegate renders them blank on this box since rsvg-convert isn't
 * installed, so they're pre-rendered via headless Chrome instead).
 *
 * Run with: wp eval-file setup-branding.php   (from wherever this file sits,
 * alongside its branding/ folder — mirrors configure-store.php et al., which
 * run from $HOME rather than the plugin directory)
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';

function aivastra_find_or_import_attachment(string $title, string $path): int
{
    $existing = get_posts([
        'post_type' => 'attachment',
        'title' => $title,
        'posts_per_page' => 1,
    ]);
    if (!empty($existing)) {
        return $existing[0]->ID;
    }

    if (!file_exists($path)) {
        throw new RuntimeException("Branding asset not found: {$path}");
    }

    $upload = wp_upload_bits(basename($path), null, file_get_contents($path));
    if (!empty($upload['error'])) {
        throw new RuntimeException("Upload failed for {$path}: {$upload['error']}");
    }

    $attachmentId = wp_insert_attachment([
        'post_title' => $title,
        'post_mime_type' => 'image/png',
        'post_status' => 'inherit',
    ], $upload['file']);

    wp_update_attachment_metadata(
        $attachmentId,
        wp_generate_attachment_metadata($attachmentId, $upload['file'])
    );

    return $attachmentId;
}

update_option('blogname', 'Aivastra');
update_option('blogdescription', 'AI-Powered Virtual Try-On for Fashion');

$logoId = aivastra_find_or_import_attachment(
    'Aivastra Site Logo',
    __DIR__ . '/branding/header-logo.png'
);
set_theme_mod('custom_logo', $logoId);

$iconId = aivastra_find_or_import_attachment(
    'Aivastra Favicon',
    __DIR__ . '/branding/favicon.png'
);
update_option('site_icon', $iconId);

echo "Branding applied: title=Aivastra, logo attachment #{$logoId}, favicon attachment #{$iconId}\n";
