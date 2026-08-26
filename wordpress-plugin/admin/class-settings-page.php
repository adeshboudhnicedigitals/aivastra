<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Native WP Settings API page under Settings → Aivastra Try-On. Two paste
 * fields (full key, widget key) per docs/wordpress-plugin-design.md §4.1/§4.3.
 * The full key is used exactly once on save (Aivastra_Connection_Service),
 * never rendered back into the form, never stored.
 */
class Aivastra_Settings_Page
{
    private const API_BASE = 'https://api.aivastra.com';

    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'register_menu']);
        add_action('admin_post_aivastra_tryon_connect', [self::class, 'handle_connect']);
    }

    public static function register_menu(): void
    {
        add_options_page(
            'Aivastra Try-On',
            'Aivastra Try-On',
            'manage_woocommerce',
            'aivastra-tryon',
            [self::class, 'render']
        );
    }

    /**
     * Rejects anything not shaped like an aivastra API key. A malformed
     * value is treated the same as "not provided" rather than stored and
     * failing later at connect time with a confusing error.
     */
    public static function sanitize_key_input(string $raw): string
    {
        $trimmed = trim($raw);
        if ($trimmed === '') {
            return '';
        }
        return (bool) preg_match('/^sk_live_[A-Za-z0-9_-]{43}$/', $trimmed) ? $trimmed : '';
    }

    public static function handle_connect(): void
    {
        check_admin_referer('aivastra_tryon_connect');

        $fullKey = self::sanitize_key_input((string) ($_POST['aivastra_full_key'] ?? ''));
        $widgetKey = self::sanitize_key_input((string) ($_POST['aivastra_widget_key'] ?? ''));

        $redirectArgs = ['page' => 'aivastra-tryon'];

        if ($fullKey === '' || $widgetKey === '') {
            $redirectArgs['aivastra_error'] = 'invalid_key_format';
        } else {
            $service = new Aivastra_Connection_Service(new Aivastra_Connection_Settings(), self::API_BASE);
            $result = $service->connect($fullKey, $widgetKey);
            $redirectArgs[$result['ok'] ? 'aivastra_connected' : 'aivastra_error'] =
                $result['ok'] ? '1' : ($result['error'] ?? 'unknown');
        }

        wp_safe_redirect(add_query_arg($redirectArgs, admin_url('options-general.php')));
        exit;
    }

    public static function render(): void
    {
        $settings = new Aivastra_Connection_Settings();
        $companyName = $settings->get_company_name();
        $creditsAsOf = $settings->get_credits_as_of();
        ?>
        <div class="wrap">
          <h1>Aivastra Try-On</h1>
          <?php if ($companyName !== null): ?>
            <p>Connected as <strong><?php echo esc_html($companyName); ?></strong>
               (as of <?php echo esc_html($creditsAsOf ?? 'unknown'); ?>).</p>
          <?php else: ?>
            <p>Not connected yet.</p>
          <?php endif; ?>
          <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="aivastra_tryon_connect">
            <?php wp_nonce_field('aivastra_tryon_connect'); ?>
            <table class="form-table">
              <tr>
                <th><label for="aivastra_full_key">Full API key</label></th>
                <td><input type="password" id="aivastra_full_key" name="aivastra_full_key" class="regular-text" autocomplete="off"></td>
              </tr>
              <tr>
                <th><label for="aivastra_widget_key">Widget API key</label></th>
                <td><input type="password" id="aivastra_widget_key" name="aivastra_widget_key" class="regular-text" autocomplete="off"></td>
              </tr>
            </table>
            <?php submit_button('Test connection'); ?>
          </form>
        </div>
        <?php
    }
}
