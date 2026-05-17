import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, ChevronDown, ChevronUp, Monitor, Globe, AlertCircle } from 'lucide-react';
import { api, type Session } from '../api';
import { Pagination } from '../components/Pagination';
import SessionTimeline from '../components/SessionTimeline';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';
import { cn, formatDateTime } from '../lib/utils';

export default function SessionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 10;

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.sessions.list(projectId, page, limit)
      .then((res) => { setSessions(res.items); setTotal(res.total); })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [projectId, page]);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-th-bg px-6 pt-2 pb-1 border-th-sub flex items-center justify-between">
        <h1 className="text-base font-bold text-th">Sessions</h1>
        <p className="text-xs text-th-3 mt-0.5">{total.toLocaleString()} session{total !== 1 ? 's' : ''} recorded</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6 max-w-100% mx-auto w-full">

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 mb-4">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<Play size={18} />}
          title="No sessions recorded"
          description="Sessions are captured automatically when the extension is installed and active."
        />
      ) : (
        <div className="space-y-2">
          {sessions.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
            >
              <ExpandableSession session={s} projectId={projectId!} />
            </motion.div>
          ))}
        </div>
      )}

      </div>

      <div className="border-t border-th px-6 py-3">
        <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}

function ExpandableSession({ session, projectId }: { session: Session; projectId: string }) {
  const [open, setOpen] = useState(false);

  const duration = session.endedAt
    ? Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
    : null;

  return (
    <div className={cn(
      'bg-th-surface border border-th rounded-lg overflow-hidden transition-colors duration-150',
      open && 'border-th'
    )}>
      <button
        className="w-full flex items-start justify-between gap-4 p-4 text-left hover:bg-th-surface-2/30 transition-colors duration-150"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-md bg-th-surface-2 border border-th flex items-center justify-center flex-shrink-0 mt-0.5">
            <Monitor size={13} className="text-th-2" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-mono text-th-3 mb-1 truncate">{session.id}</div>
            <div className="text-xs text-th-2 flex items-center gap-1.5 truncate">
              {session.initialUrl ? (
                <>
                  <Globe size={11} className="text-th-3 flex-shrink-0" />
                  {session.initialUrl}
                </>
              ) : '—'}
            </div>
            {session.userAgent && (
              <div className="text-[10px] text-th-3 mt-1 truncate max-w-xs">{session.userAgent}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <div className="text-xs text-th-2">{formatDateTime(session.startedAt)}</div>
            {duration !== null && (
              <div className="text-[10px] text-th-3 mt-0.5">
                {duration < 60 ? `${duration}s` : `${Math.round(duration / 60)}m`}
              </div>
            )}
          </div>
          <div className="text-th-3">
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </div>
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-th px-4 py-4">
              <SessionTimeline projectId={projectId} sessionId={session.id} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
