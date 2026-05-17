import type { RawEvent, ExtensionConfig } from '../shared/types';
import {
  loadRuntimeConfig,
  startConfigPolling,
  stopConfigPolling,
  shouldTrack,
  getRuntimeConfig,
} from '../shared/runtime-config';
import { sanitizePayload } from '../shared/sanitize';

// ── Offscreen document for screenshots ────────────────────────────────────────

let offscreenDocumentPath: string | null = null;

async function setupOffscreenDocument(path: string): Promise<void> {
  if (offscreenDocumentPath === path) return;
  if (offscreenDocumentPath) {
    await chrome.offscreen.closeDocument();
  }
  offscreenDocumentPath = path;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL(path),
    reasons: ['TESTING' as any],
    justification: 'Capture visible tab screenshots from a service worker',
  });
}

async function captureScreenshot(sessionId: string, expectedTabId?: number): Promise<void> {
  const cfg = getRuntimeConfig();
  if (!cfg.screenshotOnError) return;

  if (expectedTabId !== undefined) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id !== expectedTabId) {
        console.log('[BugIntel] Skipping screenshot — active tab changed');
        return;
      }
    } catch {
      // Best-effort: proceed anyway if query fails
    }
  }

  try {
    await setupOffscreenDocument('offscreen.html');
    const dataUrl = await chrome.runtime.sendMessage({
      type: 'capture-screenshot',
      tabId: expectedTabId,
    });
    if (!dataUrl || typeof dataUrl !== 'string') return;

    const res = await fetch(dataUrl);
    const blob = await res.blob();

    // Resize to max 800px width
    const img = await createImageBitmap(blob);
    const maxWidth = 800;
    const scale = Math.min(1, maxWidth / img.width);
    const canvas = new OffscreenCanvas(img.width * scale, img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const formData = new FormData();
    formData.append('screenshot', jpegBlob, 'screenshot.jpg');
    formData.append('sessionId', sessionId);

    const storage = await chrome.storage.local.get(['apiKey', 'ingestUrl']);
    const uploadUrl = (storage.ingestUrl ?? 'http://localhost:4000/api/v1/ingest/batch').replace('/ingest/batch', '/upload/screenshot');

    await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'X-API-Key': storage.apiKey },
      body: formData,
    });
  } catch {
    // Best-effort: silently drop screenshot failures
  }
}

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 20;
const DEFAULT_INGEST_URL = 'http://localhost:4000/api/v1/ingest/batch';

let eventBuffer: RawEvent[] = [];
let sessionId: string | null = null;
let config: ExtensionConfig | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let currentReleaseTag: string | undefined;
let captureTabId: number | null = null;

// Config is loaded async — queue messages that arrive before it's ready
let configReady = false;
const pendingMessages: Array<{
  message: { type: string; event?: RawEvent; sessionId?: string; release?: string };
  tabId?: number;
}> = [];

// ── Init ──────────────────────────────────────────────────────────────────────

chrome.storage.local.get(['apiKey', 'ingestUrl', 'enabled', 'sessionId', 'captureTabId', 'releaseTag'], async (result) => {
  config = {
    apiKey: result.apiKey ?? '',
    ingestUrl: result.ingestUrl ?? DEFAULT_INGEST_URL,
    enabled: result.enabled ?? false,
  };
  sessionId = result.sessionId ?? null;
  captureTabId = result.captureTabId ?? null;
  currentReleaseTag = result.releaseTag ?? undefined;

  await loadRuntimeConfig();

  configReady = true;

  console.log('[BugIntel] Service worker initialised. enabled=', config.enabled, 'sessionId=', sessionId);

  if (config.enabled) {
    startFlushing();
    startConfigPolling(config.apiKey, config.ingestUrl);
  }

  // Drain any messages that arrived before config loaded
  for (const { message, tabId } of pendingMessages) handleMessage(message, tabId);
  pendingMessages.length = 0;
});

