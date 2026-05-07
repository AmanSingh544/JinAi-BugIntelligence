import type { ApiRequestEvent, ApiResponseEvent, JsonValue } from '../shared/types';
import { generateId, getSessionId, sendEvent, maskSensitiveFields } from './shared';

const MAX_BODY_CHARS = 2000;

function truncate(val: JsonValue | undefined): JsonValue | undefined {
  if (val === undefined) return undefined;
  const s = JSON.stringify(val);
  if (s.length <= MAX_BODY_CHARS) return val;
  return { __truncated: true, preview: s.slice(0, MAX_BODY_CHARS) };
}

// ── Fetch intercept ───────────────────────────────────────────────────────────

const originalFetch = window.fetch.bind(window);

window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();
  const startTime = Date.now();
  const reqId = generateId();

  let requestBody: JsonValue | undefined;
  if (init?.body && typeof init.body === 'string') {
    try { requestBody = maskSensitiveFields(JSON.parse(init.body) as JsonValue); } catch { /* ignore */ }
  }

  sendEvent<ApiRequestEvent>({
    id: reqId,
    sessionId: getSessionId(),
    timestamp: startTime,
    type: 'api_request',
    url: location.href,
    payload: { url, method, requestBody: truncate(requestBody) },
  });

  const response = await originalFetch(input, init);
  const duration = Date.now() - startTime;

  let responseBody: JsonValue | undefined;
  const clone = response.clone();
  const contentType = clone.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try { responseBody = maskSensitiveFields(await clone.json() as JsonValue); } catch { /* ignore */ }
  }

  sendEvent<ApiResponseEvent>({
    id: generateId(),
    sessionId: getSessionId(),
    timestamp: Date.now(),
    type: 'api_response',
    url: location.href,
    payload: { url, method, status: response.status, duration, responseBody: truncate(responseBody) },
  });

  return response;
};

// ── XHR intercept ─────────────────────────────────────────────────────────────

const OriginalXHR = window.XMLHttpRequest;

class InterceptedXHR extends OriginalXHR {
  private _url = '';
  private _method = 'GET';
  private _startTime = 0;

  open(method: string, url: string | URL, ...args: unknown[]) {
    this._url = url.toString();
    this._method = method.toUpperCase();
    const [async = true, user, password] = args as [boolean?, string?, string?];
    return super.open(method, url as string, async, user, password);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this._startTime = Date.now();
    const reqId = generateId();

    let requestBody: JsonValue | undefined;
    if (typeof body === 'string') {
      try { requestBody = maskSensitiveFields(JSON.parse(body) as JsonValue); } catch { /* ignore */ }
    }

    sendEvent<ApiRequestEvent>({
      id: reqId,
      sessionId: getSessionId(),
      timestamp: this._startTime,
      type: 'api_request',
      url: location.href,
      payload: { url: this._url, method: this._method, requestBody: truncate(requestBody) },
    });

    this.addEventListener('loadend', () => {
      const duration = Date.now() - this._startTime;
      let responseBody: JsonValue | undefined;
      const ct = this.getResponseHeader('content-type') ?? '';
      if (ct.includes('application/json') && this.responseText) {
        try { responseBody = maskSensitiveFields(JSON.parse(this.responseText) as JsonValue); } catch { /* ignore */ }
      }

      sendEvent<ApiResponseEvent>({
        id: generateId(),
        sessionId: getSessionId(),
        timestamp: Date.now(),
        type: 'api_response',
        url: location.href,
        payload: { url: this._url, method: this._method, status: this.status, duration, responseBody: truncate(responseBody) },
      });
    });

    return super.send(body);
  }
}

window.XMLHttpRequest = InterceptedXHR as unknown as typeof XMLHttpRequest;
