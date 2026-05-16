import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type Bug } from '../api';
import { Pagination } from '../components/Pagination';
import { useEventSource } from '../hooks/useEventSource';
import { useAuth } from '../hooks/useAuth';

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const STATUSES = ['open', 'dispatched', 'resolved', 'ignored', 'ai_failed'] as const;
const SORT_OPTIONS = [
  { label: 'Newest first', by: 'created_at', order: 'desc' },
  { label: 'Oldest first', by: 'created_at', order: 'asc' },
  { label: 'Severity', by: 'severity', order: 'desc' },
  { label: 'Status', by: 'status', order: 'asc' },
] as const;

export default function BugsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canResolve, isViewer } = useAuth();
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [search, setSearch] = useState('');
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [hasRegression, setHasRegression] = useState(false);
  const [sortIdx, setSortIdx] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [newBugsBanner, setNewBugsBanner] = useState(false);
  const [selectedBugs, setSelectedBugs] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('resolved');
  const limit = 20;

  useEffect(() => {
    api.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  const handleSse = useCallback((msg: { event: string; data: unknown }) => {
    if (msg.event === 'bug:new') {
      const data = msg.data as { projectId: string };
      if (data.projectId === projectId) {
        setNewBugsBanner(true);
      }
    }
  }, [projectId]);

  useEventSource(handleSse);

  useEffect(() => {
    if (!projectId) return;
    const params: Record<string, string | string[] | number | undefined> = {
      page,
      limit,
      sortBy: SORT_OPTIONS[sortIdx].by,
      sortOrder: SORT_OPTIONS[sortIdx].order,
    };
    if (search.trim()) params.search = search.trim();
    if (selectedSeverities.length > 0) params.severities = selectedSeverities;
    if (selectedStatuses.length > 0) params.statuses = selectedStatuses;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (assignedToMe && currentUser) params.assignedTo = 'me';
    else if (unassignedOnly) params.assignedTo = 'unassigned';
    if (hasRegression) params.hasRegression = 'true';
    if (includeArchived) params.includeArchived = 'true';
    api.bugs.list(projectId, params)
      .then((res) => { setBugs(res.items); setTotal(res.total); })
      .catch((e: unknown) => setError((e as Error).message));
  }, [projectId, search, selectedSeverities, selectedStatuses, dateFrom, dateTo, assignedToMe, unassignedOnly, hasRegression, sortIdx, includeArchived, currentUser, page]);

  function toggleSeverity(s: string) {
    setSelectedSeverities((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
    setPage(1);
  }

  function toggleStatus(s: string) {
    setSelectedStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
    setPage(1);
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Link to="/">← Projects</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Bugs</h1>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search bugs..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ width: 200, padding: '6px 10px', borderRadius: 4, border: '1px solid #2d3148', background: '#0f1117', color: '#e2e8f0' }}
        />
        <select
          value={sortIdx}
          onChange={(e) => { setSortIdx(Number(e.target.value)); setPage(1); }}
          style={{ width: 160 }}
        >
          {SORT_OPTIONS.map((opt, i) => (
            <option key={i} value={i}>{opt.label}</option>
          ))}
        </select>
        <button className="secondary" onClick={() => setShowFilters((v) => !v)}>
          {showFilters ? 'Hide filters' : 'Filters'}
        </button>
      </div>

      {showFilters && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--muted)' }}>Severity</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {SEVERITIES.map((s) => (
                  <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedSeverities.includes(s)}
                      onChange={() => toggleSeverity(s)}
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--muted)' }}>Status</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {STATUSES.map((s) => (
                  <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedStatuses.includes(s)}
                      onChange={() => toggleStatus(s)}
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--muted)' }}>Date range</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #2d3148', background: '#0f1117', color: '#e2e8f0' }}
                />
                <span style={{ color: 'var(--muted)' }}>→</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #2d3148', background: '#0f1117', color: '#e2e8f0' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={assignedToMe}
                  onChange={(e) => { setAssignedToMe(e.target.checked); setUnassignedOnly(false); setPage(1); }}
                />
                Assigned to me
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={unassignedOnly}
                  onChange={(e) => { setUnassignedOnly(e.target.checked); setAssignedToMe(false); setPage(1); }}
                />
                Unassigned only
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={hasRegression}
                  onChange={(e) => { setHasRegression(e.target.checked); setPage(1); }}
                />
                Regressions only
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => { setIncludeArchived(e.target.checked); setPage(1); }}
                />
                Include archived
              </label>
            </div>
          </div>
        </div>
      )}

      {newBugsBanner && (
        <div
          style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
          }}
          onClick={() => { setNewBugsBanner(false); setPage(1); }}
        >
          <span style={{ fontSize: 13, color: '#94a3b8' }}>New bugs detected · Click to refresh</span>
          <span style={{ fontSize: 12, color: '#60a5fa' }}>Refresh →</span>
        </div>
      )}
      {selectedBugs.size > 0 && projectId && canResolve(projectId) && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, padding: 10, background: '#1e293b', borderRadius: 6 }}>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>{selectedBugs.size} selected</span>
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={{ width: 140 }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={async () => {
            if (!projectId) return;
            try {
              await api.bugs.bulkStatus(projectId, Array.from(selectedBugs), bulkStatus);
              setSelectedBugs(new Set());
              setPage(1);
            } catch (e: unknown) {
              setError((e as Error).message);
            }
          }}>Apply</button>
          <button className="secondary" onClick={() => setSelectedBugs(new Set())}>Clear</button>
        </div>
      )}

      {error && <div style={{ color: '#ef4444', marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bugs.map((b) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: b.archivedAt ? 0.6 : 1 }}>
            {projectId && !isViewer(projectId) && (
              <input
                type="checkbox"
                checked={selectedBugs.has(b.id)}
                onChange={(e) => {
                  const next = new Set(selectedBugs);
                  if (e.target.checked) next.add(b.id);
                  else next.delete(b.id);
                  setSelectedBugs(next);
                }}
              />
            )}
            <Link to={`/projects/${projectId}/bugs/${b.id}`} style={{ textDecoration: 'none', flex: 1 }}>
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
                  {b.archivedAt && (
                    <span className="badge" style={{ background: '#64748b', color: '#fff' }}>Archived</span>
                  )}
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
          </div>
        ))}
        {bugs.length === 0 && !error && (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>
            No bugs match your filters.
          </div>
        )}
      </div>
      <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
    </div>
  );
}
