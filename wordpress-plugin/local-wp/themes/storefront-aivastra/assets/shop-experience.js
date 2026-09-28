(() => {
  function initInfiniteScroll() {
    var sentinel = document.querySelector('.aivastra-shop-infinite-sentinel');
    var grid = document.querySelector('ul.products');
    if (!sentinel || !grid || typeof aivastraShopExperience === 'undefined') {
      return;
    }

    var maxPages = parseInt(sentinel.getAttribute('data-max-pages'), 10) || 1;
    var query = {};
    try {
      query = JSON.parse(sentinel.getAttribute('data-query') || '{}');
    } catch (e) {
      query = {};
    }
    var loading = false;

    function loadNextPage() {
      var page = parseInt(sentinel.getAttribute('data-page'), 10) || 1;
      if (loading || page >= maxPages) {
        return;
      }
      loading = true;
      sentinel.classList.add('is-loading');

      var body = new URLSearchParams();
      body.set('action', 'aivastra_load_more_products');
      body.set('nonce', aivastraShopExperience.nonce);
      body.set('page', String(page + 1));
      Object.keys(query).forEach((key) => {
        var value = query[key];
        if (Array.isArray(value)) {
          value.forEach((v) => {
            body.append('query[' + key + '][]', v);
          });
        } else {
          body.set('query[' + key + ']', value == null ? '' : String(value));
        }
      });

      fetch(aivastraShopExperience.ajaxUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
        .then((res) => res.json())
        .then((json) => {
          if (json && json.success && json.data) {
            const temp = document.createElement('div');
            temp.innerHTML = json.data.html;
            Array.prototype.forEach.call(temp.children, (node) => {
              grid.appendChild(node);
            });
            sentinel.setAttribute('data-page', String(page + 1));
            if (!json.data.hasMore) {
              observer.disconnect();
              sentinel.remove();
            }
          } else {
            observer.disconnect();
          }
        })
        .catch(() => {
          observer.disconnect();
        })
        .finally(() => {
          loading = false;
          sentinel.classList.remove('is-loading');
        });
    }

    var observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadNextPage();
          }
        });
      },
      { rootMargin: '400px' },
    );
    observer.observe(sentinel);
  }

  function initDensityToggle() {
    var buttons = document.querySelectorAll('.aivastra-density-btn');
    var grid = document.querySelector('ul.products');
    if (!buttons.length || !grid) {
      return;
    }

    function applyCols(cols) {
      grid.classList.remove('aivastra-cols-3', 'aivastra-cols-4', 'aivastra-cols-5');
      grid.classList.add('aivastra-cols-' + cols);
      buttons.forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-cols') === String(cols));
      });
    }

    var saved = null;
    try {
      saved = window.localStorage.getItem('aivastra-shop-density');
    } catch (e) {
      saved = null;
    }
    if (saved) {
      applyCols(saved);
    }

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        var cols = btn.getAttribute('data-cols');
        applyCols(cols);
        try {
          window.localStorage.setItem('aivastra-shop-density', cols);
        } catch (e) {
          /* ignore — per-viewer convenience only */
        }
      });
    });
  }

  function initFilterDropdowns() {
    var dropdowns = document.querySelectorAll('.aivastra-shop-filter-dropdown');
    if (!dropdowns.length) {
      return;
    }

    // Belt-and-suspenders alongside the <details name="..."> exclusive-
    // accordion attribute in the markup: that attribute alone closes
    // siblings in browsers that support it, but doesn't close a panel on an
    // outside click, and older engines ignore it entirely (both panels stay
    // open and overlap — the exact bug this was added to fix).
    dropdowns.forEach((el) => {
      el.addEventListener('toggle', () => {
        if (el.open) {
          dropdowns.forEach((other) => {
            if (other !== el) {
              other.open = false;
            }
          });
        }
      });
    });

    document.addEventListener('click', (e) => {
      dropdowns.forEach((el) => {
        if (el.open && !el.contains(e.target)) {
          el.open = false;
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initInfiniteScroll();
    initDensityToggle();
    initFilterDropdowns();
  });
})();
