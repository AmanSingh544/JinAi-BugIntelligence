import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type Cluster, type ClusterBug, type TrendPoint } from '../api';

export default function ClustersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [clusterDetail, setClusterDetail] = useState<{
    cluster: { id: string; occurrenceCount: number; lastSeenAt: string; createdAt: string; bug?: { id: string; summary: string | null; severity: string | null; status: string } } | null;
    bugs: ClusterBug[];
    trend: TrendPoint[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.clusters.list(projectId)
      .then((res) => setClusters(res.clusters))
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !selectedClusterId) {
      setClusterDetail(null);
      return;
    }
    setDetailLoading(true);
    api.clusters.detail(projectId, selectedClusterId, 30)
      .then((res) => setClusterDetail(res))
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setDetailLoading(false));
  }, [projectId, selectedClusterId]);

  const maxTrend = Math.max(1, ...(clusterDetail?.trend.map((t) => t.count) ?? []));

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Link to="/">← Projects</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Clusters</h1>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {clusters.map((c) => (
              <div
                key={c.id}
                className="card"
                style={{
                  cursor: 'pointer',
                  borderColor: selectedClusterId === c.id ? 'var(--accent)' : undefined,
                }}
                onClick={() => setSelectedClusterId(c.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.bug?.summary ?? 'Untitled cluster'}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                      {c.occurrenceCount} occurrences · {c.uniqueSessions} unique sessions (last 30 days)
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {c.bug?.severity && <span className={`badge badge-${c.bug.severity}`}>{c.bug.severity}</span>}
                    {c.bug?.status && <span className={`badge badge-${c.bug.status}`}>{c.bug.status}</span>}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                  Last seen {new Date(c.lastSeenAt).toLocaleDateString()}
                </div>
              </div>
            ))}
            {clusters.length === 0 && (
              <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>
                No clusters yet. Errors will be clustered as they are ingested.
              </div>
            )}
          </div>

          <div>
            {selectedClusterId && detailLoading && (
              <div className="card" style={{ color: 'var(--muted)' }}>Loading detail…</div>
            )}
            {clusterDetail && !detailLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Trend chart */}
                <div className="card">
                  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Occurrences (last 30 days)</h3>
                  {clusterDetail.trend.length === 0 ? (
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>No trend data.</div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
                      {clusterDetail.trend.map((t) => (
                        <div key={t.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <div
                            style={{
                              width: '100%',
                              background: 'var(--accent)',
                              borderRadius: 2,
                              height: `${(t.count / maxTrend) * 100}px`,
                              minHeight: 4,
                              opacity: 0.8,
                            }}
                            title={`${t.date}: ${t.count}`}
                          />
                          <span style={{ fontSize: 9, color: 'var(--muted)', transform: 'rotate(-45deg)', transformOrigin: 'top left' }}>
                            {t.date.slice(5)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Bugs in cluster */}
                <div className="card">
                  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Bugs in cluster ({clusterDetail.bugs.length})</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {clusterDetail.bugs.map((b) => (
                      <Link
                        key={b.id}
                        to={`/projects/${projectId}/bugs/${b.id}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          textDecoration: 'none',
                          color: 'inherit',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{b.summary ?? 'Untitled'}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            {new Date(b.createdAt).toLocaleDateString()} · {b.status}
                          </div>
                        </div>
                        <span className={`badge badge-${b.severity ?? 'medium'}`}>{b.severity ?? 'medium'}</span>
                      </Link>
                    ))}
                    {clusterDetail.bugs.length === 0 && (
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>No bugs in this cluster.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
