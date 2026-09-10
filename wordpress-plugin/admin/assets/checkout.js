(() => {
  if (typeof aivastraCheckout === 'undefined' || !window.Razorpay) {
    return;
  }

  var order = aivastraCheckout.order;

  // Payment succeeds instantly (Razorpay's own modal closes right away), but
  // crediting the account still needs a network round-trip to admin-ajax —
  // without this, the settings page just sits there unchanged for that gap,
  // which reads as "nothing happened" and prompts a reflexive manual refresh.
  function showVerifyingOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'aivastra-verifying-overlay';
    overlay.innerHTML =
      '<div class="aivastra-verifying-box"><span class="aivastra-spinner"></span>Verifying payment…</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  var rzp = new window.Razorpay({
    key: order.keyId,
    amount: order.amount,
    currency: order.currency,
    order_id: order.orderId,
    name: 'Aivastra',
    description: `${order.label} — ${order.credits.toLocaleString()} credits`,
    handler: (response) => {
      var overlay = showVerifyingOverlay();
      var body = new URLSearchParams();
      body.set('action', 'aivastra_tryon_verify_payment');
      body.set('nonce', aivastraCheckout.nonce);
      body.set('razorpay_order_id', response.razorpay_order_id);
      body.set('razorpay_payment_id', response.razorpay_payment_id);
      body.set('razorpay_signature', response.razorpay_signature);

      fetch(aivastraCheckout.ajaxUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
        .then((res) => res.json())
        .then((json) => {
          if (json.success) {
            window.location.reload();
          } else {
            overlay.remove();
            window.alert(
              json.data?.message ||
                'Payment received but not yet reflected — click Refresh balance.',
            );
          }
        })
        .catch(() => {
          overlay.remove();
          window.alert('Payment received but not yet reflected — click Refresh balance.');
        });
    },
    modal: {
      ondismiss: () => {
        // No error — matches the web app's silent "dismissed" handling.
      },
    },
  });

  rzp.open();
})();
