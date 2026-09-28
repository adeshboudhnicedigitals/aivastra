(() => {
  var STORAGE_KEY = 'aivastraRecentlyViewed';

  function getRecentlyViewed() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (_e) {
      return [];
    }
    return raw ? JSON.parse(raw) : [];
  }

  function setRecentlyViewed(items) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (_e) {
      // Private-browsing/blocked storage — recently-viewed just won't persist.
    }
  }

  function recordCurrentProduct() {
    if (typeof aivastraSearchModal === 'undefined' || !aivastraSearchModal.currentProduct) {
      return;
    }
    var current = aivastraSearchModal.currentProduct;
    var items = getRecentlyViewed().filter((item) => item.id !== current.id);
    items.unshift(current);
    setRecentlyViewed(items.slice(0, 4));
  }

  function cardMarkup(item) {
    return (
      '<a class="aivastra-search-card" href="' +
      item.url +
      '">' +
      '<img src="' +
      item.image +
      '" alt="" loading="lazy" />' +
      '<p class="aivastra-search-card-title">' +
      item.title +
      '</p>' +
      '<p class="aivastra-search-card-price">' +
      item.price +
      '</p>' +
      '</a>'
    );
  }

  function initSearchModal() {
    var trigger = document.querySelector('.aivastra-search-trigger');
    var overlay = document.querySelector('.aivastra-search-overlay');
    if (!trigger || !overlay || typeof aivastraSearchModal === 'undefined') {
      return;
    }

    var input = overlay.querySelector('.aivastra-search-input');
    var closeBtn = overlay.querySelector('.aivastra-search-close');
    var recentSection = overlay.querySelector('.aivastra-search-recent');
    var recentGrid = overlay.querySelector('.aivastra-search-recent-grid');
    var recentClear = overlay.querySelector('.aivastra-search-recent-clear');
    var productsSection = overlay.querySelector('.aivastra-search-products');
    var productsGrid = overlay.querySelector('.aivastra-search-products-grid');
    var debounceTimer = null;

    function renderRecentlyViewed() {
      var items = getRecentlyViewed();
      recentSection.hidden = items.length === 0;
      recentGrid.innerHTML = items.map(cardMarkup).join('');
    }

    function renderProducts(html) {
      productsGrid.innerHTML = html || '';
      productsSection.hidden = !html;
    }

    function fetchProducts(term) {
      var body = new URLSearchParams();
      body.set('action', 'aivastra_search_products');
      body.set('nonce', aivastraSearchModal.nonce);
      body.set('term', term);

      window
        .fetch(aivastraSearchModal.ajaxUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
        .then((res) => res.json())
        .then((json) => {
          if (json?.success) {
            renderProducts(json.data.html);
          }
        })
        .catch(() => {});
    }

    function openModal() {
      overlay.hidden = false;
      document.body.classList.add('aivastra-search-open');
      renderRecentlyViewed();
      fetchProducts('');
      window.setTimeout(() => input.focus(), 0);
    }

    function closeModal() {
      overlay.hidden = true;
      document.body.classList.remove('aivastra-search-open');
      input.value = '';
    }

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      openModal();
    });

    closeBtn.addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.hidden) {
        closeModal();
      }
    });

    recentClear.addEventListener('click', (e) => {
      e.preventDefault();
      setRecentlyViewed([]);
      renderRecentlyViewed();
    });

    input.addEventListener('input', () => {
      var term = input.value.trim();
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => fetchProducts(term), 300);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    recordCurrentProduct();
    initSearchModal();
  });
})();
