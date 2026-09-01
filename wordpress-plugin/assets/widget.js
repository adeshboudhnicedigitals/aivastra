(() => {
  const config = window.AivastraTryOn;
  if (!config?.widgetKey) return;

  const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
  const HISTORY_STORAGE_KEY = 'aivastra_tryon_history';
  const REUSE_STORAGE_KEY = 'aivastra_tryon_last_photo';
  const REUSE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  // Merchant branding from Settings -> Aivastra Try-On -> Widget appearance
  // (Aivastra_Widget_Customization). Every field is nullable/optional —
  // absent means "use the hardcoded default below", never a forced re-save
  // for merchants who haven't opened that form.
  const customization = config.customization || {};

  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  // Everything else injected via innerHTML in this file is either a
  // hardcoded literal or an attribute-context URL — this is the only path
  // for merchant-entered text, so it is the only place that needs escaping.
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
  }

  const CLIENT_ID_STORAGE_KEY = 'aivastra_tryon_client_id';

  // A private-browsing session or blocked storage returns null here — events
  // still send, just without a stable id, so that shopper won't count toward
  // "unique shoppers" (an undercount, never a crash).
  function getOrCreateClientId() {
    try {
      let id = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
      if (!id) {
        id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(CLIENT_ID_STORAGE_KEY, id);
      }
      return id;
    } catch {
      return null;
    }
  }

  const widgetClientId = getOrCreateClientId();
  const isMobileDevice = /Mobi|Android/i.test(navigator.userAgent);

  /**
   * ADVISORY ONLY, client-reported and forgeable — see the comment on
   * POST /v1/dev/widget-event in apps/api/src/modules/dev/routes.ts. Never
   * awaited and its failure is always swallowed: a blocked ad-blocker or a
   * flaky network must never affect the shopper's actual try-on flow.
   */
  function sendWidgetEvent(type) {
    const payload = { type, device: isMobileDevice ? 'mobile' : 'desktop' };
    if (widgetClientId) payload.clientId = widgetClientId;
    if (config.productId) payload.productId = config.productId;
    fetch(`${config.apiBase}/v1/dev/widget-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.widgetKey}` },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }

  let currentImage = config.productImage;
  const button = document.getElementById('aivastra-tryon-button');
  const modal = document.getElementById('aivastra-tryon-modal');
  if (!button || !modal) return;

  // Set once at init on the root element rather than inline on the button:
  // the modal is reparented to <body> below (a sibling of the button, not a
  // descendant), so a custom property set on the button could never cascade
  // into it. :root is the common ancestor of both.
  if (customization.accentColor) {
    document.documentElement.style.setProperty('--aivastra-accent', customization.accentColor);
  }

  // Themes routinely give a section ancestor `transform`, `filter`, or
  // `contain` (sticky headers, gallery/parallax sections), which makes that
  // ancestor the containing block for `position: fixed` — trapping the
  // modal inside its stacking context so the header/product images render
  // on top regardless of z-index. Reparenting to <body> escapes every
  // ancestor's stacking context. Matches the Shopify widget's same fix.
  if (modal.parentNode !== document.body) {
    document.body.appendChild(modal);
  }

  const ICONS = {
    sparkle:
      '<svg class="aivastra-icon-sparkle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>',
    close:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    upload:
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    download:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    refresh:
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    alert:
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>',
    lock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
    history:
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36"/><path d="M3 4v5h5"/><path d="M12 7v5l3 3"/></svg>',
    expand:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>',
    cart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 2-1.58l1.65-7.42H5.12"/></svg>',
    share:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  };

  // One persistent full-screen lightbox, created once and reparented to
  // <body> like the modal — a sibling of it, not nested inside, so it
  // covers the whole viewport instead of being clipped to the modal's box.
  const lightbox = document.createElement('div');
  lightbox.className = 'aivastra-tryon-lightbox';
  lightbox.hidden = true;
  lightbox.innerHTML =
    '<button type="button" class="aivastra-lightbox-close" aria-label="Close">' +
    ICONS.close +
    '</button>' +
    '<img class="aivastra-lightbox-image" alt="Try-on result, full size">';
  document.body.appendChild(lightbox);
  const lightboxImage = lightbox.querySelector('.aivastra-lightbox-image');

  function openLightbox(url) {
    if (!url) return;
    lightboxImage.src = url;
    lightbox.hidden = false;
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImage.src = '';
  }

  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox || event.target.closest('.aivastra-lightbox-close')) {
      closeLightbox();
    }
  });

  // Sizes an image's box to the photo's own aspect ratio instead of a flat
  // default, so a portrait upload doesn't get letterboxed inside a
  // landscape-shaped box and vice versa. Capped both ways so an extreme
  // photo (a wide panorama, an ultra-tall crop) can't collapse the box to
  // nothing or blow out the layout. Matches the Shopify widget's same
  // technique (tryon-widget.js's fitToPhotoAspectRatio).
  function fitToAspectRatio(boxEl, imgEl) {
    if (!boxEl || !imgEl) return;
    const apply = () => {
      const { naturalWidth, naturalHeight } = imgEl;
      if (!naturalWidth || !naturalHeight) return;
      const ratio = Math.min(1.4, Math.max(0.7, naturalHeight / naturalWidth));
      boxEl.style.aspectRatio = `1 / ${ratio}`;
    };
    if (imgEl.complete && imgEl.naturalWidth) apply();
    else imgEl.addEventListener('load', apply, { once: true });
  }

  // The shopper's live variation selection lives in WooCommerce's own
  // variation form (hidden `variation_id` input + `attribute_*` selects),
  // read fresh at click time rather than tracked incrementally — one source
  // of truth, and it's correct even if a theme's variation JS doesn't fire
  // found_variation in a way this file happens to observe.
  function resolveVariationSelection() {
    if (!variationForm) return { variationId: 0, attributes: {} };
    const idInput = variationForm.querySelector('input[name="variation_id"]');
    const variationId = idInput ? Number(idInput.value) || 0 : 0;
    const attributes = {};
    variationForm.querySelectorAll('[name^="attribute_"]').forEach((el) => {
      attributes[el.name] = el.value;
    });
    return { variationId, attributes };
  }

  // Posts to WordPress's own admin-ajax.php (Aivastra_Cart_Ajax), not the
  // Aivastra API — cart state is WooCommerce's, the dev-API has no notion of
  // it. WooCommerce's built-in wc-ajax=add_to_cart endpoint only takes a bare
  // product_id (it's the simple-product loop-button endpoint), so variable
  // products need this dedicated handler instead.
  function addToCart(btn, statusEl) {
    if (!config.ajaxUrl || !config.addToCartNonce) return;
    const { variationId, attributes } = resolveVariationSelection();
    btn.disabled = true;
    if (statusEl) statusEl.hidden = true;

    const form = new FormData();
    form.set('action', 'aivastra_add_to_cart');
    form.set('nonce', config.addToCartNonce);
    form.set('product_id', String(config.productId));
    form.set('variation_id', String(variationId));
    Object.entries(attributes).forEach(([key, value]) => {
      form.set(`attributes[${key}]`, value);
    });

    fetch(config.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: form })
      .then((res) => res.json())
      .then((result) => {
        if (!result.success) {
          if (statusEl) {
            statusEl.textContent = result.data?.message || 'Could not add to cart.';
            statusEl.hidden = false;
          }
          btn.disabled = false;
          return;
        }
        const label = btn.querySelector('span');
        if (label) label.textContent = 'Added to Cart';
        if (statusEl && result.data?.cartUrl) {
          statusEl.innerHTML = `<a href="${result.data.cartUrl}">View cart</a>`;
          statusEl.hidden = false;
        }
      })
      .catch(() => {
        if (statusEl) {
          statusEl.textContent = 'Could not add to cart.';
          statusEl.hidden = false;
        }
        btn.disabled = false;
      });
  }

  // navigator.share is absent on desktop Firefox and older Safari. The
  // payload is a plain result URL either way, so the fallback is a clipboard
  // copy rather than hiding the affordance. Mirrors the Shopify widget's
  // shareResult/flashShare.
  const shareFlashTimers = new WeakMap();
  function flashShare(flashEl, message) {
    if (!flashEl) return;
    flashEl.textContent = message;
    flashEl.hidden = false;
    clearTimeout(shareFlashTimers.get(flashEl));
    shareFlashTimers.set(
      flashEl,
      setTimeout(() => {
        flashEl.hidden = true;
      }, 2000),
    );
  }

  // A plain `<a download href="cross-origin-url">` silently ignores the
  // download attribute for cross-origin URLs (a browser security rule) and
  // just navigates instead — which is exactly what a presigned R2/MinIO
  // result URL always is relative to the storefront's own origin. Fetching
  // the image and downloading it via a blob: URL (same-origin by
  // definition) is the standard workaround.
  function downloadImage(url) {
    fetch(url)
      .then((res) => res.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = 'tryon-result.jpg';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {
        window.open(url, '_blank', 'noopener,noreferrer');
      });
  }

  function shareResult(url, flashEl) {
    if (!url) return;
    if (typeof navigator.share === 'function') {
      navigator.share({ url }).catch(() => {
        /* user cancelled the share sheet — nothing to do */
      });
      return;
    }
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(url).then(
      () => flashShare(flashEl, 'Link copied'),
      () => flashShare(flashEl, 'Copy failed'),
    );
  }

  // Per-browser history of past results, spanning every product tried on
  // this store — same pattern as the Shopify widget's localStorage history.
  // resultUrl is a presigned R2 URL (time-limited), so it goes stale while
  // an entry sits in storage across sessions; resolveHistoryEntry() always
  // re-fetches a fresh one from the job's current state via jobId before
  // rendering, rather than trusting the cached string.
  function getHistory() {
    let raw;
    try {
      raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    } catch (_err) {
      return [];
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  }

  function addToHistory(imageUrl, jobId) {
    const entry = { imageUrl, jobId, createdAt: Date.now() };
    const history = [entry, ...getHistory()];
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch (_err) {
      /* private-browsing / storage-full — history just won't persist */
    }
  }

  function removeHistoryEntry(entry) {
    const remaining = getHistory().filter((h) =>
      entry.jobId ? h.jobId !== entry.jobId : h.imageUrl !== entry.imageUrl,
    );
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(remaining));
    } catch (_err) {
      /* ignore */
    }
  }

  // A null return means the job's result object is genuinely gone (retention
  // deleted it) — the entry is dropped for real rather than left to fail on
  // load. A network failure keeps the cached (possibly stale) entry instead
  // of dropping real history over a transient error.
  function resolveHistoryEntry(entry) {
    if (!entry.jobId) return Promise.resolve(entry);
    return fetch(`${config.apiBase}/v1/dev/jobs/${entry.jobId}`, {
      headers: { Authorization: `Bearer ${config.widgetKey}` },
    })
      .then((res) => res.json().then((body) => ({ status: res.status, body })))
      .then((result) => {
        const classified = window.AivastraWidgetLogic.classifyJobResponse(
          result.status,
          result.body,
        );
        if (classified.state !== 'completed' || !classified.imageUrl) {
          removeHistoryEntry(entry);
          return null;
        }
        return { ...entry, imageUrl: classified.imageUrl };
      })
      .catch(() => entry);
  }

  // Variable products: track the shopper's selected variation image.
  const variationForm = document.querySelector('form.variations_form');
  if (variationForm && window.jQuery) {
    window.jQuery(variationForm).on('found_variation', (_event, variation) => {
      currentImage = window.AivastraWidgetLogic.resolveVariationImage(
        config.productImage,
        variation,
      );
    });
    window.jQuery(variationForm).on('reset_data', () => {
      currentImage = config.productImage;
    });
  }

  // Populated each time renderHistoryGrid() renders, so the delegated click
  // handler below can map a tile's data-history-index back to a real entry
  // without re-encoding image URLs into the DOM.
  let currentHistoryEntries = [];

  // The last photo the shopper submitted, for the lifetime of this page view
  // — a plain in-memory data: URL, so reopening the widget or hitting "Try
  // Another Photo" on the SAME page never needs a network round trip.
  let lastPersonPhotoUrl = null;

  // Cross-page-load reuse: only the storage KEY is persisted (tiny), not the
  // photo itself — the actual bytes stay server-side (already uploaded as
  // part of any tryon job) and get re-signed on demand via
  // /v1/dev/photo/preview. Mirrors the Shopify widget's own reuse mechanism
  // (tryon-widget.js's getRememberedPhoto/rememberPhoto) and its matching
  // 24h server-side window (dev/routes.ts's `dev:person-photo:` Redis key).
  function getRememberedPhotoKey() {
    let raw;
    try {
      raw = localStorage.getItem(REUSE_STORAGE_KEY);
    } catch (_err) {
      return null;
    }
    if (!raw) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_err) {
      return null;
    }
    if (!parsed || typeof parsed.personKey !== 'string' || typeof parsed.uploadedAt !== 'number') {
      return null;
    }
    if (Date.now() - parsed.uploadedAt > REUSE_MAX_AGE_MS) return null;
    return parsed.personKey;
  }

  function rememberPhotoKey(personKey) {
    if (!personKey) return;
    try {
      localStorage.setItem(
        REUSE_STORAGE_KEY,
        JSON.stringify({ personKey, uploadedAt: Date.now() }),
      );
    } catch (_err) {
      /* private-browsing / storage-full — reuse just won't be offered next time */
    }
  }

  function forgetRememberedPhoto() {
    try {
      localStorage.removeItem(REUSE_STORAGE_KEY);
    } catch (_err) {
      /* ignore */
    }
  }

  // Entry point for opening the upload step (button click, "Try Another
  // Photo", "Try Again"): prefers the in-memory photo from this same page
  // view (no network call) over the persisted key from a previous visit,
  // and falls back to an empty dropzone when neither is available or the
  // remembered key has expired/aged out server-side.
  function enterUploadStep() {
    if (lastPersonPhotoUrl) {
      renderUploadStep(lastPersonPhotoUrl);
      return;
    }
    const personKey = getRememberedPhotoKey();
    if (!personKey) {
      renderUploadStep();
      return;
    }
    fetch(`${config.apiBase}/v1/dev/photo/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.widgetKey}`,
      },
      body: JSON.stringify({ personKey }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body || !body.previewUrl) {
          forgetRememberedPhoto();
          renderUploadStep();
          return;
        }
        renderUploadStep(body.previewUrl);
      })
      .catch(() => renderUploadStep());
  }

  // Set right before opening History, from whatever screen is on-screen at
  // that moment — read from the live DOM rather than tracked incrementally,
  // so it reflects e.g. whichever photo the shopper had actually selected,
  // not a stale value captured when that screen first rendered.
  let historyReturnTo = null;
  function captureCurrentScreen() {
    if (modal.querySelector('.aivastra-result-wrapper')) {
      const img = modal.querySelector('.aivastra-result-image');
      return img ? () => renderCompleted(img.src) : null;
    }
    if (modal.querySelector('.aivastra-upload-section')) {
      const previewCard = modal.querySelector('#aivastra-preview-card');
      const previewImg = modal.querySelector('#aivastra-upload-preview');
      const hasPreview = previewCard && !previewCard.hidden && previewImg && previewImg.src;
      return () => renderUploadStep(hasPreview ? previewImg.src : null);
    }
    if (modal.querySelector('.aivastra-error-container')) {
      const desc = modal.querySelector('.aivastra-error-desc');
      return () => renderUnavailable(desc ? desc.textContent : undefined);
    }
    return null;
  }

  function renderModal(options) {
    const {
      badge = 'AI Try-On',
      title = '',
      subtitle = '',
      bodyHtml = '',
      hideHistoryButton = false,
    } = options;
    const historyCount = getHistory().length;
    const showHistoryButton = historyCount > 0 && !hideHistoryButton;
    modal.innerHTML =
      '<div class="aivastra-tryon-modal-content" role="dialog" aria-modal="true">' +
      (showHistoryButton
        ? '<button type="button" class="aivastra-modal-history-btn" data-action="history" aria-label="View try-on history">' +
          ICONS.history +
          `<span class="aivastra-history-badge">${historyCount}</span>` +
          '</button>'
        : '') +
      '<button type="button" class="aivastra-modal-close" data-close aria-label="Close modal">' +
      ICONS.close +
      '</button>' +
      '<div class="aivastra-modal-header">' +
      (badge
        ? `<div class="aivastra-modal-badge">${ICONS.sparkle}<span>${badge}</span></div>`
        : '') +
      (title ? `<h3 class="aivastra-modal-title">${title}</h3>` : '') +
      (subtitle ? `<p class="aivastra-modal-subtitle">${subtitle}</p>` : '') +
      '</div>' +
      bodyHtml +
      '</div>';
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.hidden = true;
    modal.innerHTML = '';
    document.body.style.overflow = '';
  }

  // message overrides the generic copy with a specific reason — used for
  // client-side validation failures (bad file type, oversized photo) and
  // for the friendly, code-specific messages computed in startTryOn/pollJob.
  function renderUnavailable(message) {
    renderModal({
      badge: 'Try-On Status',
      title: 'Temporarily Unavailable',
      subtitle: 'We encountered an issue creating your try-on.',
      bodyHtml:
        '<div class="aivastra-error-container">' +
        '<div class="aivastra-error-icon-wrap">' +
        ICONS.alert +
        '</div>' +
        '<p class="aivastra-error-title">Unable to complete try-on</p>' +
        `<p class="aivastra-error-desc">${message || 'Please ensure your photo clearly shows a standing pose with good lighting and try again.'}</p>` +
        '</div>' +
        '<div class="aivastra-button-stack">' +
        '<button type="button" class="aivastra-primary-btn" data-action="upload">' +
        ICONS.refresh +
        '<span>Try Again</span>' +
        '</button>' +
        '<button type="button" class="aivastra-secondary-btn" data-close>Close</button>' +
        '</div>',
    });
  }

  function renderCompleted(imageUrl) {
    sendWidgetEvent('result_view');
    // false is a deliberate merchant choice (the toggle was unchecked and
    // saved); anything else — including absent, for a merchant who has never
    // opened the appearance form — defaults to shown, matching the Liquid
    // block's `unless cfg.behavior.addToCart == false`.
    const showAddToCart = customization.addToCart !== false;
    const showShare = customization.share !== false;
    const addToCartLabel = customization.addToCartLabel
      ? escapeHtml(customization.addToCartLabel)
      : 'Add to Cart';
    const shareLabel = customization.shareLabel ? escapeHtml(customization.shareLabel) : 'Share';

    renderModal({
      badge: 'Ready',
      title: 'Your Try-On is Ready',
      subtitle: 'Photorealistic AI preview on your model',
      bodyHtml:
        '<div class="aivastra-result-wrapper">' +
        `<img class="aivastra-result-image" src="${imageUrl}" alt="Try-on result">` +
        '<div class="aivastra-result-tag">' +
        ICONS.sparkle +
        '<span>AI Generated</span>' +
        '</div>' +
        '<button type="button" class="aivastra-result-expand" data-action="expand" aria-label="View full size">' +
        ICONS.expand +
        '</button>' +
        '</div>' +
        '<div class="aivastra-button-stack">' +
        (showAddToCart
          ? '<button type="button" class="aivastra-primary-btn" data-action="add-to-cart">' +
            ICONS.cart +
            `<span>${addToCartLabel}</span>` +
            '</button>' +
            '<p class="aivastra-inline-status" data-role="cart-status" hidden></p>'
          : '') +
        '<div class="aivastra-button-row">' +
        '<button type="button" class="aivastra-secondary-btn" data-action="download">' +
        ICONS.download +
        '<span>Download</span>' +
        '</button>' +
        (showShare
          ? '<button type="button" class="aivastra-secondary-btn" data-action="share">' +
            ICONS.share +
            `<span>${shareLabel}</span>` +
            '</button>'
          : '') +
        '</div>' +
        (showShare ? '<p class="aivastra-inline-status" data-role="share-flash" hidden></p>' : '') +
        '<button type="button" class="aivastra-secondary-btn" data-action="upload">' +
        ICONS.refresh +
        '<span>Try Another Photo</span>' +
        '</button>' +
        '</div>',
    });
    const resultImg = modal.querySelector('.aivastra-result-image');
    const resultWrapper = modal.querySelector('.aivastra-result-wrapper');
    fitToAspectRatio(resultWrapper, resultImg);
  }

  // The History button's view: every past result on this browser, newest
  // first. Tapping a tile shows it full-size via the same renderCompleted()
  // step used right after a fresh generation — browsing history shouldn't be
  // a dead end without the same download/try-another actions.
  function renderHistoryGrid() {
    return Promise.all(getHistory().map(resolveHistoryEntry)).then((resolved) => {
      const entries = resolved.filter(Boolean);
      currentHistoryEntries = entries;
      renderModal({
        badge: 'AI Fitting Room',
        title: `History (${entries.length})`,
        subtitle: 'Your previous try-on results on this device.',
        hideHistoryButton: true,
        bodyHtml:
          (entries.length
            ? '<div class="aivastra-history-grid">' +
              entries
                .map(
                  (entry, index) =>
                    `<button type="button" class="aivastra-history-tile" data-history-index="${index}">` +
                    `<img src="${entry.imageUrl}" alt="Previous try-on result" loading="lazy">` +
                    '</button>',
                )
                .join('') +
              '</div>'
            : '<div class="aivastra-history-empty"><p>No try-on history yet.</p></div>') +
          '<div class="aivastra-button-stack">' +
          '<button type="button" class="aivastra-secondary-btn" data-action="back">Back</button>' +
          '</div>',
      });
    });
  }

  // The widget key's rate limit (DEV_WIDGET_KEY_RATE_LIMIT_PER_MIN) is shared
  // store-wide across every shopper and both /tryon and /jobs/:id — a single
  // slow generation, or two shoppers trying garments on at once, can burn
  // through it purely from this 2-second poll loop. A 429 (or a dropped
  // request) here is a transient rate/network blip, not the job failing —
  // the job keeps running server-side regardless — so it gets a longer
  // backoff-and-retry instead of the immediate "unavailable" every other
  // unrecognized response gets. Only gives up after MAX_POLL_RETRIES
  // consecutive misses.
  const MAX_POLL_RETRIES = 10;
  const POLL_RETRY_BACKOFF_MS = 4000;

  function pollJob(jobId, retriesLeft = MAX_POLL_RETRIES) {
    fetch(`${config.apiBase}/v1/dev/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${config.widgetKey}` },
    })
      .then((res) => res.json().then((body) => ({ status: res.status, body })))
      .then((result) => {
        if (result.status === 429) {
          if (retriesLeft <= 0) {
            renderUnavailable(
              "We're experiencing high demand right now. You haven't been charged — please try again in a moment.",
            );
            return;
          }
          setTimeout(() => pollJob(jobId, retriesLeft - 1), POLL_RETRY_BACKOFF_MS);
          return;
        }
        const classified = window.AivastraWidgetLogic.classifyJobResponse(
          result.status,
          result.body,
        );
        if (classified.state === 'queued' || classified.state === 'running') {
          setTimeout(() => {
            pollJob(jobId, MAX_POLL_RETRIES);
          }, 2000);
          return;
        }
        if (classified.state === 'completed') {
          addToHistory(classified.imageUrl, jobId);
          renderCompleted(classified.imageUrl);
          return;
        }
        if (classified.state === 'failed') {
          renderUnavailable(
            "We couldn't generate your try-on and your credits were refunded. Try a clear, front-facing photo with good lighting.",
          );
          return;
        }
        renderUnavailable();
      })
      .catch(() => {
        if (retriesLeft <= 0) {
          renderUnavailable();
          return;
        }
        setTimeout(() => pollJob(jobId, retriesLeft - 1), POLL_RETRY_BACKOFF_MS);
      });
  }

  function startTryOn(personDataUrl) {
    lastPersonPhotoUrl = personDataUrl;
    renderModal({
      badge: 'AI Fitting Room',
      title: 'Creating Your Look',
      subtitle: 'Fitting the garment precisely onto your photo…',
      hideHistoryButton: true,
      bodyHtml:
        '<div class="aivastra-loading-photo" id="aivastra-loading-photo">' +
        '<div class="aivastra-spinner-wrap">' +
        '<div class="aivastra-spinner-ring"></div>' +
        '<div class="aivastra-spinner-pulse"></div>' +
        '</div>' +
        '<p class="aivastra-loading-status">Generating virtual try-on</p>' +
        '<p class="aivastra-loading-sub">This usually takes under 30 seconds</p>' +
        '</div>',
    });

    // Shows the shopper's own uploaded photo, dimmed, behind the spinner —
    // matches the Shopify widget's progress canvas instead of a flat blank
    // card. A detached Image() (never attached to the DOM) is enough to read
    // its natural size for fitToAspectRatio; the visible photo itself is
    // painted via the CSS background set below, not this element.
    const loadingPhoto = modal.querySelector('#aivastra-loading-photo');
    if (loadingPhoto) {
      loadingPhoto.style.setProperty('--aivastra-loading-bg', `url("${personDataUrl}")`);
      const probe = new Image();
      probe.onload = () => fitToAspectRatio(loadingPhoto, probe);
      probe.src = personDataUrl;
    }

    fetch(currentImage)
      .then((r) => r.blob())
      .then((garmentBlob) =>
        fetch(personDataUrl)
          .then((r) => r.blob())
          .then((personBlob) => {
            const form = new FormData();
            form.set('category', config.category || 'general');
            form.set('person', personBlob, 'person.jpg');
            form.set('garment', garmentBlob, 'garment.jpg');
            return fetch(`${config.apiBase}/v1/dev/tryon`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${config.widgetKey}` },
              body: form,
            });
          }),
      )
      .then((res) => res.json().then((body) => ({ status: res.status, body })))
      .then((result) => {
        if (result.status === 202 && result.body.jobId) {
          rememberPhotoKey(result.body.personKey);
          pollJob(result.body.jobId);
          return;
        }
        renderUnavailable(
          window.AivastraWidgetLogic.friendlyErrorMessage(
            result.status,
            result.body?.error?.code,
            result.body?.error?.message,
          ),
        );
      })
      .catch(() => renderUnavailable());
  }

  function renderUploadStep(initialPreviewUrl = null) {
    const hasPreview = Boolean(initialPreviewUrl);
    let selectedDataUrl = initialPreviewUrl;
    const ctaLabel = customization.ctaLabel
      ? escapeHtml(customization.ctaLabel)
      : 'Generate Try-On';

    renderModal({
      badge: 'AI Fitting Room',
      title: customization.heading ? escapeHtml(customization.heading) : 'Virtual Try-On',
      subtitle: customization.subheading
        ? escapeHtml(customization.subheading)
        : 'Upload a full-body photo to see how it looks on you.',
      bodyHtml:
        '<div class="aivastra-upload-section">' +
        `<label class="aivastra-upload-dropzone" id="aivastra-upload-dropzone" ${hasPreview ? 'hidden' : ''}>` +
        '<div class="aivastra-upload-icon-circle">' +
        ICONS.upload +
        '</div>' +
        '<div class="aivastra-upload-prompt">' +
        '<span class="aivastra-upload-main-text">Click to upload photo</span>' +
        '<span class="aivastra-upload-sub-text">Stand facing camera • JPG or PNG</span>' +
        '</div>' +
        '<input type="file" accept="image/*" id="aivastra-tryon-file" class="aivastra-file-input" aria-label="Upload photo">' +
        '</label>' +
        `<div class="aivastra-preview-card" id="aivastra-preview-card" ${hasPreview ? '' : 'hidden'}>` +
        '<div class="aivastra-preview-aspect">' +
        `<img id="aivastra-upload-preview" class="aivastra-preview-img" ${hasPreview ? `src="${initialPreviewUrl}"` : ''} alt="Your photo">` +
        '<label class="aivastra-change-photo-btn" for="aivastra-tryon-file-change">' +
        ICONS.refresh +
        '<span>Change Photo</span>' +
        '<input type="file" accept="image/*" id="aivastra-tryon-file-change" class="aivastra-file-input">' +
        '</label>' +
        '</div>' +
        '</div>' +
        '<p class="aivastra-privacy-notice">' +
        ICONS.lock +
        '<span>Your photo is processed privately and securely.</span>' +
        '</p>' +
        '</div>' +
        '<div class="aivastra-button-stack">' +
        `<button type="button" class="aivastra-primary-btn" id="aivastra-tryon-generate" ${hasPreview ? '' : 'disabled'}>` +
        ICONS.sparkle +
        `<span>${ctaLabel}</span>` +
        '</button>' +
        '</div>',
    });

    function handleFile(file) {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        renderUnavailable('Please choose an image file.');
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        renderUnavailable('That photo is too large. Please choose one under 25MB.');
        return;
      }
      sendWidgetEvent('upload');
      const reader = new FileReader();
      reader.onload = () => {
        selectedDataUrl = reader.result;
        const dropzone = document.getElementById('aivastra-upload-dropzone');
        const previewCard = document.getElementById('aivastra-preview-card');
        const previewAspect = document.querySelector('.aivastra-preview-aspect');
        const previewImg = document.getElementById('aivastra-upload-preview');
        const generateBtn = document.getElementById('aivastra-tryon-generate');

        if (previewImg) previewImg.src = selectedDataUrl;
        if (dropzone) dropzone.hidden = true;
        if (previewCard) previewCard.hidden = false;
        if (generateBtn) generateBtn.disabled = false;
        fitToAspectRatio(previewAspect, previewImg);
        // Focusing the visually-hidden file input (clip-rect technique) to
        // open the native picker makes mobile browsers auto-scroll it into
        // view inside this scrollable panel. That scroll offset survives
        // this in-place DOM update (no full re-render here), leaving the
        // header permanently scrolled out of sight until the shopper
        // manually scrolls back up. Snap back to the top every time.
        const modalContent = modal.querySelector('.aivastra-tryon-modal-content');
        if (modalContent) modalContent.scrollTop = 0;
      };
      reader.readAsDataURL(file);
    }

    const fileInput = document.getElementById('aivastra-tryon-file');
    if (fileInput) {
      fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));
    }

    const changeFileInput = document.getElementById('aivastra-tryon-file-change');
    if (changeFileInput) {
      changeFileInput.addEventListener('change', () => handleFile(changeFileInput.files?.[0]));
    }

    const generateBtn = document.getElementById('aivastra-tryon-generate');
    if (generateBtn) {
      generateBtn.addEventListener('click', () => {
        if (!selectedDataUrl) return;
        startTryOn(selectedDataUrl);
      });
    }
  }

  button.addEventListener('click', () => {
    sendWidgetEvent('button_click');
    enterUploadStep();
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
      return;
    }
    if (event.target.closest('[data-close]')) {
      closeModal();
      return;
    }
    if (event.target.closest('[data-action="upload"]')) {
      enterUploadStep();
      return;
    }
    if (event.target.closest('[data-action="history"]')) {
      historyReturnTo = captureCurrentScreen();
      renderHistoryGrid();
      return;
    }
    if (event.target.closest('[data-action="back"]')) {
      if (historyReturnTo) historyReturnTo();
      else closeModal();
      return;
    }
    if (event.target.closest('[data-action="expand"]')) {
      const resultImg = modal.querySelector('.aivastra-result-image');
      if (resultImg) openLightbox(resultImg.src);
      return;
    }
    if (event.target.closest('[data-action="add-to-cart"]')) {
      sendWidgetEvent('add_to_cart');
      addToCart(
        event.target.closest('[data-action="add-to-cart"]'),
        modal.querySelector('[data-role="cart-status"]'),
      );
      return;
    }
    if (event.target.closest('[data-action="download"]')) {
      const resultImg = modal.querySelector('.aivastra-result-image');
      if (resultImg) downloadImage(resultImg.src);
      return;
    }
    if (event.target.closest('[data-action="share"]')) {
      sendWidgetEvent('share');
      const resultImg = modal.querySelector('.aivastra-result-image');
      if (resultImg) shareResult(resultImg.src, modal.querySelector('[data-role="share-flash"]'));
      return;
    }
    const tile = event.target.closest('.aivastra-history-tile');
    if (tile) {
      const entry = currentHistoryEntries[Number(tile.dataset.historyIndex)];
      if (entry) renderCompleted(entry.imageUrl);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!lightbox.hidden) {
        closeLightbox();
      } else if (!modal.hidden) {
        closeModal();
      }
    }
  });
})();
