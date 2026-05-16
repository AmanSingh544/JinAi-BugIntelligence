import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { request } from '../api';
import { Pagination } from '../components/Pagination';

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
  const limit = 20;

  useEffect(() => {
    if (!projectId) return;
    request<{ items: AuditLog[]; total: number }>(`/audit-logs?page=${page}&limit=${limit}&projectId=${projectId}`)
      .then((res) => { setLogs(res.items); setTotal(res.total); })
      .catch((e: unknown) => setError((e as Error).message));
  }, [page, projectId]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Link to="/">← Projects</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Activity Feed</h1>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {logs.map((log) => (
          <div key={log.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, color: '#e2e8f0' }}>
                <span style={{ fontWeight: 600 }}>{log.actor.email}</span>{' '}
                <span style={{ color: '#94a3b8' }}>{formatAction(log.action)}</span>{' '}
                <span style={{ color: '#64748b' }}>{log.entity_type}</span>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                {new Date(log.created_at).toLocaleString()}
              </div>
            </div>
            {log.entity_id && log.entity_type === 'bug' && projectId && (
              <Link
                to={`/projects/${projectId}/bugs/${log.entity_id}`}
                style={{ fontSize: 12, color: '#6366f1', textDecoration: 'none' }}
              >
                View →
              </Link>
            )}
          </div>
        ))}
        {logs.length === 0 && !error && (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>
            No activity yet.
          </div>
        )}
      </div>
      <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
    </div>
  );
}

function formatAction(action: string): string {
  return action.replace(/_/g, ' ');
}
