<?php
/**
 * One-time WooCommerce settings for the local demo store: INR currency,
 * Cash-on-Delivery-only checkout, guest checkout, no tax, and a flat-rate
 * shipping zone. Every change here is an option update — naturally
 * idempotent, safe to re-run.
 *
 * Run with: wp eval-file wp-content/plugins/aivastra-tryon/local-wp/configure-store.php
 */

if (!defined('ABSPATH')) {
    exit;
}

update_option('woocommerce_currency', 'INR');

update_option('woocommerce_cod_settings', array_merge(
    (array) get_option('woocommerce_cod_settings', []),
    ['enabled' => 'yes', 'title' => 'Cash on Delivery']
));

foreach (['bacs', 'cheque', 'paypal'] as $gateway) {
    update_option("woocommerce_{$gateway}_settings", array_merge(
        (array) get_option("woocommerce_{$gateway}_settings", []),
        ['enabled' => 'no']
    ));
}

update_option('woocommerce_enable_guest_checkout', 'yes');
update_option('woocommerce_calc_taxes', 'no');

$zoneExists = false;
foreach (WC_Shipping_Zones::get_zones() as $zone) {
    if ($zone['zone_name'] === 'Everywhere') {
        $zoneExists = true;
        break;
    }
}

if (!$zoneExists) {
    $zone = new WC_Shipping_Zone();
    $zone->set_zone_name('Everywhere');
    $zone->save();

    $instanceId = $zone->add_shipping_method('flat_rate');
    $settings = get_option("woocommerce_flat_rate_{$instanceId}_settings", []);
    $settings['cost'] = '99';
    $settings['title'] = 'Standard Shipping';
    update_option("woocommerce_flat_rate_{$instanceId}_settings", $settings);
}

WP_CLI::success('Store configuration applied.');
