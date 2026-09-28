<?php
declare(strict_types=1);

/**
 * Account popover modal matching shopify.aivastra.com:
 * - Triggered by clicking the navbar account icon.
 * - Dropdown card beneath the account icon with rounded corners (24px) and soft shadow.
 * - Header: "Sign in or create account" with circular close button (✕).
 * - "Sign in with shop" purple pill button.
 * - "OR" divider.
 * - Email input with submission arrow (→).
 * - "Email me with news and offers" checkbox.
 * - "Orders" and "Profile" outline pill buttons.
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Output the account popover markup in the footer.
 */
add_action('wp_footer', function (): void {
    if (!function_exists('wc_get_page_permalink')) {
        return;
    }

    $myAccountUrl = wc_get_page_permalink('myaccount');
    $isLoggedIn = is_user_logged_in();
    $currentUser = $isLoggedIn ? wp_get_current_user() : null;
    $ordersUrl = wc_get_endpoint_url('orders', '', $myAccountUrl);
    $profileUrl = wc_get_endpoint_url('edit-account', '', $myAccountUrl);
    $logoutUrl = wc_logout_url();
    ?>
    <div class="aivastra-account-popover" role="dialog" aria-modal="true" aria-label="Account" aria-hidden="true">
        <div class="aivastra-account-popover-inner">
            <div class="aivastra-account-header">
                <h2 class="aivastra-account-title"><?php echo $isLoggedIn ? esc_html('My Account') : esc_html('Sign in or create account'); ?></h2>
                <button type="button" class="aivastra-account-close" aria-label="Close menu">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <?php if ($isLoggedIn && $currentUser instanceof WP_User) : ?>
                <div class="aivastra-account-logged-in">
                    <p class="aivastra-account-greeting">Signed in as <strong><?php echo esc_html($currentUser->display_name ?: $currentUser->user_email); ?></strong></p>
                    <div class="aivastra-account-quick-links">
                        <a href="<?php echo esc_url($ordersUrl); ?>" class="aivastra-account-btn-outline">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"></path><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>
                            <span>Orders</span>
                        </a>
                        <a href="<?php echo esc_url($profileUrl); ?>" class="aivastra-account-btn-outline">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20a6 6 0 0 0-12 0"></path><circle cx="12" cy="10" r="4"></circle><circle cx="12" cy="12" r="10"></circle></svg>
                            <span>Profile</span>
                        </a>
                    </div>
                    <a href="<?php echo esc_url($logoutUrl); ?>" class="aivastra-account-logout-link">Sign out</a>
                </div>
            <?php else : ?>
                <!-- Sign in with shop button -->
                <a href="<?php echo esc_url($myAccountUrl); ?>" class="aivastra-account-shop-pay-btn">
                    <span>Sign in with</span>
                    <span class="aivastra-shop-pay-wordmark">shop</span>
                </a>

                <!-- OR divider -->
                <div class="aivastra-account-divider">
                    <span>OR</span>
                </div>

                <!-- Email form -->
                <form class="aivastra-account-email-form" action="<?php echo esc_url($myAccountUrl); ?>" method="get">
                    <div class="aivastra-account-input-wrap">
                        <input type="email" name="email" class="aivastra-account-email-input" placeholder="Email" required autocomplete="email" />
                        <button type="submit" class="aivastra-account-submit-arrow" aria-label="Continue with email">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                        </button>
                    </div>
                    <label class="aivastra-account-checkbox-label">
                        <input type="checkbox" name="news_and_offers" class="aivastra-account-checkbox" />
                        <span>Email me with news and offers</span>
                    </label>
                </form>

                <!-- Quick links: Orders & Profile -->
                <div class="aivastra-account-quick-links">
                    <a href="<?php echo esc_url($ordersUrl); ?>" class="aivastra-account-btn-outline">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"></path><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>
                        <span>Orders</span>
                    </a>
                    <a href="<?php echo esc_url($profileUrl); ?>" class="aivastra-account-btn-outline">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20a6 6 0 0 0-12 0"></path><circle cx="12" cy="10" r="4"></circle><circle cx="12" cy="12" r="10"></circle></svg>
                        <span>Profile</span>
                    </a>
                </div>
            <?php endif; ?>
        </div>
    </div>
    <?php
});

/**
 * Enqueue account popover script.
 */
add_action('wp_enqueue_scripts', function (): void {
    $jsPath = get_stylesheet_directory() . '/assets/account-popover.js';
    $version = file_exists($jsPath) ? (string) filemtime($jsPath) : '1.0.0';

    wp_enqueue_script(
        'aivastra-account-popover',
        get_stylesheet_directory_uri() . '/assets/account-popover.js',
        [],
        $version,
        true
    );
});