chrome.storage.onChanged.addListener((changes) => {
  if (!config) return;
  if (changes.apiKey) config.apiKey = changes.apiKey.newValue;
  if (changes.ingestUrl) config.ingestUrl = changes.ingestUrl.newValue;
  if (changes.captureTabId) {
    captureTabId = changes.captureTabId.newValue ?? null;
  }

  if (changes.enabled) {
    config.enabled = changes.enabled.newValue;
    if (config.enabled) {
      startFlushing();
      startConfigPolling(config.apiKey, config.ingestUrl);
    } else {
      stopFlushing();
      stopConfigPolling();
    }
  }
});

// ── Message handler ───────────────────────────────────────────────────────────

function handleMessage(
  message: { type: string; event?: RawEvent; sessionId?: string; release?: string },
  tabId?: number,
) {
  console.log('[BugIntel] Message received:', message.type);

  if (message.type === 'SESSION_INIT' && message.sessionId) {
    sessionId = message.sessionId;
    chrome.storage.local.set({ sessionId });
    console.log('[BugIntel] Session initialised:', sessionId);
  }

  if (message.release) {
    currentReleaseTag = message.release;
    chrome.storage.local.set({ releaseTag: message.release });
  }

  if (message.type === 'CAPTURE_EVENT' && message.event) {
    if (!config?.enabled) {
      console.log('[BugIntel] Dropped event — extension disabled');
      return;
    }

    // Handle replay snapshots directly (bypass normal batch)
    if (message.event.type === 'replay_snapshot') {
      void flushReplay(message.event);
      return;
    }

    // Sampling check (extension-side, primary)
    if (!shouldTrack(message.event.type)) {
      console.log('[BugIntel] Dropped event — sampling:', message.event.type);
      return;
    }

    eventBuffer.push({ ...message.event, payload: sanitizePayload(message.event.payload) } as RawEvent);
    console.log('[BugIntel] Buffered event type=', message.event.type, 'buffer size=', eventBuffer.length);
    if (eventBuffer.length >= FLUSH_BATCH_SIZE) void flush();

    // Screenshot on error
    if (message.event.type === 'error') {
      void captureScreenshot(sessionId ?? '', tabId);
    }
  }

  if (message.type === 'MANUAL_REPORT') {
    void flush();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (captureTabId != null && sender.tab != null && sender.tab.id !== captureTabId) {
    console.log('[BugIntel] Dropped event from tab', sender.tab.id, '— capturing only tab', captureTabId);
    sendResponse({ ok: true, dropped: true });
    return true;
  }

  if (!configReady) {
    // Config not loaded yet — queue and process after init
    pendingMessages.push({
      message: message as { type: string; event?: RawEvent; sessionId?: string; release?: string },
      tabId: sender.tab?.id,
    });
  } else {
    handleMessage(message as { type: string; event?: RawEvent; sessionId?: string; release?: string }, sender.tab?.id);
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
    };

    const envName = getRuntimeConfig().environment;
    if (envName) headers['X-BI-Environment'] = envName;

    const res = await fetch(config.ingestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId,
        sessionMeta: {
          userAgent: navigator.userAgent,
          release: currentReleaseTag,
        },
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

async function flushReplay(event: RawEvent) {
  if (!config?.apiKey || !sessionId) return;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
    };
    const envName = getRuntimeConfig().environment;
    if (envName) headers['X-BI-Environment'] = envName;

    const res = await fetch(config.ingestUrl.replace('/ingest/batch', `/sessions/${sessionId}/replay`), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sequence: 1,
        events: (event.payload as { events?: unknown[] }).events ?? [],
      }),
    });
    if (!res.ok) {
      console.warn('[BugIntel] Replay flush failed:', res.status);
    }
  } catch (err) {
    console.warn('[BugIntel] Replay flush error:', err);
  }
}

// Clear capture if the tracked tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === captureTabId) {
    console.log('[BugIntel] Captured tab closed — pausing capture');
    captureTabId = null;
    chrome.storage.local.set({ captureTabId: null, enabled: false });
  }
});

// Keep service worker alive while there are buffered events
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive' && eventBuffer.length > 0) {
    void flush();
  }
});

self.addEventListener('beforeunload', () => void flush());
