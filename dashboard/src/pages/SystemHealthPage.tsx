import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { request } from '../api';

interface HealthData {
  queues: Record<string, { lag?: number; active?: number; failed_last_hour?: number }>;
  providers: Record<string, { errors_last_hour: number; status: string }>;
  uploads: { screenshot_failures_last_hour: number; replay_failures_last_hour: number };
}

export default function SystemHealthPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    loadHealth();
  }, [projectId]);

  async function loadHealth() {
    setLoading(true);
    try {
      const data = await request<HealthData>('/system/health');
      setHealth(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
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

      <div className="card" style={{ padding: 20 }}>
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
    </div>
  );
}
