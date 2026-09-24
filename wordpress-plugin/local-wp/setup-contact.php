<?php
/**
 * Contact page matching https://shopify.aivastra.com/pages/contact:
 * "Contact" title, then a centered form (Name / Email* / Phone / Comment)
 * with pill-rounded inputs and a Submit button.
 *
 * No form-processing plugin is installed in this demo store, so — same
 * pattern as the homepage footer's email signup — the form is a cosmetic,
 * client-side-only submit (no email is actually sent). If real submissions
 * are ever needed, wire this markup into Contact Form 7 / WPForms instead
 * of rebuilding it.
 *
 * Re-runnable: updates the existing "Contact" page in place.
 * Run with: wp eval-file wp-content/plugins/aivastra-tryon/local-wp/setup-contact.php
 */

if (!defined('ABSPATH')) {
    exit;
}

$content = <<<'HTML'
<div class="aivastra-contact-page">
  <h1 class="aivastra-contact-title">Contact</h1>

  <form class="aivastra-contact-form" onsubmit="event.preventDefault(); this.reset(); this.querySelector('.aivastra-contact-thanks').hidden = false;">
    <div class="aivastra-contact-field">
      <label for="aivastra-contact-name">Name</label>
      <input type="text" id="aivastra-contact-name" name="name" />
    </div>
    <div class="aivastra-contact-field">
      <label for="aivastra-contact-email">Email <span class="aivastra-contact-required">*</span></label>
      <input type="email" id="aivastra-contact-email" name="email" required />
    </div>
    <div class="aivastra-contact-field">
      <label for="aivastra-contact-phone">Phone</label>
      <input type="tel" id="aivastra-contact-phone" name="phone" />
    </div>
    <div class="aivastra-contact-field">
      <label for="aivastra-contact-comment">Comment</label>
      <textarea id="aivastra-contact-comment" name="comment" rows="5"></textarea>
    </div>
    <button type="submit" class="aivastra-contact-submit">Submit</button>
    <p class="aivastra-contact-thanks" hidden>Thanks — we'll get back to you soon.</p>
  </form>
</div>
HTML;

$existing = get_page_by_path('contact');
if ($existing instanceof WP_Post) {
    wp_update_post([
        'ID' => $existing->ID,
        'post_content' => $content,
        'post_title' => 'Contact',
    ]);
    echo "Success: Contact page updated (page id {$existing->ID}).\n";
    return;
}

$pageId = wp_insert_post([
    'post_title' => 'Contact',
    'post_content' => $content,
    'post_status' => 'publish',
    'post_type' => 'page',
]);
echo "Success: Contact page created (page id {$pageId}).\n";
