import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type Bug } from '../api';

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const STATUSES = ['open', 'dispatched', 'resolved', 'ignored', 'ai_failed'] as const;
const REGRESSION_FILTERS = [
  { label: 'All bugs', value: '' },
  { label: 'Regressions only', value: 'regression' },
] as const;

export default function BugsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [regression, setRegression] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const params: Record<string, string> = {};
    if (severity) params['severity'] = severity;
    if (status) params['status'] = status;
    if (regression) params['regression'] = regression;
    if (assignedToMe && currentUser) params['assignedTo'] = currentUser.id;
    api.bugs.list(projectId, params).then(setBugs).catch((e: unknown) => setError((e as Error).message));
  }, [projectId, severity, status, regression, assignedToMe, currentUser]);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Link to="/">← Projects</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Bugs</h1>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={{ width: 150 }}>
          <option value="">All severities</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 150 }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={regression} onChange={(e) => setRegression(e.target.value)} style={{ width: 160 }}>
          {REGRESSION_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={assignedToMe}
            onChange={(e) => setAssignedToMe(e.target.checked)}
          />
          Assigned to me
        </label>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bugs.map((b) => (
          <Link key={b.id} to={`/projects/${projectId}/bugs/${b.id}`} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, marginRight: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{b.summary}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>
                    {b.sessionId.slice(0, 8)}…
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  {b.regressionDetectedAt && (
                    <span className="badge" style={{ background: '#ef4444', color: '#fff' }}>Regression</span>
                  )}
                  <span className={`badge badge-${b.severity}`}>{b.severity}</span>
                  <span className={`badge badge-${b.status}`}>{b.status}</span>
                  {b.assignee && (
                    <span style={{ fontSize: 11, color: 'var(--muted)' }} title={b.assignee.email}>
                      @{b.assignee.email.split('@')[0]}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {new Date(b.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
        {bugs.length === 0 && !error && (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>
            No bugs yet. Install the extension and trigger an error.
          </div>
        )}
      </div>
    </div>
  );
}
