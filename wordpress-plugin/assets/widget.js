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

  function renderModal(html) {
    modal.innerHTML = `<div class="aivastra-tryon-modal-content">${html}</div>`;
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
    modal.innerHTML = '';
  }

  function renderUnavailable() {
    renderModal(
      '<p>Try-on is temporarily unavailable.</p><button type="button" data-close>Close</button>',
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
            `<img src="${classified.imageUrl}" alt="Try-on result" style="max-width:100%">` +
              `<p><a href="${classified.imageUrl}" download>Download</a></p>` +
              '<button type="button" data-close>Close</button>',
          );
          return;
        }
        renderUnavailable();
      })
      .catch(renderUnavailable);
  }

  function startTryOn(personDataUrl) {
    renderModal('<p>Generating your try-on…</p>');

    fetch(currentImage)
      .then((r) => r.blob())
      .then((garmentBlob) =>
        fetch(personDataUrl)
          .then((r) => r.blob())
          .then((personBlob) => {
            const form = new FormData();
            form.set('category', 'general');
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

  button.addEventListener('click', () => {
    renderModal(
      '<p>Upload your photo</p>' +
        '<input type="file" accept="image/*" id="aivastra-tryon-file">' +
        '<p><button type="button" id="aivastra-tryon-generate">Generate Try-On</button></p>' +
        '<button type="button" data-close>Close</button>',
    );
  });

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
