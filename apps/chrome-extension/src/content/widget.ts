import { sendMessage } from '../shared/messaging.js';
import type { DetectedProduct } from './detect.js';

const WIDGET_CSS_PATH = 'content/widget.css';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected file'));
    reader.readAsDataURL(file);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mountWidget(product: DetectedProduct): Promise<void> {
  const host = document.createElement('div');
  host.id = 'aivastra-tryon-host';
  // Fixed positioning on the host itself (outside the shadow root) so no host
  // page CSS (e.g. a global `all: unset` or a transform on an ancestor) can
  // move or clip it.
  Object.assign(host.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: '2147483647',
  });
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = chrome.runtime.getURL(WIDGET_CSS_PATH);
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'av-root';
  shadow.appendChild(root);

  const button = document.createElement('button');
  button.className = 'av-launcher';
  button.type = 'button';
  button.textContent = '✨ Try It On';
  root.appendChild(button);

  let panel: HTMLDivElement | null = null;

  button.addEventListener('click', () => {
    if (panel) {
      closePanel();
    } else {
      panel = document.createElement('div');
      panel.className = 'av-panel';
      root.appendChild(panel);
      renderPanel(panel, product);
    }
  });

  function closePanel() {
    panel?.remove();
    panel = null;
  }
}

async function renderPanel(panel: HTMLDivElement, product: DetectedProduct) {
  panel.innerHTML = '<div class="av-loading">Loading…</div>';
  try {
    const { loggedIn } = await sendMessage<{ loggedIn: boolean }>({ type: 'GET_AUTH_STATE' });
    if (loggedIn) {
      await renderTryonForm(panel, product);
    } else {
      renderLoginForm(panel, product);
    }
  } catch (err) {
    renderError(panel, (err as Error).message, () => renderPanel(panel, product));
  }
}

function renderLoginForm(panel: HTMLDivElement, product: DetectedProduct) {
  panel.innerHTML = `
    <div class="av-header">Sign in to Ai Vastra</div>
    <form class="av-form">
      <label>Email<input type="email" name="email" required autocomplete="email" /></label>
      <label>Password<input type="password" name="password" required autocomplete="current-password" /></label>
      <div class="av-error" hidden></div>
      <button type="submit" class="av-primary">Sign in</button>
    </form>
    <div class="av-footer">No account? <a href="https://app.aivastra.com/register" target="_blank" rel="noopener">Sign up</a></div>
  `;
  const form = panel.querySelector('form') as HTMLFormElement;
  const errorEl = panel.querySelector('.av-error') as HTMLDivElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    const submitBtn = form.querySelector('button')!;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    try {
      await sendMessage({ type: 'LOGIN', email, password });
      await renderTryonForm(panel, product);
    } catch (err) {
      errorEl.textContent = (err as Error).message;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });
}

async function renderTryonForm(panel: HTMLDivElement, product: DetectedProduct) {
  panel.innerHTML = '<div class="av-loading">Loading…</div>';
  const [{ categories }, credits] = await Promise.all([
    sendMessage<{ categories: { slug: string; name: string }[] }>({ type: 'GET_CATEGORIES' }),
    sendMessage<{ balance: number }>({ type: 'GET_CREDITS' }).catch(() => null),
  ]);

  panel.innerHTML = `
    <div class="av-header">
      Try it on
      <span class="av-credits">${credits ? `${credits.balance} credits` : ''}</span>
    </div>
    <div class="av-garment-preview">
      <img class="av-garment-img" alt="Detected garment" />
    </div>
    <form class="av-form">
      <label>Your photo<input type="file" name="photo" accept="image/*" required /></label>
      <label>Category
        <select name="category" required>
          ${categories.map((c) => `<option value="${c.slug}">${c.name}</option>`).join('')}
        </select>
      </label>
      <div class="av-error" hidden></div>
      <button type="submit" class="av-primary">Try it on</button>
    </form>
    <button type="button" class="av-logout-link">Sign out</button>
  `;

  const garmentImg = panel.querySelector('.av-garment-img') as HTMLImageElement;
  garmentImg.src = product.imageUrl; // same-document <img>, loaded directly — no CORS involved for display.

  panel.querySelector('.av-logout-link')?.addEventListener('click', async () => {
    await sendMessage({ type: 'LOGOUT' });
    renderLoginForm(panel, product);
  });

  const form = panel.querySelector('form') as HTMLFormElement;
  const errorEl = panel.querySelector('.av-error') as HTMLDivElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const fileInput = form.elements.namedItem('photo') as HTMLInputElement;
    const category = (form.elements.namedItem('category') as HTMLSelectElement).value;
    const file = fileInput.files?.[0];
    if (!file) return;

    const submitBtn = form.querySelector('button')!;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      const [personDataUrl, { dataUrl: garmentDataUrl }] = await Promise.all([
        fileToDataUrl(file),
        sendMessage<{ dataUrl: string }>({ type: 'FETCH_IMAGE', url: product.imageUrl }),
      ]);
      const { jobId } = await sendMessage<{ jobId: string }>({
        type: 'SUBMIT_TRYON',
        category,
        personDataUrl,
        garmentDataUrl,
      });
      await pollJob(panel, product, jobId);
    } catch (err) {
      errorEl.textContent = (err as Error).message;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Try it on';
    }
  });
}

async function pollJob(panel: HTMLDivElement, product: DetectedProduct, jobId: string) {
  panel.innerHTML =
    '<div class="av-loading">Generating your try-on… this can take up to a minute.</div>';
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const job = await sendMessage<{ status: string; imageUrl?: string; error?: string }>({
      type: 'GET_JOB',
      jobId,
    });
    if (job.status === 'COMPLETED' && job.imageUrl) {
      renderResult(panel, product, job.imageUrl);
      return;
    }
    if (job.status === 'FAILED') {
      renderError(panel, job.error ?? 'The try-on job failed.', () =>
        renderTryonForm(panel, product),
      );
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  renderError(panel, 'This is taking longer than expected — please try again shortly.', () =>
    renderTryonForm(panel, product),
  );
}

function renderResult(panel: HTMLDivElement, product: DetectedProduct, imageUrl: string) {
  panel.innerHTML = `
    <div class="av-header">Here's how it looks</div>
    <div class="av-result"><img class="av-result-img" alt="Try-on result" /></div>
    <button type="button" class="av-primary av-retry">Try another photo</button>
  `;
  (panel.querySelector('.av-result-img') as HTMLImageElement).src = imageUrl;
  panel
    .querySelector('.av-retry')
    ?.addEventListener('click', () => renderTryonForm(panel, product));
}

function renderError(panel: HTMLDivElement, message: string, onRetry: () => void) {
  panel.innerHTML = `
    <div class="av-header">Something went wrong</div>
    <div class="av-error-block"></div>
    <button type="button" class="av-primary av-retry">Try again</button>
  `;
  (panel.querySelector('.av-error-block') as HTMLDivElement).textContent = message;
  panel.querySelector('.av-retry')?.addEventListener('click', onRetry);
}
