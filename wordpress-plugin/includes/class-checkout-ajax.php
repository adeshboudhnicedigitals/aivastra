<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Verifies a completed Razorpay payment from the "Plans & Credits" card
 * (admin/class-settings-page.php) without a full page reload. Admin-only —
 * unlike class-cart-ajax.php this has no wp_ajax_nopriv_ variant, since only
 * a logged-in store admin with manage_woocommerce should ever trigger a
 * purchase.
 */
class Aivastra_Checkout_Ajax
{
    private const ACTION = 'aivastra_tryon_verify_payment';
    public const NONCE_ACTION = 'aivastra_tryon_verify_payment';

    public static function init(): void
    {
        add_action('wp_ajax_' . self::ACTION, [self::class, 'handle']);
    }

    public static function handle(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error(['message' => 'You do not have permission to do this.'], 403);
        }
        check_ajax_referer(self::NONCE_ACTION, 'nonce');

        $payment = [
            'razorpayOrderId' => sanitize_text_field((string) ($_POST['razorpay_order_id'] ?? '')),
            'razorpayPaymentId' => sanitize_text_field((string) ($_POST['razorpay_payment_id'] ?? '')),
            'razorpaySignature' => sanitize_text_field((string) ($_POST['razorpay_signature'] ?? '')),
        ];

        if ($payment['razorpayOrderId'] === '' || $payment['razorpayPaymentId'] === '' || $payment['razorpaySignature'] === '') {
            wp_send_json_error(['message' => 'Missing payment details.']);
        }

        $service = new Aivastra_Connection_Service(new Aivastra_Connection_Settings(), Aivastra_Settings_Page::API_BASE);
        $result = $service->verify_payment($payment);

        if (!$result['ok']) {
            wp_send_json_error(['message' => 'Payment received but not yet reflected — click Refresh balance.']);
        }

        wp_send_json_success(['balance' => $result['balance']]);
    }
}
