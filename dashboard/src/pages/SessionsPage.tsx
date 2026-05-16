import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type Session } from '../api';
import { Pagination } from '../components/Pagination';
import SessionTimeline from '../components/SessionTimeline';

export default function SessionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    if (!projectId) return;
    api.sessions.list(projectId, page, limit)
      .then((res) => { setSessions(res.items); setTotal(res.total); })
      .catch((e: unknown) => setError((e as Error).message));
  }, [projectId, page]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Link to="/">← Projects</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Sessions</h1>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sessions.map((s) => (
          <ExpandableSession key={s.id} session={s} projectId={projectId!} />
        ))}
        {sessions.length === 0 && !error && (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>
            No sessions recorded yet.
          </div>
        )}
      </div>
      <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
    </div>
  );
}

function ExpandableSession({ session, projectId }: { session: Session; projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            {session.id}
          </div>
          <div style={{ fontSize: 12 }}>{session.initialUrl ?? '—'}</div>
          <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
            {session.userAgent ?? 'Unknown browser'}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>
          <div>{new Date(session.startedAt).toLocaleString()}</div>
          {session.endedAt && <div>ended {new Date(session.endedAt).toLocaleString()}</div>}
          <div style={{ marginTop: 4, fontWeight: 500, color: 'var(--accent)' }}>{open ? '▲ Hide timeline' : '▼ Show timeline'}</div>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <SessionTimeline projectId={projectId} sessionId={session.id} />
        </div>
      )}
    </div>
  );
}
