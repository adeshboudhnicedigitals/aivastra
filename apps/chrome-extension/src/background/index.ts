import * as api from './api.js';

type Message =
  | { type: 'GET_AUTH_STATE' }
  | { type: 'LOGIN'; email: string; password: string }
  | { type: 'LOGOUT' }
  | { type: 'GET_CREDITS' }
  | { type: 'GET_CATEGORIES' }
  | { type: 'FETCH_IMAGE'; url: string }
  | { type: 'SUBMIT_TRYON'; category: string; personDataUrl: string; garmentDataUrl: string }
  | { type: 'GET_JOB'; jobId: string };

type Response =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } };

async function handle(message: Message): Promise<unknown> {
  switch (message.type) {
    case 'GET_AUTH_STATE':
      return { loggedIn: await api.isLoggedIn() };
    case 'LOGIN':
      await api.login(message.email, message.password);
      return { loggedIn: true };
    case 'LOGOUT':
      await api.logout();
      return { loggedIn: false };
    case 'GET_CREDITS':
      return api.getCredits();
    case 'GET_CATEGORIES':
      return api.getCategories();
    case 'FETCH_IMAGE':
      return { dataUrl: await api.fetchImageAsDataUrl(message.url) };
    case 'SUBMIT_TRYON':
      return api.submitTryon(message);
    case 'GET_JOB':
      return api.getJob(message.jobId);
  }
}

// Every API call (and every cross-origin image fetch) is proxied through this
// service worker — see api.ts's authedFetch/fetchImageAsDataUrl comments for
// why: this context gets Chrome's host_permissions CORS bypass, a content
// script's own fetch() does not. The content script and popup never call the
// API directly; they only ever send a message here.
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message).then(
    (data) => sendResponse({ ok: true, data } satisfies Response),
    (err) =>
      sendResponse({
        ok: false,
        error: { code: err?.code ?? 'UNKNOWN', message: err?.message ?? 'Something went wrong' },
      } satisfies Response),
  );
  return true; // keep the message channel open for the async response above
});
