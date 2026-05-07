import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, type BugDetail } from '../api';

export default function BugDetailPage() {
  const { projectId, bugId } = useParams<{ projectId: string; bugId: string }>();
  const nav = useNavigate();
  const [bug, setBug] = useState<BugDetail | null>(null);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!projectId || !bugId) return;
    api.bugs.get(projectId, bugId).then(setBug).catch((e: unknown) => setError((e as Error).message));
  }, [projectId, bugId]);

  async function setStatus(status: string) {
    if (!projectId || !bugId) return;
    setUpdating(true);
    try {
      await api.bugs.updateStatus(projectId, bugId, status);
      setBug((b) => b ? { ...b, status } : b);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdating(false);
    }
  }

  if (error) return (
    <div style={{ padding: 32, color: '#ef4444' }}>{error}</div>
  );

  if (!bug) return (
    <div style={{ padding: 32, color: 'var(--muted)' }}>Loading…</div>
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Link to={`/projects/${projectId}/bugs`}>← Bugs</Link>
      </div>

      {/* Header */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, flex: 1, marginRight: 16 }}>{bug.summary}</h1>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <span className={`badge badge-${bug.severity}`}>{bug.severity}</span>
            <span className={`badge badge-${bug.status}`}>{bug.status}</span>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Session: <code>{bug.sessionId}</code> · {new Date(bug.createdAt).toLocaleString()} · AI: {bug.aiModelVersion}
        </div>
        {bug.cluster && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            Cluster: <code>{bug.cluster.id.slice(0, 8)}…</code> · {bug.cluster.occurrenceCount} occurrences
          </div>
        )}
      </div>

      {/* AI Analysis */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Root Cause</h2>
        <p style={{ color: 'var(--text)', lineHeight: 1.6 }}>{bug.rootCause}</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Steps to Reproduce</h2>
        <ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bug.stepsToReproduce.map((step, i) => (
            <li key={i} style={{ lineHeight: 1.6 }}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Fix Suggestion</h2>
        <p style={{ color: 'var(--text)', lineHeight: 1.6 }}>{bug.fixSuggestion}</p>
      </div>

      {/* Error details */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Error</h2>
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: '#ef4444', fontFamily: 'monospace', fontSize: 13 }}>{bug.error.message}</span>
        </div>
        {bug.error.stack && (
          <pre style={{
            background: '#0f1117',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            fontSize: 11,
            overflow: 'auto',
            color: 'var(--muted)',
            maxHeight: 300,
          }}>
            {bug.error.stack}
          </pre>
        )}
      </div>

      {/* Actions */}
      <div className="card">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Actions</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          {bug.status !== 'resolved' && (
            <button onClick={() => void setStatus('resolved')} disabled={updating}>
              Mark Resolved
            </button>
          )}
          {bug.status !== 'ignored' && (
            <button className="secondary" onClick={() => void setStatus('ignored')} disabled={updating}>
              Ignore
            </button>
          )}
          {bug.status === 'open' && (
            <button className="secondary" onClick={() => void setStatus('dispatched')} disabled={updating}>
              Dispatch
            </button>
          )}
          <button className="secondary" onClick={() => nav(-1)}>Back</button>
        </div>
      </div>
    </div>
  );
}
