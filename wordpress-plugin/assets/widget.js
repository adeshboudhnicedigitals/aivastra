(() => {
  const config = window.AivastraTryOn;
  if (!config?.widgetKey) return;

  let currentImage = config.productImage;
  const button = document.getElementById('aivastra-tryon-button');
  const modal = document.getElementById('aivastra-tryon-modal');
  if (!button || !modal) return;

  // Variable products: track the shopper's selected variation image.
  // WooCommerce's variation form fires these on jQuery, not native DOM
  // events — the theme's variation form markup guarantees jQuery is present.
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

  function renderModal(title, bodyHtml) {
    modal.innerHTML =
      '<div class="aivastra-tryon-modal-content">' +
      '<button type="button" class="aivastra-modal-close" data-close aria-label="Close">&times;</button>' +
      (title ? `<h3 class="aivastra-modal-title">${title}</h3>` : '') +
      bodyHtml +
      '</div>';
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
    modal.innerHTML = '';
  }

  function renderUnavailable() {
    renderModal(
      'Try it on',
      '<div class="aivastra-error">' +
        '<span class="aivastra-error-icon">⚠️</span>' +
        '<p>Try-on is temporarily unavailable. Please try again in a moment.</p>' +
        '</div>' +
        '<button type="button" class="aivastra-secondary-btn" data-close>Close</button>',
    );
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
          renderModal(
            'Your try-on is ready',
            `<img class="aivastra-result-image" src="${classified.imageUrl}" alt="Try-on result">` +
              `<a class="aivastra-primary-btn" href="${classified.imageUrl}" download style="text-decoration:none; text-align:center;">Download</a>` +
              '<button type="button" class="aivastra-secondary-btn" data-close>Close</button>',
          );
          return;
        }
        renderUnavailable();
      })
      .catch(renderUnavailable);
  }

  function startTryOn(personDataUrl) {
    renderModal(
      'Generating your try-on',
      '<div class="aivastra-loading">' +
        '<div class="aivastra-spinner"></div>' +
        '<p>This usually takes under a minute…</p>' +
        '</div>',
    );

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

  function renderUploadStep() {
    renderModal(
      'Try it on',
      '<label class="aivastra-upload-label" id="aivastra-upload-label">' +
        '<img id="aivastra-upload-preview" class="aivastra-upload-preview" hidden alt="Your photo">' +
        '<span class="aivastra-upload-icon" id="aivastra-upload-icon">📷</span>' +
        '<span id="aivastra-upload-hint">Click to upload a full-length photo of yourself</span>' +
        '<input type="file" accept="image/*" id="aivastra-tryon-file">' +
        '</label>' +
        '<button type="button" class="aivastra-primary-btn" id="aivastra-tryon-generate" disabled>Generate Try-On</button>',
    );

    const fileInput = document.getElementById('aivastra-tryon-file');
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      const generateBtn = document.getElementById('aivastra-tryon-generate');
      if (!file) {
        generateBtn.disabled = true;
        return;
      }
      generateBtn.disabled = false;
      const reader = new FileReader();
      reader.onload = () => {
        const preview = document.getElementById('aivastra-upload-preview');
        preview.src = reader.result;
        preview.hidden = false;
        document.getElementById('aivastra-upload-icon').hidden = true;
        document.getElementById('aivastra-upload-hint').textContent = file.name;
      };
      reader.readAsDataURL(file);
    });
  }

  button.addEventListener('click', renderUploadStep);

  modal.addEventListener('click', (event) => {
    if (event.target.hasAttribute('data-close')) {
      closeModal();
    }
    if (event.target.id === 'aivastra-tryon-generate') {
      const fileInput = document.getElementById('aivastra-tryon-file');
      const file = fileInput?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        startTryOn(reader.result);
      };
      reader.readAsDataURL(file);
    }
  });
})();
