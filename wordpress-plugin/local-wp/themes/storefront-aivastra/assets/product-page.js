(() => {
  function relabelTryOnButton() {
    var span = document.querySelector('#aivastra-tryon-button span');
    if (span) {
      span.textContent = 'Virtual Try-On: Try This Look';
    }
  }

  function wireSizePills() {
    var pills = document.querySelectorAll('.aivastra-size-pill');
    pills.forEach((pill) => {
      pill.addEventListener('click', () => {
        pills.forEach((p) => {
          p.classList.remove('is-selected');
        });
        pill.classList.add('is-selected');
      });
    });
  }

  function wireBuyNow() {
    var btn = document.querySelector('.aivastra-buy-now-button');
    var form = document.querySelector('.single-product form.cart');
    var addToCartButton = form ? form.querySelector('button[name="add-to-cart"]') : null;
    if (!btn || !form || !addToCartButton) {
      return;
    }
    btn.addEventListener('click', () => {
      var flag = form.querySelector('input[name="aivastra_buy_now"]');
      if (!flag) {
        flag = document.createElement('input');
        flag.type = 'hidden';
        flag.name = 'aivastra_buy_now';
        form.appendChild(flag);
      }
      flag.value = '1';
      // requestSubmit() needs the real "Add to cart" button as the submitter,
      // or its name="add-to-cart" value never reaches the POST body and
      // WC_Form_Handler::add_to_cart_action() no-ops.
      if (form.requestSubmit) {
        form.requestSubmit(addToCartButton);
      } else {
        addToCartButton.click();
      }
    });
  }

  function wireQuantityStepper() {
    document.querySelectorAll('.single-product .quantity').forEach((qty) => {
      var input = qty.querySelector('input.qty');
      if (!input || qty.querySelector('.aivastra-qty-btn')) {
        return;
      }

      var minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'aivastra-qty-btn aivastra-qty-minus';
      minus.textContent = '−';
      minus.setAttribute('aria-label', 'Decrease quantity');

      var plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'aivastra-qty-btn aivastra-qty-plus';
      plus.textContent = '+';
      plus.setAttribute('aria-label', 'Increase quantity');

      qty.insertBefore(minus, input);
      qty.appendChild(plus);

      var step = (delta) => {
        var min = parseInt(input.min, 10) || 1;
        var max = input.max ? parseInt(input.max, 10) : Infinity;
        var value = (parseInt(input.value, 10) || min) + delta;
        input.value = Math.min(max, Math.max(min, value));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      minus.addEventListener('click', () => step(-1));
      plus.addEventListener('click', () => step(1));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    relabelTryOnButton();
    wireSizePills();
    wireBuyNow();
    wireQuantityStepper();
  });
})();
