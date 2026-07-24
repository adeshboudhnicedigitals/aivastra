(() => {
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const SSE_MAX_WAIT_MS = 6 * 60 * 1000;
  const SSE_RECONNECT_DELAY_MS = 1000;

  function initWidget(root) {
    const widgetKey = root.dataset.widgetKey;
    const productId = Number(root.dataset.productId);
    const productTitle = root.dataset.productTitle || '';
    const productUrl = root.dataset.productUrl || '';
    const productImage = root.dataset.productImage || '';
    const apiBase = root.dataset.apiBase.replace(/\/$/, '');

    const button = root.querySelector('.aivastra-tryon__button');
    const modal = root.querySelector('.aivastra-tryon__modal');
    const closeBtn = root.querySelector('.aivastra-tryon__close');
    const resetBtn = root.querySelector('.aivastra-tryon__reset');
    const fileInput = root.querySelector('.aivastra-tryon__file-input');
    const avatarImage = root.querySelector('.aivastra-tryon__avatar-image');
    const steps = {
      upload: root.querySelector('.aivastra-tryon__step--upload'),
      ready: root.querySelector('.aivastra-tryon__step--ready'),
      progress: root.querySelector('.aivastra-tryon__step--progress'),
      pending: root.querySelector('.aivastra-tryon__step--pending'),
      result: root.querySelector('.aivastra-tryon__step--result'),
      error: root.querySelector('.aivastra-tryon__step--error'),
    };
    const resultImage = root.querySelector('.aivastra-tryon__result-image');
    const readyImage = root.querySelector('.aivastra-tryon__ready-image');
    const changePhotoBtn = root.querySelector('.aivastra-tryon__change-photo');
    const ctaBtn = root.querySelector('.aivastra-tryon__cta');

    if (avatarImage && productImage) {
      avatarImage.src = productImage;
      avatarImage.hidden = false;
    }

    const pages = {
      main: root.querySelector('.aivastra-tryon__page--main'),
      history: root.querySelector('.aivastra-tryon__page--history'),
    };
    const headerMain = root.querySelector('.aivastra-tryon__header-main');
    const headerHistory = root.querySelector('.aivastra-tryon__header-history');
    const historyBtn = root.querySelector('.aivastra-tryon__history-btn');
    const historyBackBtn = root.querySelector('.aivastra-tryon__history-back');
    const historyBadge = root.querySelector('.aivastra-tryon__history-badge');
    const historyList = root.querySelector('.aivastra-tryon__history-list');
    const historyEmpty = root.querySelector('.aivastra-tryon__history-empty');
    const HISTORY_STORAGE_KEY = 'aivastra_tryon_history';
    const HISTORY_MAX_ITEMS = 12;

    // Photo picked (new upload or "use this photo" reuse) but generation not
    // yet confirmed — set by showReady(), consumed and cleared once the CTA
    // is clicked. Exactly one of the two is set at a time.
    let pendingFile = null;
    let pendingReuseKey = null;

    const reusePanel = root.querySelector('.aivastra-tryon__reuse-panel');
    const reuseThumb = root.querySelector('.aivastra-tryon__reuse-thumb');
    const reuseUseBtn = root.querySelector('.aivastra-tryon__reuse-use');
    const reuseRemoveBtn = root.querySelector('.aivastra-tryon__reuse-remove');
    const reuseExpiredNote = root.querySelector('.aivastra-tryon__reuse-expired-note');
    const uploadLabelText = root.querySelector('.aivastra-tryon__upload-label-text');
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

    function hideReusePanel() {
      if (reusePanel) reusePanel.hidden = true;
      if (uploadLabelText) uploadLabelText.textContent = 'Drag and drop photo, or choose file';
    }

    let lastReusePreviewUrl = null;

    function showReusePanel(previewUrl) {
      if (!reusePanel || !reuseThumb) return;
      reuseThumb.src = previewUrl;
      lastReusePreviewUrl = previewUrl;
      reusePanel.hidden = false;
      if (uploadLabelText) uploadLabelText.textContent = 'Or upload a new photo';
    }

    function forgetPhoto() {
      try {
        localStorage.removeItem(REUSE_STORAGE_KEY);
      } catch (_err) {
        /* ignore */
      }
      hideReusePanel();
    }

    async function tryShowReusePanel() {
      const remembered = getRememberedPhoto();
      if (!remembered) {
        hideReusePanel();
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
          return;
        }
        const body = await res.json();
        showReusePanel(body.previewUrl);
      } catch (_err) {
        hideReusePanel();
      }
    }

    function showStep(name) {
      for (const key in steps) {
        if (steps[key]) steps[key].hidden = key !== name;
      }
    }

    function showPage(name) {
      for (const key in pages) {
        if (pages[key]) pages[key].hidden = key !== name;
      }
      const onHistory = name === 'history';
      if (headerMain) headerMain.hidden = onHistory;
      if (headerHistory) headerHistory.hidden = !onHistory;
      if (historyBtn) historyBtn.hidden = onHistory || getHistory().length === 0;
      if (resetBtn) resetBtn.hidden = onHistory;
      if (onHistory) renderHistoryList();
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

    function formatHistoryDate(timestamp) {
      try {
        return new Date(timestamp).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
      } catch (_err) {
        return '';
      }
    }

    function renderHistoryList() {
      const history = getHistory();
      updateHistoryBadge(history.length);
      if (!historyList) return;
      historyList.innerHTML = '';
      if (historyEmpty) historyEmpty.hidden = history.length > 0;
      for (let i = 0; i < history.length; i++) {
        const entry = history[i];
        const card = document.createElement('div');
        card.className = 'aivastra-tryon__history-card';

        const media = document.createElement('button');
        media.type = 'button';
        media.className = 'aivastra-tryon__history-media';
        const img = document.createElement('img');
        img.src = entry.resultUrl;
        img.alt = '';
        media.appendChild(img);
        media.addEventListener('click', () => {
          resultImage.src = entry.resultUrl;
          showStep('result');
          showPage('main');
        });
        card.appendChild(media);

        const meta = document.createElement('div');
        meta.className = 'aivastra-tryon__history-meta';
        const title = document.createElement('strong');
        title.textContent = entry.productTitle || 'Try-on';
        meta.appendChild(title);
        const date = document.createElement('span');
        date.textContent = formatHistoryDate(entry.createdAt);
        meta.appendChild(date);
        card.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'aivastra-tryon__history-actions';
        if (entry.productUrl) {
          const cartLink = document.createElement('a');
          cartLink.className = 'aivastra-tryon__history-cart';
          cartLink.href = entry.productUrl;
          cartLink.textContent = 'View Product';
          actions.appendChild(cartLink);
        }
        if (typeof navigator.share === 'function') {
          const shareBtn = document.createElement('button');
          shareBtn.type = 'button';
          shareBtn.className = 'aivastra-tryon__history-share';
          shareBtn.setAttribute('aria-label', 'Share');
          shareBtn.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.2"/><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="19" r="2.2"/><path d="m8 11 7.8-4.6M8 13l7.8 4.6"/></svg>';
          shareBtn.addEventListener('click', () => {
            navigator.share({ url: entry.resultUrl }).catch(() => {
              /* user cancelled the share sheet — nothing to do */
            });
          });
          actions.appendChild(shareBtn);
        }
        if (actions.childNodes.length > 0) card.appendChild(actions);

        historyList.appendChild(card);
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
    // exactly one of file/reuseKey is passed by the two callers.
    function showReady({ file, reuseKey, previewUrl }) {
      resetReadyPreview();
      pendingFile = file || null;
      pendingReuseKey = reuseKey || null;
      if (readyImage) {
        readyImage.src = file ? URL.createObjectURL(file) : previewUrl || '';
      }
      showStep('ready');
    }

    function startOver() {
      showStep('upload');
      fileInput.value = '';
      resetReadyPreview();
      if (reuseExpiredNote) reuseExpiredNote.hidden = true;
      tryShowReusePanel();
    }

    function openModal() {
      modal.hidden = false;
      showPage('main');
      startOver();
    }

    function closeModal() {
      modal.hidden = true;
    }

    async function uploadPhoto(file) {
      const presignRes = await fetch(`${apiBase}/v1/shopify/customer/presign`, {
        method: 'POST',
        headers: { 'x-widget-key': widgetKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
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
        body: JSON.stringify({ shopifyProductId: productId, customerPhotoKey: customerPhotoKey }),
      });
      if (res.status === 402) {
        showPage('main');
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
      if (res.status === 202) return { pending: true };
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
          showPage('main');
          showStep('pending');
          return;
        }
        const resultUrl = await waitForResult(jobResult.jobId);
        resultImage.src = resultUrl;
        showPage('main');
        showStep('result');
        addToHistory(resultUrl);
      } catch (err) {
        if (isReuse && err && err.expiredReuse) {
          forgetPhoto();
          showPage('main');
          showStep('upload');
          if (reuseExpiredNote) reuseExpiredNote.hidden = false;
          return;
        }
        showPage('main');
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
          showPage('main');
          showStep('error');
        }
      } else if (reuseKey) {
        showStep('progress');
        await proceedWithPhoto(reuseKey, true);
      }
    }

    button.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    if (resetBtn) resetBtn.addEventListener('click', startOver);
    if (ctaBtn) ctaBtn.addEventListener('click', confirmReady);
    if (changePhotoBtn) changePhotoBtn.addEventListener('click', () => fileInput.click());
    if (historyBtn) historyBtn.addEventListener('click', () => showPage('history'));
    if (historyBackBtn) historyBackBtn.addEventListener('click', () => showPage('main'));
    updateHistoryBadge(getHistory().length);
    if (reuseUseBtn) {
      reuseUseBtn.addEventListener('click', () => {
        const remembered = getRememberedPhoto();
        if (!remembered) {
          hideReusePanel();
          return;
        }
        showReady({ reuseKey: remembered.r2Key, previewUrl: lastReusePreviewUrl });
      });
    }
    if (reuseRemoveBtn) {
      reuseRemoveBtn.addEventListener('click', forgetPhoto);
    }
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

  function placeWidget(root) {
    const selector = root.dataset.placementSelector;
    if (!selector) return;
    const target = document.querySelector(selector);
    if (!target) return;
    if (root.dataset.blockAlignment === 'end') {
      target.appendChild(root);
    } else {
      target.insertBefore(root, target.firstChild);
    }
  }

  const widgets = document.querySelectorAll('.aivastra-tryon');
  for (let i = 0; i < widgets.length; i++) {
    placeWidget(widgets[i]);
    initWidget(widgets[i]);
  }
})();
