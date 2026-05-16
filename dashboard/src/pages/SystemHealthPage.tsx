import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { request } from '../api';

interface HealthData {
  queues: Record<string, { lag?: number; active?: number; failed_last_hour?: number }>;
  providers: Record<string, { errors_last_hour: number; status: string }>;
  uploads: { screenshot_failures_last_hour: number; replay_failures_last_hour: number };
}

interface FingerprintStability {
  stabilityScore: number;
  totalErrors: number;
  matchedErrors: number;
}

interface DuplicateBugRate {
  duplicateRate: number;
  totalBugs: number;
  duplicateBugs: number;
}

interface DlqJob {
  id: string;
  name: string;
  data: { bugId: string; integrationId: string; attempt: number };
  failedReason: string;
  timestamp: number;
}

export default function SystemHealthPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [stability, setStability] = useState<FingerprintStability | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateBugRate | null>(null);
  const [dlqJobs, setDlqJobs] = useState<DlqJob[]>([]);
  const [dlqLoading, setDlqLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    loadHealth();
  }, [projectId]);

  async function loadHealth() {
    setLoading(true);
    try {
      const [data, stab, dupes, dlq] = await Promise.all([
        request<HealthData>('/system/health'),
        request<FingerprintStability>(`/projects/${projectId}/analytics/fingerprint-stability`),
        request<DuplicateBugRate>(`/projects/${projectId}/analytics/duplicate-bug-rate`),
        request<{ jobs: DlqJob[] }>(`/projects/${projectId}/dlq?limit=20`),
      ]);
      setHealth(data);
      setStability(stab);
      setDuplicates(dupes);
      setDlqJobs(dlq.jobs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function retryJob(jobId: string) {
    setDlqLoading(true);
    try {
      await request<void>(`/projects/${projectId}/dlq/${jobId}/retry`, { method: 'POST' });
      setDlqJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (err) {
      console.error(err);
    } finally {
      setDlqLoading(false);
    }
  }

  if (loading) return <div style={{ padding: 24, color: '#e2e8f0' }}>Loading...</div>;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1 style={{ color: '#e2e8f0', marginBottom: 24 }}>System Health</h1>

      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <h3 style={{ color: '#e2e8f0', marginBottom: 16 }}>Providers</h3>
        {health?.providers && Object.entries(health.providers).length > 0 ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {Object.entries(health.providers).map(([id, stat]) => (
              <div key={id} style={{ display: 'flex', justifyContent: 'space-between', padding: 12, background: '#0f1117', borderRadius: 6 }}>
                <span style={{ color: '#e2e8f0', textTransform: 'capitalize' }}>{id}</span>
                <span className={`badge badge-${stat.status === 'healthy' ? 'success' : 'danger'}`}>
                  {stat.errors_last_hour} errors/hr
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: '#64748b' }}>No provider errors in the last hour.</p>
        )}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <h3 style={{ color: '#e2e8f0', marginBottom: 16 }}>Uploads</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ padding: 12, background: '#0f1117', borderRadius: 6 }}>
            <div style={{ color: '#64748b', fontSize: 12 }}>Screenshot Failures (1h)</div>
            <div style={{ color: '#e2e8f0', fontSize: 24, fontWeight: 600 }}>{health?.uploads?.screenshot_failures_last_hour ?? 0}</div>
          </div>
          <div style={{ padding: 12, background: '#0f1117', borderRadius: 6 }}>
            <div style={{ color: '#64748b', fontSize: 12 }}>Replay Failures (1h)</div>
            <div style={{ color: '#e2e8f0', fontSize: 24, fontWeight: 600 }}>{health?.uploads?.replay_failures_last_hour ?? 0}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <h3 style={{ color: '#e2e8f0', marginBottom: 16 }}>Dead Letter Queue</h3>
        {dlqJobs.length === 0 ? (
          <p style={{ color: '#64748b' }}>No dead letter jobs.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dlqJobs.map((job) => (
              <div key={job.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, background: '#0f1117', borderRadius: 6 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#e2e8f0' }}>
                    bug={job.data.bugId.slice(0, 8)}… integration={job.data.integrationId.slice(0, 8)}…
                  </div>
                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>
                    {job.failedReason}
                  </div>
                </div>
                <button
                  className="secondary"
                  disabled={dlqLoading}
                  onClick={() => retryJob(job.id)}
                  style={{ fontSize: 12 }}
                >
                  Retry
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ color: '#e2e8f0', marginBottom: 16 }}>Fingerprint Quality</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ padding: 12, background: '#0f1117', borderRadius: 6 }}>
            <div style={{ color: '#64748b', fontSize: 12 }}>Stability Score (7d)</div>
            <div style={{ color: '#e2e8f0', fontSize: 24, fontWeight: 600 }}>{stability?.stabilityScore ?? 0}%</div>
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
              {stability?.matchedErrors ?? 0} / {stability?.totalErrors ?? 0} errors matched existing fingerprint
            </div>
          </div>
          <div style={{ padding: 12, background: '#0f1117', borderRadius: 6 }}>
            <div style={{ color: '#64748b', fontSize: 12 }}>Duplicate Bug Rate (30d)</div>
            <div style={{ color: '#e2e8f0', fontSize: 24, fontWeight: 600 }}>{duplicates?.duplicateRate ?? 0}%</div>
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
              {duplicates?.duplicateBugs ?? 0} / {duplicates?.totalBugs ?? 0} bugs share a fingerprint
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
