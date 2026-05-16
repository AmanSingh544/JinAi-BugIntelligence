import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api';
import type { UserNotification } from '../api';
import { useEventSource } from '../hooks/useEventSource';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await api.notifications.list({ limit: 20 });
      setNotifications(res.items);
      setUnreadCount(res.unreadCount);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const res = await api.notifications.unreadCount();
      setUnreadCount(res.unreadCount);
    } catch {
      // silent fail
    }
  };

  const handleSse = useCallback((msg: { event: string; data: unknown }) => {
    if (msg.event === 'notification:new') {
      fetchUnreadCount();
    }
  }, []);

  useEventSource(handleSse);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const markAsRead = async (id: string) => {
    await api.notifications.markAsRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllAsRead = async () => {
    await api.notifications.markAllAsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() })));
    setUnreadCount(0);
  };

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: '1px solid #2d3148',
          borderRadius: 6,
          padding: '8px 12px',
          cursor: 'pointer',
          color: '#e2e8f0',
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span
            style={{
              background: '#ef4444',
              color: '#fff',
              borderRadius: 10,
              padding: '2px 6px',
              fontSize: 11,
              fontWeight: 600,
              minWidth: 18,
              textAlign: 'center',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 44,
            right: 0,
            width: 380,
            maxHeight: 480,
            background: '#0f1117',
            border: '1px solid #2d3148',
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #2d3148',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#60a5fa',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading && (
              <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                Loading…
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                No notifications
              </div>
            )}

            {notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.read_at && markAsRead(n.id)}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #1a1d27',
                  cursor: n.read_at ? 'default' : 'pointer',
                  opacity: n.read_at ? 0.6 : 1,
                  background: n.read_at ? 'transparent' : '#1a1d27',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  {n.severity && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: SEVERITY_COLORS[n.severity] ?? '#64748b',
                        display: 'inline-block',
                      }}
                    />
                  )}
                  <span style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0', flex: 1 }}>
                    {n.title}
                  </span>
                  <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
                    {timeAgo(n.created_at)}
                  </span>
                </div>
                {n.body && (
                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>{n.body}</div>
                )}
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                  {n.project?.name}
                  {n.bug?.summary ? ` · ${n.bug.summary.slice(0, 40)}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
