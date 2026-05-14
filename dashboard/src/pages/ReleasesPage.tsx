import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type Release, type ReleaseSourcemap } from '../api';

interface ReleaseWithSourcemaps extends Release {
  _sourcemaps?: ReleaseSourcemap[];
  _sourcemapsLoading?: boolean;
  _sourcemapsExpanded?: boolean;
}

export default function ReleasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [releases, setReleases] = useState<ReleaseWithSourcemaps[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    fetchReleases();
  }, [projectId]);

  async function fetchReleases() {
    if (!projectId) return;
    setLoading(true);
    try {
      const rows = await api.releases.list(projectId);
      setReleases(rows);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function toggleSourcemaps(releaseId: string) {
    if (!projectId) return;
    setReleases((prev) =>
      prev.map((r) => {
        if (r.id !== releaseId) return r;
        const next = { ...r, _sourcemapsExpanded: !r._sourcemapsExpanded };
        if (next._sourcemapsExpanded && !next._sourcemaps) {
          next._sourcemapsLoading = true;
          api.releases.listSourcemaps(projectId, releaseId)
            .then((res) => {
              setReleases((p) =>
                p.map((x) => (x.id === releaseId ? { ...x, _sourcemaps: res.items, _sourcemapsLoading: false } : x))
              );
            })
            .catch((err) => {
              console.error(err);
              setReleases((p) =>
                p.map((x) => (x.id === releaseId ? { ...x, _sourcemapsLoading: false } : x))
              );
            });
        }
        return next;
      })
    );
  }

  if (loading) return <div style={{ padding: 24, color: '#e2e8f0' }}>Loading...</div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/" style={{ color: '#6366f1', textDecoration: 'none' }}>← Projects</Link>
        <h1 style={{ marginTop: 12, color: '#e2e8f0' }}>Releases</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginTop: 4 }}>
          Sourcemaps are uploaded automatically via the{' '}
          <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4 }}>@bug-intelligence/sourcemap-upload</code>{' '}
          CLI in your CI/CD pipeline.
        </p>
      </div>

      {releases.length === 0 ? (
        <p style={{ color: '#64748b' }}>No releases yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {releases.map((r) => (
            <div key={r.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => toggleSourcemaps(r.id)}>
                <div>
                  <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{r.version}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  {r._sourcemapsExpanded ? '▲ Hide sourcemaps' : '▼ Show sourcemaps'}
                </div>
              </div>

              {r._sourcemapsExpanded && (
                <div style={{ marginTop: 16, borderTop: '1px solid #334155', paddingTop: 12 }}>
                  {r._sourcemapsLoading ? (
                    <p style={{ color: '#64748b', fontSize: 12 }}>Loading sourcemaps...</p>
                  ) : !r._sourcemaps || r._sourcemaps.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: 12 }}>No sourcemaps uploaded for this release.</p>
                  ) : (
                    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px' }}>Lookup Key</th>
                          <th style={{ padding: '6px 8px' }}>Declared File</th>
                          <th style={{ padding: '6px 8px' }}>Size</th>
                          <th style={{ padding: '6px 8px' }}>Status</th>
                          <th style={{ padding: '6px 8px' }}>Hash</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r._sourcemaps.map((sm) => (
                          <tr key={sm.id} style={{ borderTop: '1px solid #1e293b' }}>
                            <td style={{ padding: '6px 8px', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>
                              {sm.minified_filename}
                            </td>
                            <td style={{ padding: '6px 8px', color: '#94a3b8', fontSize: 12 }}>
                              {sm.declared_file || '—'}
                            </td>
                            <td style={{ padding: '6px 8px', color: '#94a3b8' }}>
                              {sm.sourcemap_size ? `${(sm.sourcemap_size / 1024).toFixed(1)} KB` : '—'}
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              {sm.sourcemap_parsed ? (
                                <span style={{ color: '#22c55e', fontSize: 12 }}>✓ Parsed</span>
                              ) : (
                                <span style={{ color: '#ef4444', fontSize: 12 }} title={sm.sourcemap_error || ''}>
                                  ✗ Failed
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '6px 8px', color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>
                              {sm.content_hash ? sm.content_hash.slice(0, 8) + '…' : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
