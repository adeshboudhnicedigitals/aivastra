/**
 * Manage page's Eligibility tab (admin/class-settings-page.php's
 * render_product_eligibility_list()) — each row's checkbox fires its own
 * AJAX call against Aivastra_Product_Eligibility_Ajax immediately on
 * change, no Save button for the list as a whole. A failed request reverts
 * the checkbox and shows an inline error next to that row only, so one
 * failure never looks like it silently applied.
 */
(() => {
  if (typeof aivastraProductEligibility === 'undefined') {
    return;
  }

  var rows = document.querySelectorAll('.aivastra-eligibility-row');
  if (!rows.length) {
    return;
  }

  rows.forEach((row) => {
    var checkbox = row.querySelector('.aivastra-eligibility-checkbox');
    var statusEl = row.querySelector('.aivastra-eligibility-row-status');
    if (!checkbox || !statusEl) {
      return;
    }

    checkbox.addEventListener('change', () => {
      var productId = checkbox.getAttribute('data-product-id');
      var enabled = checkbox.checked;
      checkbox.disabled = true;
      statusEl.textContent = 'Saving…';
      statusEl.classList.remove('is-error');

      var body = new URLSearchParams({
        action: 'aivastra_tryon_set_product_eligibility',
        nonce: aivastraProductEligibility.nonce,
        productId: productId,
        enabled: enabled ? '1' : '0',
      });

      fetch(aivastraProductEligibility.ajaxUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
        .then((res) => res.json())
        .then((json) => {
          if (!json.success) {
            throw new Error((json.data && json.data.message) || 'Could not save.');
          }
          statusEl.textContent = 'Saved';
          setTimeout(() => {
            statusEl.textContent = '';
          }, 1500);
        })
        .catch((err) => {
          checkbox.checked = !enabled;
          statusEl.textContent = err.message || 'Could not save.';
          statusEl.classList.add('is-error');
        })
        .finally(() => {
          checkbox.disabled = false;
        });
    });
  });
})();
