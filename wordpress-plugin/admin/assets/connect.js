/**
 * The embedded "log in or sign up with your Ai Vastra email" form
 * (admin/class-settings-page.php's render_connect_form(), primary connect
 * path per docs/wordpress-plugin-design.md §4.1). Posts to
 * Aivastra_Connect_Ajax in one AJAX call — no admin-post.php redirect, no
 * leaving wp-admin, for the common case of an existing, already-verified
 * account. The password is read straight from the field into the request
 * body and never touches any other variable or storage.
 *
 * Also wires the password show/hide toggle — it lives in this one file
 * since it shares the same connect-step markup and only ever loads
 * alongside the form above. "Continue with Google" needs no JS of its own:
 * its form opens in a plain new tab via a static target="_blank"
 * (render_connect_form()'s own doc comment) — a sized window.open() popup
 * was tried first, but the merchant explicitly asked for a plain tab
 * instead ("previously it is opening in new tab that option is good... make
 * sure no new window opens").
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
  var emailInput = document.getElementById('aivastra_connect_email');

  // handle_connect_callback()'s render_connect_popup_close() posts here once
  // the Google tab finishes, then closes itself. target="_blank" with no
  // rel="noopener" keeps window.opener reachable from that tab since it's
  // same-origin (admin-post.php on this same site), so this still works
  // without ever calling window.open() ourselves.
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin || !e.data || typeof e.data !== 'object') {
      return;
    }
    if (e.data.aivastraConnected === true) {
      window.location.reload();
    } else if (e.data.aivastraConnected === false && messageEl) {
      messageEl.textContent = 'Google sign-in did not complete. Please try again.';
      messageEl.classList.remove('is-info', 'is-success');
      messageEl.classList.add('is-visible', 'is-error');
    }
  });

  var pwdInput = document.getElementById('aivastra_connect_password');
  var pwdToggle = document.getElementById('aivastra-connect-password-toggle');
  if (pwdInput && pwdToggle) {
    pwdToggle.addEventListener('click', () => {
      var showing = pwdInput.type === 'text';
      pwdInput.type = showing ? 'password' : 'text';
      pwdToggle.setAttribute('aria-pressed', showing ? 'false' : 'true');
      pwdToggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  }

  // The form above already creates an account inline when the email doesn't
  // match one yet (Aivastra_Connect_Ajax), so "Sign Up" has nothing to
  // navigate to — it just focuses Email for a merchant following the
  // reference page's own habit of looking for a separate sign-up link.
  var signupBtn = document.getElementById('aivastra-connect-signup');
  if (signupBtn && emailInput) {
    signupBtn.addEventListener('click', () => {
      emailInput.focus();
    });
  }

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
