import type { ErrorEvent as BugErrorEvent } from '../shared/types';
import { generateId, getSessionId, sendEvent } from './shared';

// Global JS errors
window.addEventListener('error', (e: globalThis.ErrorEvent) => {
  const event: BugErrorEvent = {
    id: generateId(),
    sessionId: getSessionId(),
    timestamp: Date.now(),
    type: 'error',
    url: location.href,
    payload: {
      message: e.message ?? 'Unknown error',
      ...(e.error instanceof Error && e.error.stack ? { stack: e.error.stack } : {}),
      ...(e.filename ? { file: e.filename } : {}),
      ...(e.lineno ? { line: e.lineno } : {}),
      ...(e.colno ? { column: e.colno } : {}),
    },
  };
  // Signal dom-tracker (which owns the rrweb recording state) to flush replay
  window.dispatchEvent(new CustomEvent('__bi_error__'));
  sendEvent(event);
});

// Unhandled promise rejections
window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  const reason = e.reason as Error | string | undefined;
  const msg = reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection');
  const event: BugErrorEvent = {
    id: generateId(),
    sessionId: getSessionId(),
    timestamp: Date.now(),
    type: 'error',
    url: location.href,
    payload: {
      message: msg,
      ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}),
    },
  };
  sendEvent(event);
});
