/**
 * "Refresh balance" (render_connection_section()) — AJAX against
 * Aivastra_Refresh_Ajax so the credit number updates in place, with a small
 * confirmation right next to it, instead of a full page reload landing on a
 * WP admin notice banner. See the comment left where handle_refresh() used
 * to live (admin/class-settings-page.php, above handle_disconnect()) for
 * why that banner had to go: on the one-page dashboard, WordPress core's
 * own common.js relocates every such notice to right after the page's
 * first <h1>, which is the app header's logo row.
 */
(() => {
  if (typeof aivastraRefreshBalance === 'undefined') {
    return;
  }

  var btn = document.getElementById('aivastra-refresh-balance');
  var numberEl = document.getElementById('aivastra-credit-number');
  var metaEl = document.getElementById('aivastra-credit-meta');
  var confirmEl = document.getElementById('aivastra-refresh-confirm');

  if (!btn || !numberEl || !metaEl || !confirmEl) {
    return;
  }

  var confirmTimeout = null;

  function showConfirm(text, isError) {
    clearTimeout(confirmTimeout);
    confirmEl.textContent = text;
    confirmEl.classList.toggle('is-error', !!isError);
    confirmEl.classList.add('is-visible');
    // Success clears itself — the fresh number is the lasting record. An
    // error stays up until the next attempt (clearConfirm below), since a
    // merchant who looks away shouldn't come back to a silently-failed
    // refresh with nothing to show for it.
    if (!isError) {
      confirmTimeout = setTimeout(clearConfirm, 2500);
    }
  }

  function clearConfirm() {
    clearTimeout(confirmTimeout);
    confirmEl.classList.remove('is-visible', 'is-error');
    confirmEl.textContent = '';
  }

  btn.addEventListener('click', () => {
    if (btn.classList.contains('is-refreshing')) {
      return;
    }
    clearConfirm();
    btn.classList.add('is-refreshing');
    btn.disabled = true;

    var body = new URLSearchParams();
    body.set('action', 'aivastra_tryon_refresh_balance');
    body.set('nonce', btn.dataset.nonce);

    fetch(aivastraRefreshBalance.ajaxUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) {
          throw new Error((json.data && json.data.message) || 'Could not refresh your balance.');
        }
        // Mirrors render_connection_section()'s own "Unlimited" branch
        // exactly, so a refresh reads the same as the page's first load.
        if (json.data.unlimited) {
          numberEl.textContent = 'Unlimited';
          metaEl.textContent =
            "You're on an unlimited plan — try-ons aren't metered against a credit balance.";
          showConfirm('Refreshed', false);
          return;
        }

        var credits = json.data.credits;
        if (typeof credits === 'number') {
          numberEl.textContent = credits.toLocaleString();
        }
        // Mirrors the PHP template's own phrasing exactly
        // (render_connection_section()) so a refresh reads the same as the
        // page's first load, down to the singular/plural wording. No
        // "roughly N days at your current rate" any more, at the merchant's
        // request — json.data.daysRemaining is still sent by the AJAX
        // handler (Aivastra_Refresh_Ajax), just unused here now.
        var tryOns = json.data.tryOnsRemaining;
        if (typeof tryOns === 'number') {
          metaEl.textContent = `About ${tryOns.toLocaleString()} try-on${tryOns === 1 ? '' : 's'} remaining`;
        } else if (json.data.creditsAsOf) {
          metaEl.textContent = 'Balance last checked ' + json.data.creditsAsOf;
        }
        showConfirm('Refreshed', false);
      })
      .catch((err) => {
        showConfirm(err.message || 'Could not refresh your balance.', true);
      })
      .finally(() => {
        btn.classList.remove('is-refreshing');
        btn.disabled = false;
      });
  });
})();
