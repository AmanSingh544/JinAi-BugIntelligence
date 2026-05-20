// Isolated world bridge — relays postMessage from MAIN world to service worker
// and relays service worker messages back to MAIN world.
// This script has access to chrome.runtime; the tracker scripts do not.

const SOURCE = '__bug_intel__';
const SW_SOURCE = '__bug_intel_sw__'; // marks messages originating from the SW, not forwarded back
let invalidated = false;

// MAIN → SW: only forward messages tagged with SOURCE (not SW_SOURCE, to avoid loops)
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

// SW → MAIN: relay service worker messages back to page context using SW_SOURCE tag
chrome.runtime.onMessage.addListener((message) => {
  window.postMessage({ __source: SW_SOURCE, ...message }, '*');
});

// Pull config from SW, retrying until replayEnabled settles or max attempts reached
function pullConfig(attemptsLeft: number) {
  chrome.runtime.sendMessage({ type: 'GET_RUNTIME_CONFIG' }).then((cfg) => {
    console.log('[BugIntel Bridge] Got runtime config:', cfg, 'attemptsLeft=', attemptsLeft);
    if (cfg) {
      window.postMessage({ __source: SW_SOURCE, type: 'RUNTIME_CONFIG', replayEnabled: cfg.replayEnabled }, '*');
      // If SW hadn't synced yet (replayEnabled still false), retry after 3s in case fresh config arrives
      if (!cfg.replayEnabled && attemptsLeft > 1) {
        setTimeout(() => pullConfig(attemptsLeft - 1), 500);
      }
    }
  }).catch((e) => {
    console.warn('[BugIntel Bridge] GET_RUNTIME_CONFIG failed:', e.message);
    if (attemptsLeft > 1) setTimeout(() => pullConfig(attemptsLeft - 1), 500);
  });
}

console.log('[BugIntel Bridge] Requesting runtime config from SW');
pullConfig(5); // retry up to 5 times, 3s apart (15s window)
