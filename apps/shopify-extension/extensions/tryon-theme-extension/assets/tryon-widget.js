(function () {
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLL_ATTEMPTS = 60;

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

    async function pollJob(jobId) {
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const res = await fetch(`${apiBase}/v1/widget/jobs/${jobId}`, {
          headers: { 'x-widget-key': widgetKey },
        });
        if (!res.ok) throw new Error(`poll failed: ${res.status}`);
        const body = await res.json();
        if (body.status === 'COMPLETED') return body.resultUrl;
        if (body.status === 'FAILED') throw new Error('job failed');
      }
      throw new Error('polling timed out');
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
        const resultUrl = await pollJob(jobResult.jobId);
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
