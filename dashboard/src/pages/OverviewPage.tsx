import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Bug, TrendingUp, AlertTriangle, Zap, ArrowUpRight, ArrowRight } from 'lucide-react';
import { request } from '../api';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { SeverityBadge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { formatRelativeTime } from '../lib/utils';
import { cn } from '../lib/utils';

interface OverviewStats { totalBugs: number; openBugs: number; regressions: number; activeIntegrations: number; }
interface SeverityItem { severity: string; count: number; }
interface VolumePoint { date: string; count: number; }
interface TopCluster { id: string; occurrenceCount: number; bugSummary: string | null; bugSeverity: string | null; }
interface Regression { id: string; summary: string | null; severity: string | null; regressionDetectedAt: string; releaseVersion: string | null; }

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-green-500',
  unknown: 'bg-zinc-600',
};

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
        setStats(s); setSeverity(sev); setVolume(vol); setClusters(clust); setRegressions(regr);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId]);

  const maxVolume = Math.max(1, ...volume.map((v) => v.count));
  const maxSeverity = Math.max(1, ...severity.map((s) => s.count));
  const sortedSeverity = [...severity].sort(
    (a, b) => ['critical','high','medium','low','unknown'].indexOf(a.severity) - ['critical','high','medium','low','unknown'].indexOf(b.severity)
  );

  const statCards = [
    { label: 'Total Bugs', value: stats?.totalBugs ?? 0, icon: <Bug size={14} />, color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20' },
    { label: 'Open',       value: stats?.openBugs ?? 0,  icon: <AlertTriangle size={14} />, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
    { label: 'Regressions', value: stats?.regressions ?? 0, icon: <TrendingUp size={14} />, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
    { label: 'Integrations', value: stats?.activeIntegrations ?? 0, icon: <Zap size={14} />, color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20' },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-th-bg px-6 pt-2 pb-1 border-th-sub flex items-center justify-between">
        <h1 className="text-base font-bold text-th">Overview</h1>
        <p className="text-xs text-th-3 mt-0.5">Project health at a glance</p>
      </div>
      <div className="p-6 max-w-100% mx-auto w-full">

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-th-surface border border-th rounded-lg p-4 animate-pulse">
                <div className="h-7 w-12 bg-th-surface-2 rounded mb-2" />
                <div className="h-3 w-16 bg-th-surface-2 rounded" />
              </div>
            ))
          : statCards.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-th-surface border border-th rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className={cn('w-6 h-6 rounded-md border flex items-center justify-center', s.bg, s.color)}>
                    {s.icon}
                  </div>
                  <ArrowUpRight size={12} className="text-zinc-700" />
                </div>
                <div className="text-2xl font-bold text-th tabular-nums">{s.value.toLocaleString()}</div>
                <div className="text-[11px] text-th-3 mt-0.5">{s.label}</div>
              </motion.div>
            ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Error volume bar chart */}
        <Card>
          <CardHeader>
            <CardTitle>Error Volume</CardTitle>
            <span className="text-[11px] text-th-3">Last 7 days</span>
          </CardHeader>
          {loading ? (
            <div className="h-32 flex items-end gap-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex-1 bg-th-surface-2 rounded animate-pulse" style={{ height: `${30 + Math.random() * 70}%` }} />
              ))}
            </div>
          ) : volume.length === 0 ? (
            <EmptyState title="No data yet" description="Errors will appear here once captured" />
          ) : (
            <div className="flex items-end gap-1.5" style={{ height: 120 }}>
              {volume.map((v, i) => {
                const BAR_MAX = 104;
                const barH = v.count > 0 ? Math.max(6, Math.round((v.count / maxVolume) * BAR_MAX)) : 0;
                const dateLabel = v.date.slice(5);
                return (
                  <div key={v.date} className="flex-1 flex flex-col items-center justify-end gap-1" style={{ height: '100%' }}>
                    <div className="relative w-full group" style={{ height: BAR_MAX }}>
                      <div className="absolute bottom-0 w-full flex items-end" style={{ height: BAR_MAX }}>
                        <motion.div
                          className="w-full bg-indigo-500/30 hover:bg-indigo-500/60 rounded-sm transition-colors duration-150 cursor-default"
                          initial={{ height: 0 }}
                          animate={{ height: barH }}
                          transition={{ delay: i * 0.04, duration: 0.35, ease: 'easeOut' }}
                        />
                      </div>
                      {v.count > 0 && (
                        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-th-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap">
                          {v.count}
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] text-th-3 leading-none">{dateLabel}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Severity distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Severity Distribution</CardTitle>
          </CardHeader>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-5" />)}
            </div>
          ) : sortedSeverity.length === 0 ? (
            <EmptyState title="No data yet" />
          ) : (
            <div className="space-y-2.5">
              {sortedSeverity.map((s, i) => (
                <div key={s.severity} className="flex items-center gap-3">
                  <span className="w-14 text-[11px] text-th-3 capitalize">{s.severity}</span>
                  <div className="flex-1 h-1.5 bg-th-surface-2 rounded-full overflow-hidden">
                    <motion.div
                      className={cn('h-full rounded-full', SEVERITY_COLORS[s.severity] ?? 'bg-zinc-600')}
                      initial={{ width: 0 }}
                      animate={{ width: `${(s.count / maxSeverity) * 100}%` }}
                      transition={{ delay: i * 0.05, duration: 0.4 }}
                    />
                  </div>
                  <span className="w-6 text-right text-[11px] text-th-2 tabular-nums">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top clusters */}
        <Card padding="none">
          <CardHeader className="px-5 pt-5 pb-0 mb-0">
            <CardTitle>Top Clusters</CardTitle>
            <Link to={`/projects/${projectId}/clusters`} className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors duration-150">
              View all <ArrowRight size={11} />
            </Link>
          </CardHeader>
          {loading ? (
            <div className="px-5 py-4 space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : clusters.length === 0 ? (
            <EmptyState title="No clusters yet" description="Errors are grouped automatically" className="py-10" />
          ) : (
            <div className="mt-3">
              {clusters.map((c, i) => (
                <div
                  key={c.id}
                  className={cn(
                    'flex items-center justify-between px-5 py-3 gap-3',
                    i < clusters.length - 1 && 'border-b border-th-sub'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-th-2 truncate">{c.bugSummary ?? 'Untitled cluster'}</div>
                    <div className="text-[10px] text-th-3 mt-0.5">{c.occurrenceCount} occurrences</div>
                  </div>
                  {c.bugSeverity && <SeverityBadge severity={c.bugSeverity} />}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent regressions */}
        <Card padding="none">
          <CardHeader className="px-5 pt-5 pb-0 mb-0">
            <CardTitle>Recent Regressions</CardTitle>
            <Link to={`/projects/${projectId}/bugs`} className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors duration-150">
              View all <ArrowRight size={11} />
            </Link>
          </CardHeader>
          {loading ? (
            <div className="px-5 py-4 space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : regressions.length === 0 ? (
            <EmptyState title="No regressions detected" description="Regression tracking runs automatically" className="py-10" />
          ) : (
            <div className="mt-3">
              {regressions.map((r, i) => (
                <Link
                  key={r.id}
                  to={`/projects/${projectId}/bugs/${r.id}`}
                  className={cn(
                    'flex items-center justify-between px-5 py-3 gap-3 hover:bg-th-surface-2/30 transition-colors duration-150',
                    i < regressions.length - 1 && 'border-b border-th-sub'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-th-2 truncate">{r.summary ?? 'Untitled'}</div>
                    <div className="text-[10px] text-th-3 mt-0.5">
                      {r.releaseVersion ? `v${r.releaseVersion}` : 'Unknown release'} · {formatRelativeTime(r.regressionDetectedAt)}
                    </div>
                  </div>
                  {r.severity && <SeverityBadge severity={r.severity} />}
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
      </div>
    </div>
  );
}
