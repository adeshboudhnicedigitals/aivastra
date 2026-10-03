/**
 * The embedded "log in or sign up with your Ai Vastra email" form
 * (admin/class-settings-page.php's render_connect_form(), primary connect
 * path per docs/wordpress-plugin-design.md §4.1). Posts to
 * Aivastra_Connect_Ajax in one AJAX call — no admin-post.php redirect, no
 * leaving wp-admin, for the common case of an existing, already-verified
 * account. The password is read straight from the field into the request
 * body and never touches any other variable or storage.
 */
(() => {
  if (typeof aivastraConnect === 'undefined') {
    return;
  }

  var form = document.getElementById('aivastra-connect-form');
  var submitBtn = document.getElementById('aivastra-connect-submit');
  var messageEl = document.getElementById('aivastra-connect-message');
  var phoneRow = document.getElementById('aivastra-connect-phone-row');
  var phoneInput = document.getElementById('aivastra_connect_phone');

  if (!form || !submitBtn || !messageEl) {
    return;
  }

  function showMessage(text, variant) {
    messageEl.textContent = text;
    messageEl.classList.remove('is-error', 'is-info', 'is-success');
    messageEl.classList.add('is-visible', 'is-' + variant);
  }

  function clearMessage() {
    messageEl.classList.remove('is-visible', 'is-error', 'is-info', 'is-success');
    messageEl.textContent = '';
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submitBtn.disabled) {
      return;
    }
    clearMessage();
    submitBtn.disabled = true;
    var originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Connecting…';

    var body = new URLSearchParams();
    body.set('action', 'aivastra_tryon_connect_login');
    body.set('nonce', aivastraConnect.nonce);
    body.set('email', form.elements.email.value.trim());
    body.set('password', form.elements.password.value);
    if (phoneInput && phoneInput.value.trim() !== '') {
      body.set('phone', phoneInput.value.trim());
    }

    fetch(aivastraConnect.ajaxUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
      .then((res) => res.json())
      .then((json) => {
        var data = json.data || {};

        if (json.success) {
          if (data.status === 'verification_required') {
            form.hidden = true;
            showMessage(
              'Check your email to verify your new Ai Vastra account, then come back and log in here.',
              'info',
            );
            return;
          }
          // 'connected' — reload so the page re-renders the connected
          // dashboard, same as a successful admin-post.php redirect would.
          window.location.reload();
          return;
        }

        if (data.status === 'merchant_details_required') {
          if (phoneRow) {
            phoneRow.hidden = false;
          }
          if (phoneInput) {
            phoneInput.focus();
          }
          showMessage(data.message || 'A phone number is needed to continue.', 'info');
          return;
        }

        showMessage(data.message || 'Something went wrong. Try again.', 'error');
      })
      .catch(() => {
        showMessage(
          'Could not reach the aivastra API. Check your connection and try again.',
          'error',
        );
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      });
  });
})();
