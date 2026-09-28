(() => {
  var popover = null;
  var closeBtn = null;

  function initElements() {
    popover = document.querySelector('.aivastra-account-popover');
    if (!popover) return false;
    closeBtn = popover.querySelector('.aivastra-account-close');
    return true;
  }

  function positionPopover(trigger) {
    if (!popover || !trigger) return;

    var cartEl = document.querySelector('.aivastra-cart-trigger, .aivastra-nav-cart');
    var anchorEl = cartEl || trigger;
    var anchorRect = anchorEl.getBoundingClientRect();
    var viewportWidth = window.innerWidth;
    var navbarEl =
      trigger.closest('.aivastra-navbar') ||
      trigger.closest('header') ||
      document.querySelector('.aivastra-navbar');
    var navbarRect = navbarEl ? navbarEl.getBoundingClientRect() : null;

    // Top: just below the navbar bottom (same as Shopify: top = header height)
    var top = navbarRect ? navbarRect.bottom : anchorRect.bottom + 10;

    // Right: 20px gap from the viewport right edge — exact Shopify parity
    // The card right edge aligns with the cart icon right edge + ~20px inset from viewport
    var rightGap = viewportWidth - anchorRect.right;
    var right = Math.max(rightGap, 20);

    popover.style.top = `${top}px`;
    popover.style.right = `${right}px`;
    popover.style.left = 'auto';
    popover.style.width = '360px';
    popover.style.maxWidth = 'calc(100vw - 32px)';
  }

  function openPopover(trigger) {
    if (!popover && !initElements()) return;

    positionPopover(trigger);
    popover.classList.add('is-open');
    popover.setAttribute('aria-hidden', 'false');

    if (closeBtn) {
      closeBtn.focus();
    }
  }

  function closePopover() {
    if (!popover) return;
    popover.classList.remove('is-open');
    popover.setAttribute('aria-hidden', 'true');
  }

  function togglePopover(trigger) {
    if (!popover && !initElements()) return;
    if (popover.classList.contains('is-open')) {
      closePopover();
    } else {
      openPopover(trigger);
    }
  }

  function wireEvents() {
    document.addEventListener('click', (e) => {
      var trigger = e.target.closest('.aivastra-account-trigger');
      if (trigger) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        togglePopover(trigger);
        return;
      }

      if (popover?.classList.contains('is-open')) {
        if (!popover.contains(e.target)) {
          closePopover();
        }
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closePopover();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popover && popover.classList.contains('is-open')) {
        closePopover();
      }
    });

    window.addEventListener('resize', () => {
      var activeTrigger = document.querySelector('.aivastra-account-trigger');
      if (popover?.classList.contains('is-open') && activeTrigger) {
        positionPopover(activeTrigger);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (initElements()) wireEvents();
    });
  } else {
    if (initElements()) wireEvents();
  }

  window.aivastraOpenAccountPopover = openPopover;
  window.aivastraCloseAccountPopover = closePopover;
})();
