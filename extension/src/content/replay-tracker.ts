import { record } from 'rrweb';
import { getRuntimeConfig } from '../shared/runtime-config';
import { sendEvent } from './shared';

const MAX_BUFFER_SIZE = 200;
const POST_ERROR_RECORD_MS = 5000;

let buffer: unknown[] = [];
let recording = false;
let stopFn: (() => void) | null = null;

export function startReplayRecording() {
  if (recording) return;
  if (!getRuntimeConfig().replayEnabled) return;

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
  if (!getRuntimeConfig().replayEnabled) return;

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
    sessionId: '',
    timestamp: Date.now(),
    type: 'replay_snapshot',
    url: window.location.href,
    payload: { events },
  });
}
