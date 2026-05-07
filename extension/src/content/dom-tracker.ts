import type { ClickEvent, NavigationEvent } from '../shared/types';
import { generateId, getSessionId, sendEvent, buildSelector } from './shared';

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
