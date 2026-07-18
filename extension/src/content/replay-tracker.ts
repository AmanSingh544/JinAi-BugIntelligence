import { record } from 'rrweb';
import { sendEvent, getSessionId } from './shared';

const POST_ERROR_RECORD_MS = 5000;
// rrweb re-takes a full snapshot every N events ("checkout"). We keep the
// last complete chunk plus the current one, so the buffer ALWAYS starts with
// a Meta + FullSnapshot pair. A naive ring buffer slices the snapshot off on
// busy pages and the replay renders as a blank page with a floating cursor.
const CHECKOUT_EVERY_NTH = 150;

let chunks: unknown[][] = [];
let recording = false;
let stopFn: (() => void) | null = null;
let _replayEnabled = false;

export function setReplayEnabled(enabled: boolean) {
  _replayEnabled = enabled;
}

export function startReplayRecording() {
  console.log('[BugIntel] startReplayRecording called, recording=', recording, 'enabled=', _replayEnabled);
  if (recording) return;
  if (!_replayEnabled) return;

  recording = true;
  chunks = [];

  stopFn = record({
    maskAllInputs: true,
    maskTextSelector: '*[data-bi-mask]',
    checkoutEveryNth: CHECKOUT_EVERY_NTH,
    emit(event, isCheckout) {
      if (isCheckout || chunks.length === 0) {
        chunks.push([]);
        if (chunks.length > 2) chunks.shift();
      }
      const current = chunks[chunks.length - 1];
      if (current) current.push(event);
    },
  }) ?? null;
}

export function stopReplayRecording() {
  if (stopFn) {
    stopFn();
    stopFn = null;
  }
  recording = false;
}

export function flushReplayBuffer(includeExtra = false) {
  if (!_replayEnabled) return;

  const events = chunks.flat();
  chunks = [];

  if (includeExtra) {
    // Continue recording for 5 more seconds after error
    setTimeout(() => {
      const extraEvents = chunks.flat();
      chunks = [];
      if (extraEvents.length > 0) {
        sendReplayEvents([...events, ...extraEvents]);
      } else if (events.length > 0) {
        sendReplayEvents(events);
      }
      restartRecording();
    }, POST_ERROR_RECORD_MS);
  } else {
    if (events.length > 0) {
      sendReplayEvents(events);
    }
    restartRecording();
  }
}

// Restart (not just continue) so rrweb emits a fresh full snapshot — without
// one, the next flushed segment would be incremental-only and unplayable.
// Keeps recording armed for the next error instead of going dark until the
// service worker's next 60s config broadcast.
function restartRecording() {
  stopReplayRecording();
  startReplayRecording();
}

function sendReplayEvents(events: unknown[]) {
  sendEvent({
    id: crypto.randomUUID(),
    sessionId: getSessionId(),
    timestamp: Date.now(),
    type: 'replay_snapshot',
    url: window.location.href,
    payload: { events },
  });
}
