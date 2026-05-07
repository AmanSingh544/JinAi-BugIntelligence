import type { RawEvent, ExtensionConfig } from '../shared/types';

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 20;
const DEFAULT_INGEST_URL = 'http://localhost:4000/api/v1/ingest/batch';

let eventBuffer: RawEvent[] = [];
let sessionId: string | null = null;
let config: ExtensionConfig | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;

// Config is loaded async — queue messages that arrive before it's ready
let configReady = false;
const pendingMessages: Array<{ type: string; event?: RawEvent; sessionId?: string }> = [];

// ── Init ──────────────────────────────────────────────────────────────────────

chrome.storage.local.get(['apiKey', 'ingestUrl', 'enabled', 'sessionId'], (result) => {
  config = {
    apiKey: result.apiKey ?? '',
    ingestUrl: result.ingestUrl ?? DEFAULT_INGEST_URL,
    enabled: result.enabled ?? false,
  };
  sessionId = result.sessionId ?? null;
  configReady = true;

  console.log('[BugIntel] Service worker initialised. enabled=', config.enabled, 'sessionId=', sessionId);

  if (config.enabled) startFlushing();

  // Drain any messages that arrived before config loaded
  for (const msg of pendingMessages) handleMessage(msg);
  pendingMessages.length = 0;
});

chrome.storage.onChanged.addListener((changes) => {
  if (!config) return;
  if (changes.apiKey) config.apiKey = changes.apiKey.newValue;
  if (changes.ingestUrl) config.ingestUrl = changes.ingestUrl.newValue;
  if (changes.enabled) {
    config.enabled = changes.enabled.newValue;
    if (config.enabled) startFlushing();
    else stopFlushing();
  }
});

// ── Message handler ───────────────────────────────────────────────────────────

function handleMessage(message: { type: string; event?: RawEvent; sessionId?: string }) {
  console.log('[BugIntel] Message received:', message.type);

  if (message.type === 'SESSION_INIT' && message.sessionId) {
    sessionId = message.sessionId;
    chrome.storage.local.set({ sessionId });
    console.log('[BugIntel] Session initialised:', sessionId);
  }

  if (message.type === 'CAPTURE_EVENT' && message.event) {
    if (!config?.enabled) {
      console.log('[BugIntel] Dropped event — extension disabled');
      return;
    }
    eventBuffer.push(message.event);
    console.log('[BugIntel] Buffered event type=', message.event.type, 'buffer size=', eventBuffer.length);
    if (eventBuffer.length >= FLUSH_BATCH_SIZE) void flush();
  }

  if (message.type === 'MANUAL_REPORT') {
    void flush();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!configReady) {
    // Config not loaded yet — queue and process after init
    pendingMessages.push(message as { type: string; event?: RawEvent; sessionId?: string });
  } else {
    handleMessage(message as { type: string; event?: RawEvent; sessionId?: string });
  }
  // Return true keeps the message channel open for async sendResponse
  sendResponse({ ok: true });
  return true;
});

// ── Flush ─────────────────────────────────────────────────────────────────────

function startFlushing() {
  if (flushTimer) return;
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  console.log('[BugIntel] Flush timer started');
}

function stopFlushing() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

async function flush() {
  if (!config?.apiKey || !sessionId || eventBuffer.length === 0) {
    if (eventBuffer.length > 0) {
      console.warn('[BugIntel] Cannot flush — apiKey:', !!config?.apiKey, 'sessionId:', !!sessionId);
    }
    return;
  }

  const batch = eventBuffer.splice(0, 100);
  console.log('[BugIntel] Flushing', batch.length, 'events to', config.ingestUrl);

  try {
    const res = await fetch(config.ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey,
      },
      body: JSON.stringify({
        sessionId,
        sessionMeta: { userAgent: navigator.userAgent },
        events: batch,
      }),
    });

    if (!res.ok) {
      eventBuffer.unshift(...batch);
      console.warn('[BugIntel] Ingest failed:', res.status, res.statusText);
    } else {
      console.log('[BugIntel] Flushed successfully. Status:', res.status);
    }
  } catch (err) {
    eventBuffer.unshift(...batch);
    console.warn('[BugIntel] Ingest error:', err);
  }
}

// Keep service worker alive while there are buffered events
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive' && eventBuffer.length > 0) {
    void flush();
  }
});

self.addEventListener('beforeunload', () => void flush());
