import { useEffect, useRef, useCallback } from 'react';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

export type SseEvent =
  | { event: 'bug:new'; data: { bugId: string; projectId: string; summary: string } }
  | { event: 'bug:status_changed'; data: { bugId: string; projectId: string; status: string } }
  | { event: 'bug:assigned'; data: { bugId: string; projectId: string; assignedTo: string } }
  | { event: 'notification:new'; data: { userId: string; notificationId: string } }
  | { event: 'connected'; data: { clientId: string } }
  | { event: 'ping'; data: { ts: number } };

export function useEventSource(onMessage: (msg: SseEvent) => void) {
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);

  const connect = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    if (esRef.current) {
      esRef.current.close();
    }

    const url = `${BASE}/events/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url, { withCredentials: false });
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        onMessage({ event: e.lastEventId || e.type, data: parsed } as SseEvent);
      } catch {
        // ignore malformed
      }
    };

    es.addEventListener('bug:new', (e) => {
      try { onMessage({ event: 'bug:new', data: JSON.parse(e.data) }); } catch { /* ignore */ }
    });
    es.addEventListener('bug:status_changed', (e) => {
      try { onMessage({ event: 'bug:status_changed', data: JSON.parse(e.data) }); } catch { /* ignore */ }
    });
    es.addEventListener('bug:assigned', (e) => {
      try { onMessage({ event: 'bug:assigned', data: JSON.parse(e.data) }); } catch { /* ignore */ }
    });
    es.addEventListener('notification:new', (e) => {
      try { onMessage({ event: 'notification:new', data: JSON.parse(e.data) }); } catch { /* ignore */ }
    });
    es.addEventListener('connected', (e) => {
      try { onMessage({ event: 'connected', data: JSON.parse(e.data) }); } catch { /* ignore */ }
    });
    es.addEventListener('ping', (e) => {
      try { onMessage({ event: 'ping', data: JSON.parse(e.data) }); } catch { /* ignore */ }
    });

    es.onopen = () => {
      backoffRef.current = 1000;
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      const delay = Math.min(backoffRef.current, 30000);
      backoffRef.current *= 2;
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) {
        esRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);
}
