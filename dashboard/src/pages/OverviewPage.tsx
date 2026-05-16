import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { request } from '../api';

interface OverviewStats {
  totalBugs: number;
  openBugs: number;
  regressions: number;
  activeIntegrations: number;
}

interface SeverityItem {
  severity: string;
  count: number;
}

interface VolumePoint {
  date: string;
  count: number;
}

interface TopCluster {
  id: string;
  occurrenceCount: number;
  bugSummary: string | null;
  bugSeverity: string | null;
}

interface Regression {
  id: string;
  summary: string | null;
  severity: string | null;
  regressionDetectedAt: string;
  releaseVersion: string | null;
}

export default function OverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [severity, setSeverity] = useState<SeverityItem[]>([]);
  const [volume, setVolume] = useState<VolumePoint[]>([]);
  const [clusters, setClusters] = useState<TopCluster[]>([]);
  const [regressions, setRegressions] = useState<Regression[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      request<OverviewStats>(`/projects/${projectId}/analytics/overview`),
      request<SeverityItem[]>(`/projects/${projectId}/analytics/severity-distribution`),
      request<VolumePoint[]>(`/projects/${projectId}/analytics/error-volume?days=7`),
      request<TopCluster[]>(`/projects/${projectId}/analytics/top-clusters`),
      request<Regression[]>(`/projects/${projectId}/analytics/recent-regressions`),
    ])
      .then(([s, sev, vol, clust, regr]) => {
        setStats(s);
        setSeverity(sev);
        setVolume(vol);
        setClusters(clust);
        setRegressions(regr);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <div style={{ padding: 32, color: '#94a3b8' }}>Loading...</div>;

  const maxVolume = Math.max(1, ...volume.map((v) => v.count));
  const maxSeverity = Math.max(1, ...severity.map((s) => s.count));
  const severityOrder = ['critical', 'high', 'medium', 'low', 'unknown'];
  const sortedSeverity = [...severity].sort(
    (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Overview</h1>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
        <StatCard label="Total Bugs" value={stats?.totalBugs ?? 0} />
        <StatCard label="Open Bugs" value={stats?.openBugs ?? 0} color="#f59e0b" />
        <StatCard label="Regressions" value={stats?.regressions ?? 0} color="#ef4444" />
        <StatCard label="Active Integrations" value={stats?.activeIntegrations ?? 0} color="#22c55e" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        {/* Error Volume */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#94a3b8' }}>Error Volume (Last 7 Days)</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
            {volume.map((v) => (
              <div key={v.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div
                  style={{
                    width: '100%',
                    background: '#6366f1',
                    borderRadius: 4,
                    height: `${(v.count / maxVolume) * 120}px`,
                    minHeight: v.count > 0 ? 4 : 0,
                    transition: 'height 0.3s',
                  }}
                  title={`${v.date}: ${v.count}`}
                />
                <span style={{ fontSize: 10, color: '#64748b' }}>{v.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Severity Distribution */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#94a3b8' }}>Severity Distribution</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sortedSeverity.map((s) => (
              <div key={s.severity} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 60, fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' }}>{s.severity}</span>
                <div style={{ flex: 1, background: '#1e293b', borderRadius: 4, height: 20, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${(s.count / maxSeverity) * 100}%`,
                      background: severityColor(s.severity),
                      height: '100%',
                      borderRadius: 4,
                      transition: 'width 0.3s',
                    }}
                  />
                </div>
                <span style={{ width: 30, fontSize: 12, color: '#e2e8f0', textAlign: 'right' }}>{s.count}</span>
              </div>
            ))}
            {sortedSeverity.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 12 }}>No data yet.</div>
            )}
          </div>
        </div>

        {/* Top Clusters */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#94a3b8' }}>Top Clusters</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {clusters.map((c) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: 13, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.bugSummary ?? 'Untitled cluster'}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{c.occurrenceCount} occurrences</div>
                </div>
                {c.bugSeverity && (
                  <span className={`badge badge-${c.bugSeverity}`} style={{ fontSize: 10, marginLeft: 8 }}>
                    {c.bugSeverity}
                  </span>
                )}
              </div>
            ))}
            {clusters.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 12 }}>No clusters yet.</div>
            )}
          </div>
        </div>

        {/* Recent Regressions */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#94a3b8' }}>Recent Regressions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {regressions.map((r) => (
              <Link
                key={r.id}
                to={`/projects/${projectId}/bugs/${r.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 13, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.summary ?? 'Untitled bug'}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {r.releaseVersion ? `in ${r.releaseVersion}` : 'Unknown release'} · {new Date(r.regressionDetectedAt).toLocaleDateString()}
                    </div>
                  </div>
                  {r.severity && (
                    <span className={`badge badge-${r.severity}`} style={{ fontSize: 10, marginLeft: 8 }}>
                      {r.severity}
                    </span>
                  )}
                </div>
              </Link>
            ))}
            {regressions.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 12 }}>No regressions detected.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color = '#6366f1' }: { label: string; value: number; color?: string }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#ef4444';
    case 'high': return '#f97316';
    case 'medium': return '#f59e0b';
    case 'low': return '#22c55e';
    default: return '#64748b';
  }
}
