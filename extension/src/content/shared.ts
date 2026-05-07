import type { JsonValue, RawEvent } from '../shared/types';

const SENSITIVE_KEYS = /^(password|passwd|token|secret|auth|api_?key|authorization|credential|ssn|cvv|card_?number)/i;
const POST_MESSAGE_SOURCE = '__bug_intel__';

export function generateId(): string {
  return crypto.randomUUID();
}

let _sessionId: string | null = null;

export function getSessionId(): string {
  if (_sessionId) return _sessionId;
  _sessionId = crypto.randomUUID();
  postToBackground({ type: 'SESSION_INIT', sessionId: _sessionId });
  return _sessionId;
}

export function sendEvent<T extends RawEvent>(event: T): void {
  postToBackground({ type: 'CAPTURE_EVENT', event });
}

// Runs in MAIN world — no chrome.runtime access, use postMessage to bridge
function postToBackground(message: object): void {
  window.postMessage({ __source: POST_MESSAGE_SOURCE, ...message }, '*');
}

export function buildSelector(el: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = el;

  while (current && current !== document.body) {
    let part = current.tagName.toLowerCase();

    if (current.id) {
      part += `#${current.id}`;
      parts.unshift(part);
      break;
    }

    const classes = Array.from(current.classList)
      .filter((c) => !/^js-|active|hover|focus|selected|disabled/.test(c))
      .slice(0, 2);
    if (classes.length) part += `.${classes.join('.')}`;

    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (s) => s.tagName === current!.tagName,
        )
      : [];
    if (siblings.length > 1) {
      const idx = siblings.indexOf(current) + 1;
      part += `:nth-of-type(${idx})`;
    }

    parts.unshift(part);
    current = current.parentElement as HTMLElement | null;

    if (parts.length >= 4) break;
  }

  return parts.join(' > ') || el.tagName.toLowerCase();
}

export function maskSensitiveFields(data: JsonValue): JsonValue {
  if (data === null || typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(maskSensitiveFields);
  }

  const result: { [key: string]: JsonValue } = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : maskSensitiveFields(value);
  }
  return result;
}
