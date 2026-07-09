(function () {
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  // Dispatcher's own widget-job ComfyUI deadline is 5 min (processor.ts); add a
  // safety margin so the widget never gives up before the backend would.
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
    const steps = {
      upload: root.querySelector('.aivastra-tryon__step--upload'),
      progress: root.querySelector('.aivastra-tryon__step--progress'),
      pending: root.querySelector('.aivastra-tryon__step--pending'),
      result: root.querySelector('.aivastra-tryon__step--result'),
      error: root.querySelector('.aivastra-tryon__step--error'),
    };
    const resultImage = root.querySelector('.aivastra-tryon__result-image');

    function showStep(name) {
      for (const key of Object.keys(steps)) {
        steps[key].hidden = key !== name;
      }
    }

    function openModal() {
      modal.hidden = false;
      showStep('upload');
      fileInput.value = '';
    }

    function closeModal() {
      modal.hidden = true;
    }

    async function uploadPhoto(file) {
      const presignRes = await fetch(`${apiBase}/v1/widget/presign`, {
        method: 'POST',
        headers: { 'x-widget-key': widgetKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
      });
      if (!presignRes.ok) throw new Error('presign failed');
      const { uploadUrl, r2Key } = await presignRes.json();

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error('upload failed');
      return r2Key;
    }

    async function createJob(customerPhotoKey) {
      const res = await fetch(`${apiBase}/v1/widget/jobs`, {
        method: 'POST',
        headers: { 'x-widget-key': widgetKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopifyProductId: productId, customerPhotoKey }),
      });
      if (res.status === 202) return { pending: true };
      if (!res.ok) throw new Error(`job create failed: ${res.status}`);
      const body = await res.json();
      return { pending: false, jobId: body.jobId };
    }

    async function fetchJobStatus(jobId) {
      const res = await fetch(`${apiBase}/v1/widget/jobs/${jobId}`, {
        headers: { 'x-widget-key': widgetKey },
      });
      if (!res.ok) throw new Error(`job fetch failed: ${res.status}`);
      return res.json();
    }

    // Native EventSource can't send the x-widget-key auth header, so this reads
    // the same SSE endpoint the main try-on pipeline uses via fetch + ReadableStream
    // (mirrors apps/catalogues-web/src/lib/sse.ts).
    async function waitForResult(jobId) {
      const deadline = Date.now() + SSE_MAX_WAIT_MS;

      while (Date.now() < deadline) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(deadline - Date.now(), 0));
        let terminal = null;

        try {
          const res = await fetch(`${apiBase}/v1/widget/jobs/${jobId}/events`, {
            headers: { 'x-widget-key': widgetKey },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`sse failed: ${res.status}`);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          while (!terminal) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() || '';
            for (const block of parts) {
              let dataLine = '';
              for (const line of block.split('\n')) {
                if (line.startsWith('data:')) dataLine = line.slice(5).trim();
              }
              if (!dataLine) continue;
              try {
                const evt = JSON.parse(dataLine);
                if (evt.status === 'COMPLETED' || evt.status === 'FAILED') {
                  terminal = evt;
                  break;
                }
              } catch {
                /* ignore malformed event */
              }
            }
          }
          reader.cancel().catch(() => {});
        } catch (err) {
          if (controller.signal.aborted) throw new Error('sse timed out');
          /* connection dropped before a terminal event -- fall through and check status */
        } finally {
          clearTimeout(timer);
        }

        if (terminal) {
          if (terminal.status === 'FAILED') throw new Error(terminal.errorCode || 'job failed');
          const body = await fetchJobStatus(jobId);
          return body.resultUrl;
        }

        // Stream closed with no terminal event -- either dropped, or the job
        // finished before we subscribed. Check current status before reconnecting.
        const body = await fetchJobStatus(jobId);
        if (body.status === 'COMPLETED') return body.resultUrl;
        if (body.status === 'FAILED') throw new Error('job failed');

        await new Promise((resolve) => setTimeout(resolve, SSE_RECONNECT_DELAY_MS));
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
      } catch (err) {
        showStep('error');
      }
    }

    button.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) handleFile(file);
    });
    for (const retryBtn of root.querySelectorAll('.aivastra-tryon__retry')) {
      retryBtn.addEventListener('click', () => {
        showStep('upload');
        fileInput.value = '';
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

  document.querySelectorAll('.aivastra-tryon').forEach((root) => {
    placeWidget(root);
    initWidget(root);
  });
})();
