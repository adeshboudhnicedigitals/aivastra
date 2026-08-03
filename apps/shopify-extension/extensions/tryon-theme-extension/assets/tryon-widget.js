(() => {
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const SSE_MAX_WAIT_MS = 6 * 60 * 1000;
  const SSE_RECONNECT_DELAY_MS = 1000;

  function initWidget(root) {
    if (root.dataset.aivastraInitialized === 'true') return;
    root.dataset.aivastraInitialized = 'true';

    const widgetKey = root.dataset.widgetKey;
    const productId = Number(root.dataset.productId);
    const productTitle = root.dataset.productTitle || '';
    const productUrl = root.dataset.productUrl || '';
    const productImage = root.dataset.productImage || '';
    const apiBase = root.dataset.apiBase.replace(/\/$/, '');

    const button = root.querySelector('.aivastra-tryon__button');
    const modal = root.querySelector('.aivastra-tryon__modal');
    const closeBtn = root.querySelector('.aivastra-tryon__close');
    const fileInput = root.querySelector('.aivastra-tryon__file-input');
    const avatarImage = root.querySelector('.aivastra-tryon__avatar-image');
    const steps = {
      upload: root.querySelector('.aivastra-tryon__step--upload'),
      ready: root.querySelector('.aivastra-tryon__step--ready'),
      progress: root.querySelector('.aivastra-tryon__step--progress'),
      pending: root.querySelector('.aivastra-tryon__step--pending'),
      result: root.querySelector('.aivastra-tryon__step--result'),
      error: root.querySelector('.aivastra-tryon__step--error'),
      email: root.querySelector('.aivastra-tryon__step--email'),
    };
    const resultList = root.querySelector('.aivastra-tryon__result-list');
    const resultEmpty = root.querySelector('.aivastra-tryon__result-empty');
    const resultCardTemplate = root.querySelector('.aivastra-tryon__result-card-template');
    const readyImage = root.querySelector('.aivastra-tryon__ready-image');
    const changePhotoBtn = root.querySelector('.aivastra-tryon__change-photo');
    const ctaBtn = root.querySelector('.aivastra-tryon__cta');

    const emailInput = root.querySelector('.aivastra-tryon__email-input');
    const emailConsentInput = root.querySelector('.aivastra-tryon__email-consent-input');
    const emailSubmit = root.querySelector('.aivastra-tryon__email-submit');
    const emailError = root.querySelector('.aivastra-tryon__email-error');
    let awaitingEmailForPhotoKey = null;

    if (avatarImage && productImage) {
      avatarImage.src = productImage;
      avatarImage.hidden = false;
    }

    const historyBtn = root.querySelector('.aivastra-tryon__history-btn');
    const historyBadge = root.querySelector('.aivastra-tryon__history-badge');
    const HISTORY_STORAGE_KEY = 'aivastra_tryon_history';
    const HISTORY_MAX_ITEMS = 12;

    const CLIENT_ID_STORAGE_KEY = 'aivastra_client_id';

    // One anonymous id per browser, minted once. This is a UX limiter, not a
    // security control: incognito, cleared storage, or a script all defeat it.
    // The store daily cap is what actually holds — see the design doc.
    function getClientId() {
      try {
        let id = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
        if (!id) {
          id = crypto.randomUUID();
          localStorage.setItem(CLIENT_ID_STORAGE_KEY, id);
        }
        return id;
      } catch (_err) {
        // Storage blocked (Safari private mode, etc.) — a per-call id still
        // lets the server create a row; it just won't persist across reloads.
        return crypto.randomUUID();
      }
    }

    const clientId = getClientId();

    // Coarse and honest: a width test, not device detection. Labeled as an
    // estimate in the merchant UI rather than presented as fact.
    const device = window.innerWidth < 768 ? 'mobile' : 'desktop';

    // Fire-and-forget. Analytics must never break a try-on, so every failure
    // path here is silent: a rejected promise, a thrown TypeError from a
    // missing API, an ad blocker eating the request — all identical to success
    // from the shopper's point of view.
    //
    // keepalive matters for add_to_cart specifically: the shopper may navigate
    // to /cart before the request settles, and without it the browser cancels
    // the very event that measures conversion.
    function trackEvent(type) {
      try {
        fetch(`${apiBase}/v1/shopify/customer/event`, {
          method: 'POST',
          headers: { 'x-widget-key': widgetKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            clientId: clientId || undefined,
            shopifyProductId: productId || undefined,
            device,
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* analytics must never break a try-on */
      }
    }

    const shopifyCustomerId = root.dataset.customerId ? Number(root.dataset.customerId) : undefined;
    // Prefill only. The server never trusts this for authorization.
    let shopperEmail = root.dataset.customerEmail || null;
    let shopperEmailConsent = false;
    // Whether the shopper actually submitted the email-gate step, as opposed to
    // us merely knowing their address because Liquid rendered it for a
    // logged-in customer. Only a true value permits sending the address to the
    // server: a prefilled value is a convenience, not an act of consent, and
    // the merchant's "Collected emails" list is supposed to contain only
    // addresses a shopper deliberately handed over.
    let emailConfirmedByShopper = false;

    if (emailInput && shopperEmail) emailInput.value = shopperEmail;

    if (emailSubmit) {
      emailSubmit.addEventListener('click', () => {
        const value = (emailInput && emailInput.value ? emailInput.value : '').trim();
        // Cheap client-side shape check only; the server's Zod schema is the
        // real validation.
        if (!value || value.indexOf('@') < 1) {
          if (emailError) {
            emailError.textContent = 'Enter a valid email address.';
            emailError.hidden = false;
          }
          return;
        }
        if (emailError) emailError.hidden = true;
        shopperEmail = value;
        shopperEmailConsent = !!(emailConsentInput && emailConsentInput.checked);
        // This click is the affirmative action. Until it happens, createJob
        // sends no email at all, even for a logged-in customer whose address
        // was prefilled into the input above.
        emailConfirmedByShopper = true;
        const key = awaitingEmailForPhotoKey;
        awaitingEmailForPhotoKey = null;
        if (key) {
          showStep('progress');
          proceedWithPhoto(key, false);
        }
      });
    }

    // Photo picked (new upload or "use this photo" reuse) but generation not
    // yet confirmed — set by showReady(), consumed and cleared once the CTA
    // is clicked. Exactly one of the two is set at a time.
    let pendingFile = null;
    let pendingReuseKey = null;

    const reuseExpiredNote = root.querySelector('.aivastra-tryon__reuse-expired-note');
    const REUSE_STORAGE_KEY = 'aivastra_last_photo';
    const REUSE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

    function getRememberedPhoto() {
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
      if (!parsed || typeof parsed.r2Key !== 'string' || typeof parsed.uploadedAt !== 'number') {
        return null;
      }
      if (Date.now() - parsed.uploadedAt > REUSE_MAX_AGE_MS) return null;
      return { r2Key: parsed.r2Key };
    }

    function rememberPhoto(r2Key) {
      try {
        localStorage.setItem(REUSE_STORAGE_KEY, JSON.stringify({ r2Key, uploadedAt: Date.now() }));
      } catch (_err) {
        /* private-browsing / storage-full — reuse just won't be offered next time */
      }
    }

    function forgetPhoto() {
      try {
        localStorage.removeItem(REUSE_STORAGE_KEY);
      } catch (_err) {
        /* ignore */
      }
    }

    // Entry point for the main flow (modal open, "Try another pose", "Try
    // again"): a returning shopper with a remembered photo goes straight to
    // the ready screen with it pre-loaded (design frame 3) instead of
    // revisiting the upload step. No remembered photo (or it's expired /
    // no longer owned) falls back to a fresh upload.
    async function enterMainFlow() {
      const remembered = getRememberedPhoto();
      if (!remembered) {
        showStep('upload');
        return;
      }
      try {
        const res = await fetch(`${apiBase}/v1/shopify/customer/photo/preview`, {
          method: 'POST',
          headers: { 'x-widget-key': widgetKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ r2Key: remembered.r2Key }),
        });
        if (!res.ok) {
          forgetPhoto();
          showStep('upload');
          return;
        }
        const body = await res.json();
        showReady({ reuseKey: remembered.r2Key, previewUrl: body.previewUrl });
      } catch (_err) {
        showStep('upload');
      }
    }

    function showStep(name) {
      for (const key in steps) {
        if (steps[key]) steps[key].hidden = key !== name;
      }
    }

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

    function updateHistoryBadge(count) {
      if (historyBtn) historyBtn.hidden = count === 0;
      if (!historyBadge) return;
      historyBadge.hidden = count === 0;
      historyBadge.textContent = String(count);
    }

    // Fires each time a job completes — resultUrl is a stable public R2 URL
    // (not presigned), so it's safe to keep around indefinitely in
    // localStorage. History is per-browser and spans every product tried on
    // this store, same pattern as the "reuse last photo" feature: no
    // server-side concept of a widget shopper's identity exists to key a
    // real history endpoint off of.
    function addToHistory(resultUrl) {
      const entry = {
        resultUrl,
        createdAt: Date.now(),
        productTitle,
        productUrl,
      };
      const history = [entry, ...getHistory()].slice(0, HISTORY_MAX_ITEMS);
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
      } catch (_err) {
        /* private-browsing / storage-full — history just won't persist */
      }
      updateHistoryBadge(history.length);
    }

    // navigator.share is absent on desktop Firefox and older Safari. The
    // payload is a plain public URL either way, so the fallback is a clipboard
    // copy rather than hiding the affordance — a share button that vanishes on
    // some browsers leaves the result actions visibly lopsided.
    function shareResult(url, flashEl) {
      trackEvent('share');
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

    // The shopper's live variant selection lives in the theme's own product
    // form, which every Shopify product page has. data-default-variant-id is
    // the Liquid-rendered fallback for themes that render the form lazily.
    function resolveVariantId() {
      const input = document.querySelector('form[action*="/cart/add"] [name="id"]');
      const fromForm = input ? Number(input.value) : 0;
      if (fromForm) return fromForm;
      const fallback = addToCartBtn ? Number(addToCartBtn.dataset.defaultVariantId) : 0;
      return fallback || null;
    }

    let shareFlashTimer = null;
    function flashShare(flashEl, message) {
      if (!flashEl) return;
      flashEl.textContent = message;
      flashEl.hidden = false;
      clearTimeout(shareFlashTimer);
      shareFlashTimer = setTimeout(() => {
        flashEl.hidden = true;
      }, 2000);
    }

    async function addVariantToCart(btn, errorEl, viewCartEl) {
      const variantId = resolveVariantId();
      if (!variantId) return;

      btn.disabled = true;
      if (errorEl) errorEl.hidden = true;

      try {
        const res = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] }),
        });

        if (!res.ok) {
          // Sold-out and every other refusal comes back as a 422 with a human
          // message. Showing Shopify's own string beats tracking variant
          // availability client-side across each theme's selector JS.
          const body = await res.json().catch(() => ({}));
          if (errorEl) {
            errorEl.textContent = body.description || 'Could not add to cart.';
            errorEl.hidden = false;
          }
          btn.disabled = false;
          return;
        }

        btn.textContent = 'Added ✓';
        trackEvent('add_to_cart');
        if (viewCartEl) viewCartEl.hidden = false;
        // Themes that listen refresh their cart badge; the rest ignore an
        // unknown event. Cheaper and safer than detecting each theme's drawer.
        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
      } catch {
        if (errorEl) {
          errorEl.textContent = 'Could not add to cart.';
          errorEl.hidden = false;
        }
        btn.disabled = false;
      }
    }

    // One full-size card per stored result — the just-generated one lands on
    // top because addToHistory() unshifts it. Every card is a fresh clone of
    // the Liquid <template>, so each has its own Add to Cart / Share state;
    // nothing needs resetting between renders.
    function buildResultCard(entry) {
      const fragment = resultCardTemplate.content.cloneNode(true);
      const card = fragment.querySelector('.aivastra-tryon__result-card');

      const img = card.querySelector('.aivastra-tryon__result-image');
      img.src = entry.resultUrl;
      // Retention may have deleted this result since it was cached locally. A
      // broken image is worse than a missing card, so drop the entry and
      // rewrite the stored history.
      img.addEventListener('error', () => {
        const remaining = getHistory().filter((h) => h.resultUrl !== entry.resultUrl);
        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(remaining));
        } catch (_err) {
          // Storage blocked — the entry reappears next load; harmless.
        }
        renderResultList();
      });

      const addToCartBtn = card.querySelector('.aivastra-tryon__add-to-cart');
      const cartError = card.querySelector('.aivastra-tryon__cart-error');
      const viewCartLink = card.querySelector('.aivastra-tryon__view-cart');
      if (addToCartBtn) {
        addToCartBtn.addEventListener('click', () =>
          addVariantToCart(addToCartBtn, cartError, viewCartLink),
        );
      }

      const shareBtn = card.querySelector('.aivastra-tryon__share');
      const shareFlash = card.querySelector('.aivastra-tryon__share-flash');
      if (shareBtn) {
        shareBtn.addEventListener('click', () => shareResult(entry.resultUrl, shareFlash));
      }

      return card;
    }

    function renderResultList() {
      const history = getHistory();
      updateHistoryBadge(history.length);
      if (!resultList) return;
      resultList.innerHTML = '';
      if (resultEmpty) resultEmpty.hidden = history.length > 0;
      for (let i = 0; i < history.length; i++) {
        resultList.appendChild(buildResultCard(history[i]));
      }
    }

    function resetReadyPreview() {
      if (readyImage) {
        if (readyImage.src) URL.revokeObjectURL(readyImage.src);
        readyImage.src = '';
      }
      pendingFile = null;
      pendingReuseKey = null;
    }

    // Shows the picked photo (new upload or reused) full-size with an
    // explicit "Try It On Now" CTA, instead of generating immediately —
    // exactly one of file/reuseKey is passed by the two callers. This is the
    // single convergence point for both a freshly-picked file
    // (handlePickedFile) and a remembered reuse photo (enterMainFlow), so the
    // 'upload' funnel event fires here rather than in either caller — firing
    // it in handlePickedFile alone under-counts returning shoppers who never
    // touch the file input.
    function showReady({ file, reuseKey, previewUrl }) {
      resetReadyPreview();
      pendingFile = file || null;
      pendingReuseKey = reuseKey || null;
      if (readyImage) {
        readyImage.src = file ? URL.createObjectURL(file) : previewUrl || '';
      }
      trackEvent('upload');
      showStep('ready');
    }

    function startOver() {
      fileInput.value = '';
      resetReadyPreview();
      if (reuseExpiredNote) reuseExpiredNote.hidden = true;
      enterMainFlow();
    }

    function openModal() {
      trackEvent('button_click');
      modal.hidden = false;
      startOver();
    }

    function closeModal() {
      modal.hidden = true;
    }

    async function uploadPhoto(file) {
      const presignRes = await fetch(`${apiBase}/v1/shopify/customer/presign`, {
        method: 'POST',
        headers: { 'x-widget-key': widgetKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, contentLength: file.size, clientId }),
      });
      if (!presignRes.ok) throw new Error('presign failed');
      const body = await presignRes.json();
      const uploadUrl = body.uploadUrl;
      const r2Key = body.r2Key;

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error('upload failed');
      return r2Key;
    }

    async function createJob(customerPhotoKey) {
      const res = await fetch(`${apiBase}/v1/shopify/customer/jobs`, {
        method: 'POST',
        headers: {
          'x-widget-key': widgetKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shopifyProductId: productId,
          customerPhotoKey: customerPhotoKey,
          clientId,
          ...(shopifyCustomerId ? { shopifyCustomerId } : {}),
          // Gated on the shopper having submitted the email step, not merely on
          // having an address: `shopperEmail` is prefilled from Liquid for any
          // logged-in customer, so keying off it captured their address on the
          // very first try-on without ever showing them the consent checkbox.
          ...(emailConfirmedByShopper && shopperEmail
            ? { email: shopperEmail, emailConsent: shopperEmailConsent }
            : {}),
        }),
      });
      if (res.status === 402) {
        showStep('error');
        const errorStep = steps.error;
        if (errorStep) {
          errorStep.querySelector('p').textContent =
            'Try-on is temporarily unavailable, please check back later.';
        }
        throw new Error('try-on unavailable');
      }
      if (res.status === 403) {
        const err = new Error('upload session expired or not owned');
        err.expiredReuse = true;
        throw err;
      }
      if (res.status === 202) {
        const body = await res.json().catch(() => ({}));
        return { pending: true, reason: body.reason, message: body.message };
      }
      if (!res.ok) throw new Error(`job create failed: ${res.status}`);
      const body = await res.json();
      return { pending: false, jobId: body.jobId };
    }

    async function fetchJobStatus(jobId) {
      const res = await fetch(`${apiBase}/v1/shopify/customer/jobs/${jobId}`, {
        headers: { 'x-widget-key': widgetKey },
      });
      if (!res.ok) throw new Error(`job fetch failed: ${res.status}`);
      return res.json();
    }

    async function waitForResult(jobId) {
      const deadline = Date.now() + SSE_MAX_WAIT_MS;

      while (Date.now() < deadline) {
        const controller = new AbortController();
        const timer = setTimeout(
          () => {
            controller.abort();
          },
          Math.max(deadline - Date.now(), 0),
        );
        let terminal = null;

        try {
          const res = await fetch(`${apiBase}/v1/shopify/customer/jobs/${jobId}/events`, {
            headers: { 'x-widget-key': widgetKey },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`sse failed: ${res.status}`);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          while (!terminal) {
            const readResult = await reader.read();
            if (readResult.done) break;
            buf += decoder.decode(readResult.value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() || '';
            for (let i = 0; i < parts.length; i++) {
              let dataLine = '';
              const lines = parts[i].split('\n');
              for (let j = 0; j < lines.length; j++) {
                if (lines[j].indexOf('data:') === 0) dataLine = lines[j].slice(5).trim();
              }
              if (!dataLine) continue;
              try {
                const evt = JSON.parse(dataLine);
                if (evt.status === 'COMPLETED' || evt.status === 'FAILED') {
                  terminal = evt;
                  break;
                }
              } catch (_e) {
                /* ignore malformed event */
              }
            }
          }
          reader.cancel().catch(() => {});
        } catch (_err) {
          if (controller.signal.aborted) throw new Error('sse timed out');
        } finally {
          clearTimeout(timer);
        }

        if (terminal) {
          if (terminal.status === 'FAILED') throw new Error(terminal.errorCode || 'job failed');
          const terminalBody = await fetchJobStatus(jobId);
          return terminalBody.resultUrl;
        }

        const body = await fetchJobStatus(jobId);
        if (body.status === 'COMPLETED') return body.resultUrl;
        if (body.status === 'FAILED') throw new Error('job failed');

        await new Promise((resolve) => {
          setTimeout(resolve, SSE_RECONNECT_DELAY_MS);
        });
      }
      throw new Error('sse timed out');
    }

    async function proceedWithPhoto(customerPhotoKey, isReuse) {
      try {
        rememberPhoto(customerPhotoKey);
        const jobResult = await createJob(customerPhotoKey);
        if (jobResult.pending) {
          if (jobResult.reason === 'email_required') {
            // Hold the photo key: the retry reuses the same upload (its Redis
            // ownership record lives 600s), so nothing is re-uploaded.
            awaitingEmailForPhotoKey = customerPhotoKey;
            showStep('email');
            return;
          }
          if (jobResult.message) {
            const pendingStep = steps.pending;
            if (pendingStep) pendingStep.querySelector('p').textContent = jobResult.message;
          }
          showStep('pending');
          return;
        }
        const resultUrl = await waitForResult(jobResult.jobId);
        addToHistory(resultUrl);
        renderResultList();
        showStep('result');
        trackEvent('result_view');
      } catch (err) {
        if (isReuse && err && err.expiredReuse) {
          forgetPhoto();
          showStep('upload');
          if (reuseExpiredNote) reuseExpiredNote.hidden = false;
          return;
        }
        showStep('error');
      }
    }

    // Fires from the "Try It On Now" CTA on the ready step — the photo was
    // already picked (new upload or reuse) and is just waiting for the
    // shopper to confirm before spending a generation.
    async function confirmReady() {
      const file = pendingFile;
      const reuseKey = pendingReuseKey;
      pendingFile = null;
      pendingReuseKey = null;
      if (file) {
        showStep('progress');
        try {
          const customerPhotoKey = await uploadPhoto(file);
          await proceedWithPhoto(customerPhotoKey, false);
        } catch (_err) {
          showStep('error');
        }
      } else if (reuseKey) {
        showStep('progress');
        await proceedWithPhoto(reuseKey, true);
      }
    }

    button.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    if (ctaBtn) ctaBtn.addEventListener('click', confirmReady);
    if (changePhotoBtn) changePhotoBtn.addEventListener('click', () => fileInput.click());
    if (historyBtn) {
      historyBtn.addEventListener('click', () => {
        renderResultList();
        showStep('result');
      });
    }
    updateHistoryBadge(getHistory().length);
    function handlePickedFile(input) {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/') || file.size > MAX_PHOTO_BYTES) {
        showStep('error');
        return;
      }
      showReady({ file });
    }
    fileInput.addEventListener('change', () => handlePickedFile(fileInput));
    const retryBtns = root.querySelectorAll('.aivastra-tryon__retry');
    for (let k = 0; k < retryBtns.length; k++) {
      retryBtns[k].addEventListener('click', startOver);
    }
  }

  // No placement step: the merchant positioned this block in the theme editor,
  // so it already renders where it belongs.
  const widgets = document.querySelectorAll('.aivastra-tryon');
  for (let i = 0; i < widgets.length; i++) {
    initWidget(widgets[i]);
  }
})();
