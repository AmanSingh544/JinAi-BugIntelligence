import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type Session } from '../api';

export default function SessionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId) return;
    api.sessions.list(projectId).then(setSessions).catch((e: unknown) => setError((e as Error).message));
  }, [projectId]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Link to="/">← Projects</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Sessions</h1>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sessions.map((s) => (
          <div key={s.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                  {s.id}
                </div>
                <div style={{ fontSize: 12 }}>{s.initialUrl ?? '—'}</div>
                <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
                  {s.userAgent ?? 'Unknown browser'}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>
                <div>{new Date(s.startedAt).toLocaleString()}</div>
                {s.endedAt && <div>ended {new Date(s.endedAt).toLocaleString()}</div>}
              </div>
            </div>
          </div>
        ))}
        {sessions.length === 0 && !error && (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>
            No sessions recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}
