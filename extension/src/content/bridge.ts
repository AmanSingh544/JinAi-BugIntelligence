// Isolated world bridge — relays postMessage from MAIN world to service worker
// This script has access to chrome.runtime; the tracker scripts do not.

const SOURCE = '__bug_intel__';
let invalidated = false;

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.__source !== SOURCE) return;
  if (invalidated) return;

  const { __source: _, ...message } = event.data as Record<string, unknown>;

  try {
    chrome.runtime.sendMessage(message);
  } catch (e) {
    if ((e as Error).message?.includes('Extension context invalidated')) {
      invalidated = true;
    }
  }
});
