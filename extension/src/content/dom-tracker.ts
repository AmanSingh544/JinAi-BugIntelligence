import type { ClickEvent, NavigationEvent, InputEvent } from '../shared/types';
import { generateId, getSessionId, sendEvent, buildSelector } from './shared';
import { startReplayRecording, setReplayEnabled, flushReplayBuffer } from './replay-tracker';

// ── Click tracking ────────────────────────────────────────────────────────────

document.addEventListener(
  'click',
  (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target) return;

    sendEvent<ClickEvent>({
      id: generateId(),
      sessionId: getSessionId(),
      timestamp: Date.now(),
      type: 'click',
      url: location.href,
      payload: {
        tag: target.tagName.toLowerCase(),
        text: target.textContent?.trim().slice(0, 100),
        selector: buildSelector(target),
      },
    });
  },
  true,
);

// ── Input / Change tracking ───────────────────────────────────────────────────

function captureInput(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const isPassword = target.type === 'password';
  const tag = target.tagName.toLowerCase();
  const inputType = target.type || 'text';

  // Skip sensitive name attributes
  const rawName = target.getAttribute('name') || target.id || undefined;
  const name = rawName && /password|token|secret|auth|cvv|ssn|card/i.test(rawName)
    ? '[REDACTED]'
    : rawName;

  sendEvent<InputEvent>({
    id: generateId(),
    sessionId: getSessionId(),
    timestamp: Date.now(),
    type: 'input',
    url: location.href,
    payload: {
      tag,
      inputType,
      name,
      valueLength: target.value?.length ?? 0,
      isPassword,
      selector: buildSelector(target as HTMLElement),
    },
  });
}

document.addEventListener(
  'input',
  (e: Event) => {
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      captureInput(target);
    }
  },
  true,
);

document.addEventListener(
  'change',
  (e: Event) => {
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      captureInput(target);
    }
  },
  true,
);

// ── Navigation tracking (SPA + traditional) ───────────────────────────────────

let lastUrl = location.href;

function onNavigate() {
  const newUrl = location.href;
  if (newUrl === lastUrl) return;

  sendEvent<NavigationEvent>({
    id: generateId(),
    sessionId: getSessionId(),
    timestamp: Date.now(),
    type: 'navigation',
    url: newUrl,
    payload: { from: lastUrl, to: newUrl },
  });

  lastUrl = newUrl;
}

// Intercept pushState / replaceState
const originalPushState = history.pushState.bind(history);
const originalReplaceState = history.replaceState.bind(history);

history.pushState = (...args) => { originalPushState(...args); onNavigate(); };
history.replaceState = (...args) => { originalReplaceState(...args); onNavigate(); };

window.addEventListener('popstate', onNavigate);

// Start replay recording if enabled. Called immediately (config may already be
// cached in-process from a previous push) and again when the SW broadcasts config.
startReplayRecording();

// Flush replay when error-tracker signals an error (cross-IIFE via CustomEvent)
window.addEventListener('__bi_error__', () => flushReplayBuffer(true));

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.__source !== '__bug_intel_sw__') return;
  if (event.data?.type === 'RUNTIME_CONFIG') {
    const enabled = event.data.replayEnabled === true;
    console.log('[BugIntel] RUNTIME_CONFIG received, replayEnabled=', enabled);
    setReplayEnabled(enabled);
    startReplayRecording();
  }
});
