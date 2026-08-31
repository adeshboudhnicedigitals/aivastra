<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Per-product override for whether the Try-On button appears at all —
 * coarser control already exists via category mapping (which try-on
 * workflow a product uses), but nothing previously let a merchant hide the
 * button on a specific product. Absence of the meta key means enabled: this
 * ships to stores that already have the button live on every product, and
 * that must keep working unless a merchant explicitly opts a product out.
 */
class Aivastra_Product_Toggle
{
    public const META_KEY = '_aivastra_tryon_enabled';
    private const NONCE_ACTION = 'aivastra_tryon_product_toggle';
    private const NONCE_NAME = 'aivastra_tryon_product_toggle_nonce';

    public static function init(): void
    {
        add_action('add_meta_boxes', [self::class, 'add_meta_box']);
        add_action('save_post_product', [self::class, 'save']);
    }

    public static function add_meta_box(): void
    {
        add_meta_box(
            'aivastra_tryon_product_toggle',
            'Aivastra Try-On',
            [self::class, 'render_meta_box'],
            'product',
            'side',
            'default'
        );
    }

    public static function render_meta_box(WP_Post $post): void
    {
        wp_nonce_field(self::NONCE_ACTION, self::NONCE_NAME);
        ?>
        <label>
          <input type="checkbox" name="<?php echo esc_attr(self::META_KEY); ?>" value="1" <?php checked(self::is_enabled($post->ID)); ?>>
          Show the Try-On button on this product
        </label>
        <?php
    }

    /**
     * Fires on save_post_product for every save (including autosave/revision
     * requests, which is why those are excluded explicitly) — a checkbox
     * meta box has no field to validate beyond present-or-absent, so this is
     * the entire save path.
     */
    public static function save(int $postId): void
    {
        if (!isset($_POST[self::NONCE_NAME]) || !wp_verify_nonce((string) $_POST[self::NONCE_NAME], self::NONCE_ACTION)) {
            return;
        }
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        if (!current_user_can('edit_post', $postId)) {
            return;
        }
        update_post_meta($postId, self::META_KEY, self::sanitize_checkbox($_POST[self::META_KEY] ?? null));
    }

    /** A never-saved product (get_post_meta returns '') is enabled, matching pre-toggle behavior. */
    public static function is_enabled(int $productId): bool
    {
        return get_post_meta($productId, self::META_KEY, true) !== '0';
    }

    /** Pure: a present, truthy checkbox value sanitizes to '1', anything else (including absent) to '0'. */
    public static function sanitize_checkbox(mixed $raw): string
    {
        return $raw ? '1' : '0';
    }
}
