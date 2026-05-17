import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, RefreshCw, AlertCircle,
  Bug, RotateCcw, X, SlidersHorizontal,
} from 'lucide-react';
import { api, type Bug as BugType } from '../api';
import { Pagination } from '../components/Pagination';
import { useEventSource } from '../hooks/useEventSource';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Input';
import { SeverityBadge, StatusBadge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';
import { cn, formatRelativeTime } from '../lib/utils';

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
  const [bugs, setBugs] = useState<BugType[]>([]);
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
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [newBugsBanner, setNewBugsBanner] = useState(false);
  const [selectedBugs, setSelectedBugs] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('resolved');
  const [bulkLoading, setBulkLoading] = useState(false);
  const limit = 10;

  const activeFilters = selectedSeverities.length + selectedStatuses.length +
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) +
    (assignedToMe ? 1 : 0) + (unassignedOnly ? 1 : 0) +
    (hasRegression ? 1 : 0) + (includeArchived ? 1 : 0);

  useEffect(() => {
    api.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  const handleSse = useCallback((msg: { event: string; data: unknown }) => {
    if (msg.event === 'bug:new') {
      const data = msg.data as { projectId: string };
      if (data.projectId === projectId) setNewBugsBanner(true);
    }
  }, [projectId]);
  useEventSource(handleSse);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    const params: Record<string, string | string[] | number | undefined> = {
      page, limit,
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
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [projectId, search, selectedSeverities, selectedStatuses, dateFrom, dateTo, assignedToMe, unassignedOnly, hasRegression, sortIdx, includeArchived, currentUser, page]);

  function toggleSeverity(s: string) {
    setSelectedSeverities((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s]);
    setPage(1);
  }
  function toggleStatus(s: string) {
    setSelectedStatuses((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s]);
    setPage(1);
  }
  function clearAllFilters() {
    setSelectedSeverities([]); setSelectedStatuses([]);
    setDateFrom(''); setDateTo('');
    setAssignedToMe(false); setUnassignedOnly(false);
    setHasRegression(false); setIncludeArchived(false);
    setPage(1);
  }

  async function applyBulk() {
    if (!projectId || selectedBugs.size === 0) return;
    setBulkLoading(true);
    try {
      await api.bugs.bulkStatus(projectId, Array.from(selectedBugs), bulkStatus);
      setSelectedBugs(new Set());
      setPage(1);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="border-th bg-th-bg px-6 py-3 overflow-x-hidden">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48 max-w-72">
            <Input
              placeholder="Search bugs..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              icon={<Search size={12} />}
            />
          </div>

          <Select
            value={sortIdx}
            onChange={(e) => { setSortIdx(Number(e.target.value)); setPage(1); }}
            className="w-38"
          >
            {SORT_OPTIONS.map((opt, i) => (
              <option key={i} value={i}>{opt.label}</option>
            ))}
          </Select>

          <Button
            variant={showFilters ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className="relative"
          >
            <SlidersHorizontal size={13} />
            Filters
            {activeFilters > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-500 text-[9px] font-bold text-white flex items-center justify-center">
                {activeFilters}
              </span>
            )}
          </Button>

          {activeFilters > 0 && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1 text-xs text-th-3 hover:text-th-2 transition-colors duration-150"
            >
              <X size={11} />
              Clear
            </button>
          )}

          <div className="ml-auto text-xs text-th-3 tabular-nums">
            {total.toLocaleString()} bug{total !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Filter panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="pt-3 space-y-3 border-t border-th-sub mt-3">
                {/* Row 1: Severity + Status chips */}
                <div className="flex items-start gap-6 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-semibold text-th-3 uppercase tracking-widest whitespace-nowrap">Severity</span>
                    <div className="flex gap-1">
                      {SEVERITIES.map((s) => (
                        <button
                          key={s}
                          onClick={() => toggleSeverity(s)}
                          className={cn(
                            'text-[11px] px-2.5 py-0.5 rounded-full border transition-all duration-150 capitalize',
                            selectedSeverities.includes(s)
                              ? s === 'critical' ? 'bg-red-500/15 border-red-500/50 text-red-500'
                              : s === 'high' ? 'bg-orange-500/15 border-orange-500/50 text-orange-500'
                              : s === 'medium' ? 'bg-amber-500/15 border-amber-500/50 text-amber-600'
                              : 'bg-green-500/15 border-green-500/50 text-green-600'
                              : 'bg-transparent border-th text-th-3 hover:border-th hover:text-th-2'
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="w-px h-5 bg-th-surface-2 self-center hidden sm:block" />

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-semibold text-th-3 uppercase tracking-widest whitespace-nowrap">Status</span>
                    <div className="flex gap-1 flex-wrap">
                      {STATUSES.map((s) => (
                        <button
                          key={s}
                          onClick={() => toggleStatus(s)}
                          className={cn(
                            'text-[11px] px-2.5 py-0.5 rounded-full border transition-all duration-150',
                            selectedStatuses.includes(s)
                              ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-500'
                              : 'bg-transparent border-th text-th-3 hover:border-th hover:text-th-2'
                          )}
                        >
                          {s === 'ai_failed' ? 'AI Failed' : s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Row 2: Date range + toggle flags */}
                <div className="flex items-center gap-6 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-th-3 uppercase tracking-widest whitespace-nowrap">Date</span>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                      className="h-6 bg-th-surface border border-th rounded px-2 text-[11px] text-th-2 focus:outline-none focus:border-indigo-500"
                      style={{ colorScheme: 'var(--th-color-scheme, normal)' }}
                    />
                    <span className="text-th-3 text-xs">→</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                      className="h-6 bg-th-surface border border-th rounded px-2 text-[11px] text-th-2 focus:outline-none focus:border-indigo-500"
                      style={{ colorScheme: 'var(--th-color-scheme, normal)' }}
                    />
                  </div>

                  <div className="w-px h-4 bg-th-surface-2 self-center hidden sm:block" />

                  <div className="flex items-center gap-3 flex-wrap">
                    {[
                      { label: 'Assigned to me', value: assignedToMe, set: (v: boolean) => { setAssignedToMe(v); if (v) setUnassignedOnly(false); setPage(1); } },
                      { label: 'Unassigned', value: unassignedOnly, set: (v: boolean) => { setUnassignedOnly(v); if (v) setAssignedToMe(false); setPage(1); } },
                      { label: 'Regressions', value: hasRegression, set: (v: boolean) => { setHasRegression(v); setPage(1); } },
                      { label: 'Archived', value: includeArchived, set: (v: boolean) => { setIncludeArchived(v); setPage(1); } },
                    ].map((t) => (
                      <button
                        key={t.label}
                        onClick={() => t.set(!t.value)}
                        className={cn(
                          'text-[11px] px-2.5 py-0.5 rounded-full border transition-all duration-150',
                          t.value
                            ? 'bg-th-surface-3 border-th-card-hov text-th'
                            : 'bg-transparent border-th text-th-3 hover:border-th hover:text-th-2'
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* New bugs banner */}
      <AnimatePresence>
        {newBugsBanner && (
          <motion.button
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center justify-center gap-2 w-full py-2 bg-indigo-500/10 border-b border-indigo-500/20 text-xs text-indigo-400 hover:bg-indigo-500/15 transition-colors duration-150"
            onClick={() => { setNewBugsBanner(false); setPage(1); }}
          >
            <RefreshCw size={11} />
            New bugs detected — click to refresh
          </motion.button>
        )}
      </AnimatePresence>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selectedBugs.size > 0 && projectId && canResolve(projectId) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-3 px-6 py-2.5 bg-indigo-500/10 border-b border-indigo-500/20"
          >
            <span className="text-xs text-indigo-400 font-medium">
              {selectedBugs.size} selected
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <Select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className="w-32 h-7 text-xs">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Button size="sm" onClick={applyBulk} loading={bulkLoading}>Apply</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedBugs(new Set())}>
                <X size={12} />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border-b border-red-500/20 px-6 py-2">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {/* Bug list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : bugs.length === 0 ? (
          <EmptyState
            icon={<Bug size={18} />}
            title="No bugs found"
            description={activeFilters > 0
              ? 'Try adjusting your filters — nothing matched the current criteria.'
              : 'No bugs have been captured yet. Install the Chrome extension to start monitoring.'}
            action={activeFilters > 0
              ? <Button variant="ghost" size="sm" onClick={clearAllFilters}><RotateCcw size={12} />Clear filters</Button>
              : undefined}
          />
        ) : (
          <div className="space-y-1.5 max-w-100%">
            {bugs.map((b, i) => (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className="flex items-center gap-3"
              >
                {projectId && !isViewer(projectId) && (
                  <div
                    className={cn(
                      'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 cursor-pointer transition-all duration-150',
                      selectedBugs.has(b.id) ? 'bg-indigo-500 border-indigo-500' : 'bg-th-surface border-th hover:border-zinc-600'
                    )}
                    onClick={() => {
                      const next = new Set(selectedBugs);
                      if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                      setSelectedBugs(next);
                    }}
                  >
                    {selectedBugs.has(b.id) && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                )}

                <Link
                  to={`/projects/${projectId}/bugs/${b.id}`}
                  className={cn(
                    'flex-1 flex items-start gap-3 px-4 py-3.5 rounded-lg bg-th-surface border border-th',
                    'hover:border-th hover:bg-th-surface-2/50 transition-all duration-150 group',
                    b.archivedAt && 'opacity-50'
                  )}
                >
                  {/* Severity dot */}
                  <div className={cn(
                    'w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5',
                    b.severity === 'critical' ? 'bg-red-400' :
                    b.severity === 'high'     ? 'bg-orange-400' :
                    b.severity === 'medium'   ? 'bg-amber-400' :
                    'bg-green-400'
                  )} />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-th group-hover:text-th transition-colors duration-150 leading-snug">
                      {b.summary}
                    </div>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1.5">
                      <span className="text-[10px] font-mono text-th-3">{b.sessionId.slice(0, 8)}</span>
                      {b.assignee && (
                        <span className="text-[10px] text-th-3">· @{b.assignee.email.split('@')[0]}</span>
                      )}
                      <span className="text-[10px] text-th-3 ml-auto">{formatRelativeTime(b.createdAt)}</span>
                    </div>
                    <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                      {b.archivedAt && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-700/50 text-th-3 uppercase tracking-wide">
                          Archived
                        </span>
                      )}
                      {b.regressionDetectedAt && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 uppercase tracking-wide">
                          Regression
                        </span>
                      )}
                      <SeverityBadge severity={b.severity} />
                      <StatusBadge status={b.status} />
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="border-t border-th px-6 py-3">
        <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}
