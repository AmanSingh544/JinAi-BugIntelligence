import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, AlertCircle, ChevronRight, X } from 'lucide-react';
import { api, type Cluster, type ClusterBug, type TrendPoint } from '../api';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { SeverityBadge, StatusBadge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Pagination } from '../components/Pagination';
import { cn, formatRelativeTime, formatDate } from '../lib/utils';

type ClusterDetail = {
  cluster: { id: string; occurrenceCount: number; lastSeenAt: string; createdAt: string; bug?: { id: string; summary: string | null; severity: string | null; status: string } } | null;
  bugs: ClusterBug[];
  trend: TrendPoint[];
};

function DetailPanel({
  selectedClusterId,
  detailLoading,
  clusterDetail,
  projectId,
  maxTrend,
}: {
  selectedClusterId: string | null;
  detailLoading: boolean;
  clusterDetail: ClusterDetail | null;
  projectId: string | undefined;
  maxTrend: number;
}) {
  return (
    <AnimatePresence mode="wait">
      {detailLoading ? (
        <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </motion.div>
      ) : clusterDetail ? (
        <motion.div
          key={selectedClusterId}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="space-y-3"
        >
          {/* Header */}
          <div>
            <h2 className="text-sm font-semibold text-th line-clamp-2 mb-2">
              {clusterDetail.cluster?.bug?.summary ?? 'Untitled cluster'}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              {clusterDetail.cluster?.bug?.severity && (
                <SeverityBadge severity={clusterDetail.cluster.bug.severity} />
              )}
              {clusterDetail.cluster?.bug?.status && (
                <StatusBadge status={clusterDetail.cluster.bug.status} />
              )}
            </div>
          </div>

          {/* Occurrences chart */}
          <Card>
            <CardHeader>
              <CardTitle>Occurrences (last 30 days)</CardTitle>
            </CardHeader>
            {clusterDetail.trend.length === 0 ? (
              <EmptyState title="No trend data" className="py-6" />
            ) : (
              <div className="flex items-end gap-0.5 h-28">
                {clusterDetail.trend.map((t, i) => (
                  <div
                    key={t.date}
                    className="flex-1 flex flex-col items-center gap-1"
                    title={`${t.date}: ${t.count}`}
                  >
                    <motion.div
                      className="w-full bg-indigo-500/20 hover:bg-indigo-500/40 rounded-sm transition-colors duration-150 cursor-default"
                      style={{ height: `${(t.count / maxTrend) * 100}%`, minHeight: t.count > 0 ? 2 : 0 }}
                      initial={{ scaleY: 0, originY: '100%' }}
                      animate={{ scaleY: 1 }}
                      transition={{ delay: i * 0.012, duration: 0.3, ease: 'easeOut' }}
                    />
                    {i % 5 === 0 && (
                      <span className="text-[8px] text-zinc-700">{t.date.slice(5)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Bugs in cluster */}
          <Card padding="none">
            <div className="px-5 py-4">
              <CardTitle>Bugs in cluster ({clusterDetail.bugs.length})</CardTitle>
            </div>
            {clusterDetail.bugs.length === 0 ? (
              <EmptyState title="No bugs in this cluster" className="py-6" />
            ) : (
              <div>
                {clusterDetail.bugs.map((b, i) => (
                  <Link
                    key={b.id}
                    to={`/projects/${projectId}/bugs/${b.id}`}
                    className={cn(
                      'flex items-center justify-between px-5 py-3 gap-3 hover:bg-th-surface-2/30 transition-colors duration-150',
                      i < clusterDetail.bugs.length - 1 && 'border-b border-th-sub'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-th-2 truncate">{b.summary ?? 'Untitled'}</div>
                      <div className="text-[10px] text-th-3 mt-0.5">{formatDate(b.createdAt)} · {b.status}</div>
                    </div>
                    <SeverityBadge severity={b.severity ?? 'medium'} />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

const PAGE_LIMIT = 10;

export default function ClustersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [clusterDetail, setClusterDetail] = useState<ClusterDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.clusters.list(projectId, page, PAGE_LIMIT)
      .then((res) => {
        setClusters(res.clusters);
        setTotal(res.total);
        if (res.clusters.length > 0) setSelectedClusterId(res.clusters[0].id);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [projectId, page]);

  useEffect(() => {
    if (!projectId || !selectedClusterId) { setClusterDetail(null); return; }
    setDetailLoading(true);
    api.clusters.detail(projectId, selectedClusterId, 30)
      .then((res) => setClusterDetail(res))
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setDetailLoading(false));
  }, [projectId, selectedClusterId]);

  const maxTrend = Math.max(1, ...(clusterDetail?.trend.map((t) => t.count) ?? []));

  function handleSelectCluster(id: string) {
    setSelectedClusterId(id);
    setDrawerOpen(true);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-th-bg px-6 pt-2 pb-1 border-th-sub flex items-center justify-between">
        <h1 className="text-base font-bold text-th">Clusters</h1>
        <p className="text-xs text-th-3 mt-0.5">Semantically grouped errors by vector similarity</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6 max-w-100% mx-auto w-full">

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 mb-4">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : clusters.length === 0 ? (
        <EmptyState
          icon={<Layers size={18} />}
          title="No clusters yet"
          description="Errors are clustered automatically as they are ingested through the AI pipeline."
        />
      ) : (
        <>
          {/* Desktop: 5-column grid; Mobile: list only */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Cluster list — 2 cols on lg */}
            <div className="lg:col-span-2 space-y-1.5">
              {clusters.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSelectCluster(c.id)}
                  className={cn(
                    'w-full text-left rounded-lg border p-4 transition-all duration-150',
                    selectedClusterId === c.id
                      ? 'bg-blue-900/10 border-[rgba(43,108,176,0.3)]'
                      : 'bg-th-surface border-th hover:border-th hover:bg-th-surface-2/50'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-xs font-medium text-th line-clamp-2">
                      {c.bug?.summary ?? 'Untitled cluster'}
                    </span>
                    <ChevronRight
                      size={13}
                      className={cn(
                        'flex-shrink-0 mt-0.5 transition-colors duration-150',
                        selectedClusterId === c.id ? 'text-blue-400' : 'text-th-3'
                      )}
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.bug?.severity && <SeverityBadge severity={c.bug.severity} />}
                    {c.bug?.status && <StatusBadge status={c.bug.status} />}
                    <span className="text-[10px] text-th-3 ml-auto">
                      {c.occurrenceCount} · last {formatRelativeTime(c.lastSeenAt)}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Detail panel — 3 cols on lg, hidden on mobile (uses drawer instead) */}
            <div className="lg:col-span-3 hidden lg:block">
              <DetailPanel
                selectedClusterId={selectedClusterId}
                detailLoading={detailLoading}
                clusterDetail={clusterDetail}
                projectId={projectId}
                maxTrend={maxTrend}
              />
            </div>
          </div>

          {/* Mobile drawer */}
          <AnimatePresence>
            {drawerOpen && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setDrawerOpen(false)}
                />
                {/* Drawer */}
                <motion.div
                  className="fixed top-0 right-0 h-full w-full sm:w-[420px] bg-th-sidebar border-l border-th z-50 overflow-y-auto lg:hidden"
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-th-sub sticky top-0 bg-th-sidebar z-10">
                    <span className="text-sm font-semibold text-th">Cluster detail</span>
                    <button
                      onClick={() => setDrawerOpen(false)}
                      className="text-th-3 hover:text-th-2 transition-colors duration-150"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="p-5">
                    <DetailPanel
                      selectedClusterId={selectedClusterId}
                      detailLoading={detailLoading}
                      clusterDetail={clusterDetail}
                      projectId={projectId}
                      maxTrend={maxTrend}
                    />
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>
      )}
      </div>

      <div className="border-t border-th px-6 py-3">
        <Pagination page={page} limit={PAGE_LIMIT} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}
