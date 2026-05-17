import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, AlertCircle, ExternalLink } from 'lucide-react';
import { request } from '../api';
import { Pagination } from '../components/Pagination';
import { EmptyState } from '../components/ui/EmptyState';
import { formatRelativeTime } from '../lib/utils';

interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: { id: string; email: string };
}

export default function ActivityFeedPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const limit = 10;

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    request<{ items: AuditLog[]; total: number }>(`/audit-logs?page=${page}&limit=${limit}&projectId=${projectId}`)
      .then((res) => { setLogs(res.items); setTotal(res.total); })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [page, projectId]);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-th-bg px-6 pt-2 pb-1 border-th-sub flex items-center justify-between">
        <h1 className="text-base font-bold text-th">Activity</h1>
        <p className="text-xs text-th-3 mt-0.5">Audit log of team actions</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6 max-w-100% mx-auto w-full">

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 mb-4">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 bg-th-surface border border-th rounded-lg animate-pulse" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <EmptyState icon={<BarChart3 size={18} />} title="No activity yet" description="Team actions will appear here as they happen." />
      ) : (
        <div className="space-y-1.5">
          {logs.map((log, i) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className="flex items-center justify-between gap-4 bg-th-surface border border-th rounded-lg px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-6 h-6 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-[10px] font-bold text-indigo-400 flex-shrink-0 uppercase">
                  {log.actor.email[0]}
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-th-2">
                    <span className="font-medium text-th">{log.actor.email}</span>
                    {' '}<span className="text-th-3">{log.action.replace(/_/g, ' ')}</span>
                    {' '}<span className="text-th-3">{log.entity_type}</span>
                  </div>
                  <div className="text-[10px] text-th-3 mt-0.5">{formatRelativeTime(log.created_at)}</div>
                </div>
              </div>
              {log.entity_id && log.entity_type === 'bug' && projectId && (
                <Link
                  to={`/projects/${projectId}/bugs/${log.entity_id}`}
                  className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors duration-150 flex-shrink-0"
                >
                  View <ExternalLink size={10} />
                </Link>
              )}
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
