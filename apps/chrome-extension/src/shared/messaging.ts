/** Thin promise wrapper around chrome.runtime.sendMessage, shared by the
 * content script and the popup — both only ever talk to the background
 * service worker, never to the API directly (see background/index.ts). */
export function sendMessage<T = unknown>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error?.message || 'Something went wrong'));
        return;
      }
      resolve(response.data as T);
    });
  });
}
