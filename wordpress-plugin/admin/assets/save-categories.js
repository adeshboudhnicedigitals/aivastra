/**
 * "Save categories" (admin/class-settings-page.php's render_category_mapping())
 * — AJAX against Aivastra_Category_Map_Ajax so the page shows a small inline
 * confirmation next to the Save button, instead of a full page reload landing
 * on a WP admin notice banner core relocates to right after the page's first
 * heading. Same idiom as admin/assets/refresh-balance.js. The one exception
 * is a save that completes onboarding step 2 — the handler says so via
 * `redirectUrl`, and this still navigates there (the dashboard itself is the
 * confirmation in that case, same as every other onboarding transition).
 */
(() => {
  if (typeof aivastraSaveCategories === 'undefined') {
    return;
  }

  var form = document.getElementById('aivastra-category-map-form');
  var submitBtn = document.getElementById('aivastra-category-map-submit');
  var confirmEl = document.getElementById('aivastra-category-map-confirm');

  if (!form || !submitBtn || !confirmEl) {
    return;
  }

  var confirmTimeout = null;

  function showConfirm(text, isError) {
    clearTimeout(confirmTimeout);
    confirmEl.textContent = text;
    confirmEl.classList.toggle('is-error', !!isError);
    confirmEl.classList.add('is-visible');
    if (!isError) {
      confirmTimeout = setTimeout(clearConfirm, 2500);
    }
  }

  function clearConfirm() {
    clearTimeout(confirmTimeout);
    confirmEl.classList.remove('is-visible', 'is-error');
    confirmEl.textContent = '';
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submitBtn.disabled) {
      return;
    }
    clearConfirm();
    submitBtn.disabled = true;
    var originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Saving…';

    // The hidden "action" input and wp_nonce_field()'s _wpnonce (both already
    // in the form's markup) ride along via FormData — nothing else to add.
    var body = new URLSearchParams(new FormData(form));

    fetch(aivastraSaveCategories.ajaxUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) {
          throw new Error((json.data && json.data.message) || 'Could not save your categories.');
        }
        if (json.data && json.data.redirectUrl) {
          window.location.href = json.data.redirectUrl;
          return;
        }
        showConfirm('Saved', false);
      })
      .catch((err) => {
        showConfirm(err.message || 'Could not save your categories.', true);
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      });
  });
})();
