=== Ai Vastra Try-On ===
Contributors: TODO_WPORG_USERNAME
Tags: woocommerce, virtual try-on, ai, fashion, product page
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 8.1
Requires Plugins: woocommerce
Stable tag: 0.5.13
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Adds an AI virtual try-on button to WooCommerce product pages, backed by the Ai Vastra platform.

== Description ==

Ai Vastra Try-On adds a "Try It On" button to your WooCommerce product pages. A shopper
uploads a photo of themselves, and the plugin generates a realistic image of them wearing
the product — powered by the Ai Vastra AI platform.

= What it does =

* Adds a try-on button and modal to the WooCommerce single product page (skipped
  automatically for any product an admin has hidden it on).
* Sends the product image and the shopper's photo to the Ai Vastra API for processing,
  and shows the generated result back in the same modal.
* Lets the shopper download the result or add the product to their cart directly from the
  result screen.
* Maps WooCommerce product categories to Ai Vastra try-on workflows, so different parts of
  a catalog (e.g. sarees vs. general apparel) can use the model best suited to them.
* Shows per-product try-on analytics (views, generations, add-to-carts) inside wp-admin.
* Lets a store buy additional Ai Vastra credits without leaving wp-admin.

= Requires an Ai Vastra account =

This plugin is a client for the separately operated Ai Vastra service — it does not work
standalone. You'll need a free Ai Vastra account and two API keys (generated in your Ai
Vastra dashboard) to connect the plugin; see the Installation section below. Try-on
generations consume Ai Vastra credits, which are billed separately from this plugin.

== Third Party Services ==

This plugin relies on the following third-party services to function. By activating and
using it, product images and shopper-submitted photos are sent to these services for
processing.

* **Ai Vastra** (https://app.aivastra.com) — receives the product image and the shopper's
  uploaded photo to generate the virtual try-on result, and receives account/billing
  requests when a store purchases credits from inside wp-admin.
  Terms of Service: https://app.aivastra.com/terms
  Privacy Policy: https://app.aivastra.com/privacy
  NOTE: both pages are drafts (apps/catalogues-web/src/app/terms and .../privacy) pending
  legal review and sign-off — do not submit to wp.org until they are reviewed, finalized,
  and actually deployed at these URLs.
* **Razorpay** (https://razorpay.com) — processes the one-time payment when a store buys a
  credit pack from the plugin's settings page. Card/payment details are handled entirely by
  Razorpay's own checkout; this plugin never sees or stores payment credentials.
  Privacy Policy: https://razorpay.com/privacy/

== Installation ==

1. Install and activate WooCommerce if it isn't already active — this plugin requires it.
2. Upload and activate Ai Vastra Try-On (via **Plugins → Add New → Upload Plugin**, or from
   the WordPress.org plugin directory once listed there).
3. Go to **Settings → Aivastra Try-On** in wp-admin.
4. Create a free Ai Vastra account (a link is provided on the settings screen) if you don't
   have one, then generate a full API key and a WordPress widget key from your Ai Vastra
   dashboard.
5. Paste both keys into the settings screen and save. The try-on button will start
   appearing on your WooCommerce product pages.
6. Optionally map WooCommerce product categories to Ai Vastra workflows under the same
   settings screen if your catalog needs more than one try-on model.

== Frequently Asked Questions ==

= Do I need an Ai Vastra account? =

Yes. The plugin is a WooCommerce front end for the Ai Vastra try-on service — it has no
functionality of its own without a connected account and API keys.

= Does this cost anything beyond the plugin itself? =

The plugin is free. Try-on generations consume Ai Vastra credits, purchased through your Ai
Vastra account (or directly from the plugin's settings page via Razorpay).

= Where are shopper photos stored? =

Shopper-uploaded photos are sent directly from the shopper's browser to the Ai Vastra API —
they never pass through your WordPress server. See the Third Party Services section above.

= Does this work with variable products? =

Yes — the try-on button tracks the shopper's selected variation and its image, and "Add to
Cart" from a result adds that specific variation, not the parent product.

== Screenshots ==

1. The "Try It On" button on a WooCommerce product page.
2. The try-on result modal with download and add-to-cart actions.
3. The plugin's settings screen — connection, category mapping, and analytics.

== Changelog ==

= 0.5.13 =
* Current release. See the plugin's own version history in its source repository for the
  full history prior to this readme.txt being introduced.

== Upgrade Notice ==

= 0.5.13 =
No breaking changes.
