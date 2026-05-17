import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCheck, X } from 'lucide-react';
import { api } from '../api';
import type { UserNotification } from '../api';
import { useEventSource } from '../hooks/useEventSource';
import { cn, formatRelativeTime } from '../lib/utils';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-400',
  high: 'bg-orange-400',
  medium: 'bg-amber-400',
  low: 'bg-green-400',
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
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const fetchUnreadCount = async () => {
    try {
      const res = await api.notifications.unreadCount();
      setUnreadCount(res.unreadCount);
    } catch { /* silent */ }
  };

  const handleSse = useCallback((msg: { event: string }) => {
    if (msg.event === 'notification:new') void fetchUnreadCount();
  }, []);
  useEventSource(handleSse);

  useEffect(() => {
    void fetchUnreadCount();
    const interval = setInterval(() => void fetchUnreadCount(), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (open) void fetchNotifications();
  }, [open]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const markAsRead = async (id: string) => {
    await api.notifications.markAsRead(id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllAsRead = async () => {
    await api.notifications.markAllAsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() })));
    setUnreadCount(0);
  };

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative w-6 h-6 flex items-center justify-center rounded-md transition-colors duration-150',
          open ? 'bg-th-surface-2 text-th-2' : 'text-th-3 hover:text-th-2 hover:bg-th-surface-2'
        )}
        title="Notifications"
      >
        <Bell size={13} />
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-10 right-0 w-80 bg-th-surface border border-th rounded-xl shadow-2xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-th">
              <span className="text-xs font-semibold text-th-2">Notifications</span>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={() => void markAllAsRead()}
                    className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors duration-150"
                  >
                    <CheckCheck size={11} /> All read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-th-3 hover:text-th-2 transition-colors duration-150">
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="max-h-72 overflow-y-auto">
              {loading ? (
                <div className="px-4 py-6 text-center text-xs text-th-3">Loading...</div>
              ) : notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell size={16} className="text-zinc-700 mx-auto mb-2" />
                  <p className="text-xs text-th-3">No notifications</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => !n.read_at && void markAsRead(n.id)}
                    className={cn(
                      'px-4 py-3 border-b border-th-sub last:border-0 transition-colors duration-150',
                      !n.read_at && 'bg-th-surface-2/30 cursor-pointer hover:bg-th-surface-2/50',
                      n.read_at && 'opacity-50'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {n.severity && (
                        <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', SEVERITY_COLORS[n.severity] ?? 'bg-zinc-500')} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-th truncate">{n.title}</span>
                          <span className="text-[10px] text-th-3 whitespace-nowrap flex-shrink-0">
                            {formatRelativeTime(n.created_at)}
                          </span>
                        </div>
                        {n.body && <p className="text-[11px] text-th-3 mt-0.5 line-clamp-2">{n.body}</p>}
                        <p className="text-[10px] text-zinc-700 mt-0.5">
                          {n.project?.name}
                          {n.bug?.summary ? ` · ${n.bug.summary.slice(0, 40)}` : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
