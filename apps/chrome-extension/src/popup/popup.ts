import { sendMessage } from '../shared/messaging.js';

const PRICING_URL = 'https://app.aivastra.com/pricing';

const app = document.getElementById('app') as HTMLDivElement;

async function render() {
  app.textContent = 'Loading…';
  try {
    const { loggedIn } = await sendMessage<{ loggedIn: boolean }>({ type: 'GET_AUTH_STATE' });
    if (loggedIn) {
      await renderSignedIn();
    } else {
      renderLogin();
    }
  } catch (err) {
    app.innerHTML = '';
    const error = document.createElement('div');
    error.className = 'error';
    error.textContent = (err as Error).message;
    app.appendChild(error);
  }
}

function renderLogin() {
  app.innerHTML = `
    <h1>Sign in to Ai Vastra</h1>
    <form>
      <label>Email<input type="email" name="email" required autocomplete="email" /></label>
      <label>Password<input type="password" name="password" required autocomplete="current-password" /></label>
      <div class="error" hidden></div>
      <button type="submit" class="primary">Sign in</button>
    </form>
  `;
  const form = app.querySelector('form') as HTMLFormElement;
  const errorEl = app.querySelector('.error') as HTMLDivElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    const button = form.querySelector('button') as HTMLButtonElement;
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      await sendMessage({ type: 'LOGIN', email, password });
      await renderSignedIn();
    } catch (err) {
      errorEl.textContent = (err as Error).message;
      errorEl.hidden = false;
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });
}

async function renderSignedIn() {
  app.innerHTML = '<div>Loading your credits…</div>';
  const credits = await sendMessage<{ balance: number }>({ type: 'GET_CREDITS' }).catch(() => null);

  app.innerHTML = `
    <h1>Ai Vastra Try-On</h1>
    <div class="credits-row">
      <span>Credits</span>
      <strong>${credits ? credits.balance : '—'}</strong>
    </div>
    <button type="button" class="primary" id="buy">Buy more credits</button>
    <div class="hint">Open any clothing product page and click "Try It On" to get started.</div>
    <button type="button" class="link" id="logout">Sign out</button>
  `;
  app.querySelector('#buy')?.addEventListener('click', () => {
    chrome.tabs.create({ url: PRICING_URL });
  });
  app.querySelector('#logout')?.addEventListener('click', async () => {
    await sendMessage({ type: 'LOGOUT' });
    renderLogin();
  });
}

void render();
