import { record } from 'rrweb';
import { sendEvent, getSessionId } from './shared';

const MAX_BUFFER_SIZE = 200;
const POST_ERROR_RECORD_MS = 5000;

let buffer: unknown[] = [];
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
  buffer = [];

  stopFn = record({
    maskAllInputs: true,
    maskTextSelector: '*[data-bi-mask]',
    emit(event) {
      buffer.push(event);
      if (buffer.length > MAX_BUFFER_SIZE) {
        buffer = buffer.slice(buffer.length - MAX_BUFFER_SIZE);
      }
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

  const events = [...buffer];
  buffer = [];

  if (includeExtra) {
    // Continue recording for 5 more seconds after error
    setTimeout(() => {
      const extraEvents = [...buffer];
      buffer = [];
      if (extraEvents.length > 0) {
        sendReplayEvents([...events, ...extraEvents]);
      } else if (events.length > 0) {
        sendReplayEvents(events);
      }
      stopReplayRecording();
    }, POST_ERROR_RECORD_MS);
  } else {
    if (events.length > 0) {
      sendReplayEvents(events);
    }
    stopReplayRecording();
  }
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
