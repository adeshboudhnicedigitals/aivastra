(() => {
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const SSE_MAX_WAIT_MS = 6 * 60 * 1000;
  const SSE_RECONNECT_DELAY_MS = 1000;
  const ACCOUNT_TOKEN_KEY = 'aivastra_shopify_account_token';

  function getAccountToken() {
    return localStorage.getItem(ACCOUNT_TOKEN_KEY);
  }
  function setAccountToken(token) {
    localStorage.setItem(ACCOUNT_TOKEN_KEY, token);
  }
  function clearAccountToken() {
    localStorage.removeItem(ACCOUNT_TOKEN_KEY);
  }

  function linkAccount(appBase) {
    return new Promise((resolve, reject) => {
      const nonce = Math.random().toString(36).slice(2);
      const origin = window.location.origin;
      const popup = window.open(
        `${appBase}/login?next=${encodeURIComponent(`/widget-link-complete?origin=${encodeURIComponent(origin)}&nonce=${nonce}`)}`,
        'aivastra-link',
        'width=480,height=640',
      );
      function onMessage(event) {
        if (event.origin !== appBase) return;
        if (event.data?.type !== 'aivastra-widget-link' || event.data.nonce !== nonce) return;
        window.removeEventListener('message', onMessage);
        resolve(event.data.code);
      }
      window.addEventListener('message', onMessage);
      const closeCheck = setInterval(() => {
        if (popup?.closed) {
          clearInterval(closeCheck);
          window.removeEventListener('message', onMessage);
          reject(new Error('popup closed before linking completed'));
        }
      }, 500);
    });
  }

  async function exchangeCode(apiBase, widgetKey, code) {
    const res = await fetch(`${apiBase}/v1/shopify/customer/account/exchange`, {
      method: 'POST',
      headers: { 'x-widget-key': widgetKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code }),
    });
    if (!res.ok) throw new Error('exchange failed');
    const body = await res.json();
    return body.token;
  }

  function initWidget(root) {
    const widgetKey = root.dataset.widgetKey;
    const productId = Number(root.dataset.productId);
    const apiBase = root.dataset.apiBase.replace(/\/$/, '');
    const appBase = root.dataset.appBase.replace(/\/$/, '');

    const button = root.querySelector('.aivastra-tryon__button');
    const modal = root.querySelector('.aivastra-tryon__modal');
    const closeBtn = root.querySelector('.aivastra-tryon__close');
    const fileInput = root.querySelector('.aivastra-tryon__file-input');
    const steps = {
      signin: root.querySelector('.aivastra-tryon__step--signin'),
      upload: root.querySelector('.aivastra-tryon__step--upload'),
      progress: root.querySelector('.aivastra-tryon__step--progress'),
      pending: root.querySelector('.aivastra-tryon__step--pending'),
      result: root.querySelector('.aivastra-tryon__step--result'),
      error: root.querySelector('.aivastra-tryon__step--error'),
    };
    const resultImage = root.querySelector('.aivastra-tryon__result-image');
    const signinBtn = root.querySelector('.aivastra-tryon__signin');

    function showStep(name) {
      for (const key in steps) {
        if (steps[key]) steps[key].hidden = key !== name;
      }
    }

    function openModal() {
      modal.hidden = false;
      if (!getAccountToken()) {
        showStep('signin');
      } else {
        showStep('upload');
        fileInput.value = '';
      }
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
      if (!presignRes.ok) {
        if (presignRes.status === 401) {
          clearAccountToken();
          showStep('signin');
        }
        throw new Error('presign failed');
      }
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
      const token = getAccountToken();
      const res = await fetch(`${apiBase}/v1/shopify/customer/jobs`, {
        method: 'POST',
        headers: {
          'x-widget-key': widgetKey,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ shopifyProductId: productId, customerPhotoKey: customerPhotoKey }),
      });
      if (res.status === 401) {
        clearAccountToken();
        showStep('signin');
        throw new Error('invalid account token');
      }
      if (res.status === 402) {
        showStep('error');
        const errorStep = steps.error;
        if (errorStep) {
          errorStep.querySelector('p').innerHTML =
            `Out of credits — <a href="${appBase}/pricing">top up your account</a>`;
        }
        throw new Error('insufficient credits');
      }
      if (res.status === 202) return { pending: true };
      if (!res.ok) throw new Error(`job create failed: ${res.status}`);
      const body = await res.json();
      return { pending: false, jobId: body.jobId };
    }

    async function fetchJobStatus(jobId) {
      const token = getAccountToken();
      const res = await fetch(`${apiBase}/v1/shopify/customer/jobs/${jobId}`, {
        headers: { 'x-widget-key': widgetKey, Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`job fetch failed: ${res.status}`);
      return res.json();
    }

    async function waitForResult(jobId) {
      const deadline = Date.now() + SSE_MAX_WAIT_MS;
      const token = getAccountToken();

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
            headers: { 'x-widget-key': widgetKey, Authorization: `Bearer ${token}` },
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
        /* if 401, clearAccountToken and showStep('signin') already handled in the call that failed */
        if (steps.signin && !steps.signin.hidden) return;
        showStep('error');
      }
    }

    async function doAccountLink() {
      try {
        showStep('progress');
        const code = await linkAccount(appBase);
        const token = await exchangeCode(apiBase, widgetKey, code);
        setAccountToken(token);
        showStep('upload');
        fileInput.value = '';
      } catch (_err) {
        showStep('error');
      }
    }

    button.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    if (signinBtn) signinBtn.addEventListener('click', doAccountLink);
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) handleFile(file);
    });
    const retryBtns = root.querySelectorAll('.aivastra-tryon__retry');
    for (let k = 0; k < retryBtns.length; k++) {
      retryBtns[k].addEventListener('click', () => {
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

  const widgets = document.querySelectorAll('.aivastra-tryon');
  for (let i = 0; i < widgets.length; i++) {
    placeWidget(widgets[i]);
    initWidget(widgets[i]);
  }
})();
