(() => {
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const SSE_MAX_WAIT_MS = 6 * 60 * 1000;
  const SSE_RECONNECT_DELAY_MS = 1000;

  function initWidget(root) {
    const widgetKey = root.dataset.widgetKey;
    const productId = Number(root.dataset.productId);
    const apiBase = root.dataset.apiBase.replace(/\/$/, '');

    const button = root.querySelector('.aivastra-tryon__button');
    const modal = root.querySelector('.aivastra-tryon__modal');
    const closeBtn = root.querySelector('.aivastra-tryon__close');
    const fileInput = root.querySelector('.aivastra-tryon__file-input');
    const uploadPreview = root.querySelector('.aivastra-tryon__upload-preview');
    const uploadPlaceholder = root.querySelector('.aivastra-tryon__upload-placeholder');
    const steps = {
      upload: root.querySelector('.aivastra-tryon__step--upload'),
      progress: root.querySelector('.aivastra-tryon__step--progress'),
      pending: root.querySelector('.aivastra-tryon__step--pending'),
      result: root.querySelector('.aivastra-tryon__step--result'),
      error: root.querySelector('.aivastra-tryon__step--error'),
    };
    const resultImage = root.querySelector('.aivastra-tryon__result-image');

    function showStep(name) {
      for (const key in steps) {
        if (steps[key]) steps[key].hidden = key !== name;
      }
    }

    function resetUploadPreview() {
      if (uploadPreview) {
        if (uploadPreview.src) URL.revokeObjectURL(uploadPreview.src);
        uploadPreview.src = '';
        uploadPreview.hidden = true;
      }
      if (uploadPlaceholder) uploadPlaceholder.hidden = false;
    }

    function openModal() {
      modal.hidden = false;
      showStep('upload');
      fileInput.value = '';
      resetUploadPreview();
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
        showStep('error');
        const errorStep = steps.error;
        if (errorStep) {
          errorStep.querySelector('p').textContent =
            'Try-on is temporarily unavailable, please check back later.';
        }
        throw new Error('try-on unavailable');
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

    async function handleFile(file) {
      if (!file.type.startsWith('image/')) {
        showStep('error');
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        showStep('error');
        return;
      }

      showStep('progress');
      try {
        const customerPhotoKey = await uploadPhoto(file);
        const jobResult = await createJob(customerPhotoKey);
        if (jobResult.pending) {
          showStep('pending');
          return;
        }
        const resultUrl = await waitForResult(jobResult.jobId);
        resultImage.src = resultUrl;
        showStep('result');
      } catch (_err) {
        showStep('error');
      }
    }

    button.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (uploadPreview && uploadPlaceholder && file.type.startsWith('image/')) {
        if (uploadPreview.src) URL.revokeObjectURL(uploadPreview.src);
        uploadPreview.src = URL.createObjectURL(file);
        uploadPreview.hidden = false;
        uploadPlaceholder.hidden = true;
      }
      handleFile(file);
    });
    const retryBtns = root.querySelectorAll('.aivastra-tryon__retry');
    for (let k = 0; k < retryBtns.length; k++) {
      retryBtns[k].addEventListener('click', () => {
        showStep('upload');
        fileInput.value = '';
        resetUploadPreview();
      });
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
