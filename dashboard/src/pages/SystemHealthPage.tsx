import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { request } from '../api';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { cn } from '../lib/utils';

interface HealthData {
  queues: Record<string, { lag?: number; active?: number; failed_last_hour?: number }>;
  providers: Record<string, { errors_last_hour: number; status: string }>;
  uploads: { screenshot_failures_last_hour: number; replay_failures_last_hour: number };
}
interface FingerprintStability { stabilityScore: number; totalErrors: number; matchedErrors: number; }
interface DuplicateBugRate { duplicateRate: number; totalBugs: number; duplicateBugs: number; }
interface DlqJob {
  id: string; name: string;
  data: { bugId: string; integrationId: string; attempt: number };
  failedReason: string; timestamp: number;
}

export default function SystemHealthPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [stability, setStability] = useState<FingerprintStability | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateBugRate | null>(null);
  const [dlqJobs, setDlqJobs] = useState<DlqJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [dlqLoading, setDlqLoading] = useState(false);

  useEffect(() => { if (projectId) void loadHealth(); }, [projectId]);

  async function loadHealth() {
    if (!projectId) return;
    setLoading(true);
    try {
      const [data, stab, dupes, dlq] = await Promise.all([
        request<HealthData>('/system/health'),
        request<FingerprintStability>(`/projects/${projectId}/analytics/fingerprint-stability`),
        request<DuplicateBugRate>(`/projects/${projectId}/analytics/duplicate-bug-rate`),
        request<{ jobs: DlqJob[] }>(`/projects/${projectId}/dlq?limit=20`),
      ]);
      setHealth(data); setStability(stab); setDuplicates(dupes); setDlqJobs(dlq.jobs);
    } catch { /* quiet */ }
    finally { setLoading(false); }
  }

  async function retryJob(jobId: string) {
    setDlqLoading(true);
    try {
      await request<void>(`/projects/${projectId}/dlq/${jobId}/retry`, { method: 'POST' });
      setDlqJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch { /* quiet */ }
    finally { setDlqLoading(false); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-th-bg px-6 pt-2 pb-1 border-th-sub flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-th">System Health</h1>
          <p className="text-xs text-th-3 mt-0.5">Pipeline and integration diagnostics</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void loadHealth()} loading={loading}>
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>
      <div className="p-6 max-w-100% mx-auto w-full">

      {loading ? (
        <div className="space-y-4">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-th-surface border border-th rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Fingerprint quality */}
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardHeader><CardTitle>Fingerprint Stability</CardTitle><span className="text-[10px] text-th-3">7 days</span></CardHeader>
              <div className="text-3xl font-bold text-th tabular-nums mb-1">{stability?.stabilityScore ?? 0}%</div>
              <div className="text-xs text-th-3">{stability?.matchedErrors ?? 0} / {stability?.totalErrors ?? 0} matched</div>
            </Card>
            <Card>
              <CardHeader><CardTitle>Duplicate Bug Rate</CardTitle><span className="text-[10px] text-th-3">30 days</span></CardHeader>
              <div className="text-3xl font-bold text-th tabular-nums mb-1">{duplicates?.duplicateRate ?? 0}%</div>
              <div className="text-xs text-th-3">{duplicates?.duplicateBugs ?? 0} / {duplicates?.totalBugs ?? 0} shared fingerprint</div>
            </Card>
          </div>

          {/* Uploads */}
          <Card>
            <CardHeader><CardTitle>Upload Failures (last hour)</CardTitle></CardHeader>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className={cn('w-2 h-2 rounded-full', (health?.uploads?.screenshot_failures_last_hour ?? 0) > 0 ? 'bg-red-400' : 'bg-green-400')} />
                <div>
                  <div className="text-xs text-th-2">Screenshot Failures</div>
                  <div className="text-lg font-bold text-th tabular-nums">{health?.uploads?.screenshot_failures_last_hour ?? 0}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className={cn('w-2 h-2 rounded-full', (health?.uploads?.replay_failures_last_hour ?? 0) > 0 ? 'bg-red-400' : 'bg-green-400')} />
                <div>
                  <div className="text-xs text-th-2">Replay Failures</div>
                  <div className="text-lg font-bold text-th tabular-nums">{health?.uploads?.replay_failures_last_hour ?? 0}</div>
                </div>
              </div>
            </div>
          </Card>

          {/* Providers */}
          <Card>
            <CardHeader><CardTitle>Integration Providers</CardTitle></CardHeader>
            {health?.providers && Object.keys(health.providers).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(health.providers).map(([id, stat]) => (
                  <div key={id} className="flex items-center justify-between px-3 py-2 bg-th-bg rounded-md">
                    <div className="flex items-center gap-2">
                      {stat.status === 'healthy'
                        ? <CheckCircle2 size={13} className="text-green-400" />
                        : <AlertCircle size={13} className="text-red-400" />}
                      <span className="text-xs text-th-2 capitalize">{id}</span>
                    </div>
                    <span className={cn('text-[11px] font-medium', stat.errors_last_hour > 0 ? 'text-red-400' : 'text-green-400')}>
                      {stat.errors_last_hour} errors/hr
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No providers configured" className="py-6" />
            )}
          </Card>

          {/* DLQ */}
          <Card>
            <CardHeader><CardTitle>Dead Letter Queue</CardTitle></CardHeader>
            {dlqJobs.length === 0 ? (
              <EmptyState icon={<CheckCircle2 size={16} />} title="All clear" description="No failed jobs in queue" className="py-6" />
            ) : (
              <div className="space-y-2">
                {dlqJobs.map((job) => (
                  <div key={job.id} className="flex items-start justify-between gap-3 bg-th-bg rounded-md px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-xs font-mono text-th-2">
                        bug:{job.data.bugId.slice(0, 8)} · integration:{job.data.integrationId.slice(0, 8)}
                      </div>
                      <div className="text-[11px] text-red-400 mt-0.5 truncate">{job.failedReason}</div>
                    </div>
                    <Button size="xs" variant="secondary" loading={dlqLoading} onClick={() => void retryJob(job.id)}>
                      Retry
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
      </div>
    </div>
  );
}
