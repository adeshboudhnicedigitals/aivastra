(() => {
  const config = window.AivastraTryOn;
  if (!config?.widgetKey) return;

  let currentImage = config.productImage;
  const button = document.getElementById('aivastra-tryon-button');
  const modal = document.getElementById('aivastra-tryon-modal');
  if (!button || !modal) return;

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
  };

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

  function renderModal(options) {
    const { badge = 'AI Try-On', title = '', subtitle = '', bodyHtml = '' } = options;
    modal.innerHTML =
      '<div class="aivastra-tryon-modal-content" role="dialog" aria-modal="true">' +
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

  function renderUnavailable() {
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
        '<p class="aivastra-error-desc">Please ensure your photo clearly shows a standing pose with good lighting and try again.</p>' +
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
        '</div>' +
        '<div class="aivastra-button-stack">' +
        `<a class="aivastra-primary-btn" href="${imageUrl}" target="_blank" download="tryon-result.jpg" rel="noopener noreferrer">` +
        ICONS.download +
        '<span>Download Result</span>' +
        '</a>' +
        '<button type="button" class="aivastra-secondary-btn" data-action="upload">' +
        ICONS.refresh +
        '<span>Try Another Photo</span>' +
        '</button>' +
        '<button type="button" class="aivastra-ghost-btn" data-close>Close</button>' +
        '</div>',
    });
  }

  function pollJob(jobId) {
    fetch(`${config.apiBase}/v1/dev/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${config.widgetKey}` },
    })
      .then((res) => res.json().then((body) => ({ status: res.status, body })))
      .then((result) => {
        const classified = window.AivastraWidgetLogic.classifyJobResponse(
          result.status,
          result.body,
        );
        if (classified.state === 'queued' || classified.state === 'running') {
          setTimeout(() => {
            pollJob(jobId);
          }, 2000);
          return;
        }
        if (classified.state === 'completed') {
          renderCompleted(classified.imageUrl);
          return;
        }
        renderUnavailable();
      })
      .catch(renderUnavailable);
  }

  function startTryOn(personDataUrl) {
    renderModal({
      badge: 'AI Fitting Room',
      title: 'Creating Your Look',
      subtitle: 'Fitting the garment precisely onto your photo…',
      bodyHtml:
        '<div class="aivastra-loading-container">' +
        '<div class="aivastra-spinner-wrap">' +
        '<div class="aivastra-spinner-ring"></div>' +
        '<div class="aivastra-spinner-pulse"></div>' +
        '</div>' +
        '<p class="aivastra-loading-status">Generating virtual try-on</p>' +
        '<p class="aivastra-loading-sub">This usually takes under 30 seconds</p>' +
        '</div>',
    });

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
          pollJob(result.body.jobId);
          return;
        }
        renderUnavailable();
      })
      .catch(renderUnavailable);
  }

  function renderUploadStep(initialPreviewUrl = null) {
    const hasPreview = Boolean(initialPreviewUrl);
    let selectedDataUrl = initialPreviewUrl;

    renderModal({
      badge: 'AI Fitting Room',
      title: 'Virtual Try-On',
      subtitle: 'Upload a full-body photo to see how it looks on you.',
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
        '<span>Generate Try-On</span>' +
        '</button>' +
        '</div>',
    });

    function handleFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        selectedDataUrl = reader.result;
        const dropzone = document.getElementById('aivastra-upload-dropzone');
        const previewCard = document.getElementById('aivastra-preview-card');
        const previewImg = document.getElementById('aivastra-upload-preview');
        const generateBtn = document.getElementById('aivastra-tryon-generate');

        if (previewImg) previewImg.src = selectedDataUrl;
        if (dropzone) dropzone.hidden = true;
        if (previewCard) previewCard.hidden = false;
        if (generateBtn) generateBtn.disabled = false;
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

  button.addEventListener('click', () => renderUploadStep());

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
      renderUploadStep();
      return;
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      closeModal();
    }
  });
})();
