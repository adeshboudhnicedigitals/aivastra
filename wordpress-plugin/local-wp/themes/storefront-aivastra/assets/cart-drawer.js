(() => {
  var drawer = null;
  var overlay = null;
  var drawerInner = null;
  var headerTitle = null;
  var headerCount = null;
  var emptyContainer = null;
  var filledContainer = null;
  var itemsList = null;
  var subtotalEl = null;
  var closeBtn = null;
  var continueBtn = null;
  var navBadges = null;

  function initElements() {
    drawer = document.querySelector('.aivastra-cart-drawer');
    overlay = document.querySelector('.aivastra-cart-drawer-overlay');
    if (!drawer || !overlay) {
      return false;
    }

    drawerInner = drawer.querySelector('.aivastra-cart-drawer-inner');
    headerTitle = drawer.querySelector('.aivastra-cart-drawer-header-title');
    headerCount = drawer.querySelector('.aivastra-cart-drawer-count-badge');
    emptyContainer = drawer.querySelector('.aivastra-cart-drawer-empty');
    filledContainer = drawer.querySelector('.aivastra-cart-drawer-filled');
    itemsList = drawer.querySelector('.aivastra-cart-drawer-items-list');
    subtotalEl = drawer.querySelector('.aivastra-cart-drawer-subtotal-amount');
    closeBtn = drawer.querySelector('.aivastra-cart-drawer-close');
    continueBtn = drawer.querySelector('.aivastra-cart-drawer-continue-btn');
    navBadges = document.querySelectorAll('.aivastra-nav-cart-badge');
    return true;
  }

  function updateBadge(count) {
    var num = parseInt(count, 10) || 0;
    if (headerCount) {
      headerCount.textContent = num;
    }
    navBadges.forEach((badge) => {
      badge.textContent = num;
      if (num > 0) {
        badge.classList.remove('aivastra-badge-hidden');
        badge.style.display = '';
      } else {
        badge.classList.add('aivastra-badge-hidden');
        badge.style.display = 'none';
      }
    });
  }

  function updateDrawerUI(data) {
    if (!data) return;

    updateBadge(data.item_count);

    if (data.is_empty) {
      if (drawerInner) drawerInner.classList.add('is-empty');
      if (headerTitle) headerTitle.style.display = 'none';
      if (emptyContainer) emptyContainer.style.display = '';
      if (filledContainer) filledContainer.style.display = 'none';
      if (itemsList) itemsList.innerHTML = '';
    } else {
      if (drawerInner) drawerInner.classList.remove('is-empty');
      if (headerTitle) headerTitle.style.display = '';
      if (emptyContainer) emptyContainer.style.display = 'none';
      if (filledContainer) filledContainer.style.display = '';
      if (itemsList && typeof data.items_html === 'string') {
        itemsList.innerHTML = data.items_html;
      }
      if (subtotalEl && data.subtotal) {
        subtotalEl.innerHTML = data.subtotal;
      }
    }
  }

  function fetchCartState(callback) {
    if (typeof aivastraCartDrawer === 'undefined') return;

    var body = new URLSearchParams();
    body.append('action', 'aivastra_cart_drawer_get');
    body.append('nonce', aivastraCartDrawer.nonce);

    fetch(aivastraCartDrawer.ajaxUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data) {
          updateDrawerUI(json.data);
          if (typeof callback === 'function') {
            callback(json.data);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to fetch cart:', err);
      });
  }

  function openCartDrawer() {
    if (!drawer && !initElements()) return;

    fetchCartState();
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('aivastra-cart-open');

    if (closeBtn) {
      closeBtn.focus();
    }
  }

  function closeCartDrawer() {
    if (!drawer) return;

    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('aivastra-cart-open');
  }

  function updateQuantity(cartKey, newQty) {
    if (typeof aivastraCartDrawer === 'undefined' || !cartKey) return;

    if (drawerInner) {
      drawerInner.style.opacity = '0.7';
      drawerInner.style.pointerEvents = 'none';
    }

    var body = new URLSearchParams();
    body.append('action', 'aivastra_cart_drawer_update_qty');
    body.append('nonce', aivastraCartDrawer.nonce);
    body.append('cart_key', cartKey);
    body.append('quantity', newQty);

    fetch(aivastraCartDrawer.ajaxUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data) {
          updateDrawerUI(json.data);
        }
      })
      .catch((err) => {
        console.error('Failed to update cart quantity:', err);
      })
      .finally(() => {
        if (drawerInner) {
          drawerInner.style.opacity = '';
          drawerInner.style.pointerEvents = '';
        }
      });
  }

  function removeItem(cartKey) {
    if (typeof aivastraCartDrawer === 'undefined' || !cartKey) return;

    if (drawerInner) {
      drawerInner.style.opacity = '0.7';
      drawerInner.style.pointerEvents = 'none';
    }

    var body = new URLSearchParams();
    body.append('action', 'aivastra_cart_drawer_remove');
    body.append('nonce', aivastraCartDrawer.nonce);
    body.append('cart_key', cartKey);

    fetch(aivastraCartDrawer.ajaxUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data) {
          updateDrawerUI(json.data);
        }
      })
      .catch((err) => {
        console.error('Failed to remove cart item:', err);
      })
      .finally(() => {
        if (drawerInner) {
          drawerInner.style.opacity = '';
          drawerInner.style.pointerEvents = '';
        }
      });
  }

  function wireEvents() {
    // Cart icon click
    document.addEventListener('click', (e) => {
      var cartTrigger = e.target.closest(
        '.aivastra-cart-trigger, .aivastra-nav-cart, [data-aivastra-open-cart]',
      );
      if (cartTrigger) {
        // Don't intercept if user explicitly holds ctrl/cmd to open in new tab
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        openCartDrawer();
      }
    });

    // Close button click
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeCartDrawer();
      });
    }

    // Overlay click
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        e.preventDefault();
        closeCartDrawer();
      });
    }

    // Continue shopping click
    if (continueBtn) {
      continueBtn.addEventListener('click', (e) => {
        // If we are already on shop page, just close drawer smoothly
        if (
          window.location.pathname.replace(/\/$/, '') ===
          new URL(continueBtn.href, window.location.origin).pathname.replace(/\/$/, '')
        ) {
          e.preventDefault();
          closeCartDrawer();
        }
      });
    }

    // Keydown Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer && drawer.classList.contains('is-open')) {
        closeCartDrawer();
      }
    });

    // Delegate quantity & remove clicks in itemsList
    if (itemsList) {
      itemsList.addEventListener('click', (e) => {
        var minusBtn = e.target.closest('.aivastra-cart-drawer-qty-minus');
        var plusBtn = e.target.closest('.aivastra-cart-drawer-qty-plus');
        var removeBtn = e.target.closest('.aivastra-cart-drawer-item-remove');
        var key;
        var input;
        var currentVal;

        if (minusBtn) {
          e.preventDefault();
          key = minusBtn.getAttribute('data-cart-key');
          input = minusBtn.parentNode.querySelector('.aivastra-cart-drawer-qty-input');
          currentVal = parseInt(input.value, 10) || 1;
          updateQuantity(key, Math.max(0, currentVal - 1));
          return;
        }

        if (plusBtn) {
          e.preventDefault();
          key = plusBtn.getAttribute('data-cart-key');
          input = plusBtn.parentNode.querySelector('.aivastra-cart-drawer-qty-input');
          currentVal = parseInt(input.value, 10) || 1;
          updateQuantity(key, currentVal + 1);
          return;
        }

        if (removeBtn) {
          e.preventDefault();
          key = removeBtn.getAttribute('data-cart-key');
          removeItem(key);
          return;
        }
      });
    }

    // Intercept single product "Add to cart" form submission for smooth drawer opening
    var cartForm = document.querySelector('.single-product form.cart');
    if (cartForm) {
      cartForm.addEventListener('submit', (e) => {
        var buyNowFlag = cartForm.querySelector('input[name="aivastra_buy_now"]');
        if (buyNowFlag && buyNowFlag.value === '1') {
          // Allow normal submission directly to checkout
          return;
        }

        // Check if there is a product ID
        var addToCartBtn = cartForm.querySelector('button[name="add-to-cart"]');
        var productId = addToCartBtn ? addToCartBtn.value : null;
        var hiddenId;
        if (!productId) {
          hiddenId = cartForm.querySelector('input[name="add-to-cart"]');
          if (hiddenId) productId = hiddenId.value;
        }

        if (!productId) {
          return; // Fallback to native post
        }

        e.preventDefault();

        var qtyInput = cartForm.querySelector('input[name="quantity"]');
        var quantity = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;

        if (addToCartBtn) {
          addToCartBtn.classList.add('loading');
          addToCartBtn.disabled = true;
        }

        var body = new URLSearchParams();
        body.append('action', 'aivastra_cart_drawer_add');
        body.append('nonce', aivastraCartDrawer.nonce);
        body.append('product_id', productId);
        body.append('quantity', quantity);

        fetch(aivastraCartDrawer.ajaxUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
          .then((res) => res.json())
          .then((json) => {
            if (json.success && json.data) {
              updateDrawerUI(json.data);
              openCartDrawer();
            } else {
              // Fallback
              cartForm.submit();
            }
          })
          .catch(() => {
            cartForm.submit();
          })
          .finally(() => {
            if (addToCartBtn) {
              addToCartBtn.classList.remove('loading');
              addToCartBtn.disabled = false;
            }
          });
      });
    }

    // WooCommerce jQuery event bridge
    if (window.jQuery) {
      window.jQuery(document.body).on('added_to_cart', () => {
        fetchCartState(() => {
          openCartDrawer();
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (initElements()) {
        wireEvents();
      }
    });
  } else {
    if (initElements()) {
      wireEvents();
    }
  }

  // Expose helper globally
  window.aivastraOpenCartDrawer = openCartDrawer;
  window.aivastraCloseCartDrawer = closeCartDrawer;
})();
