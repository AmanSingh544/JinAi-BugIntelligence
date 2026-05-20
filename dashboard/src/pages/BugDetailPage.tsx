import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Play, Users, CheckCircle2, EyeOff, Send,
  AlertTriangle, GitBranch, Clock, Cpu, ChevronRight,
  MessageSquare, Layers, Copy, Check, ExternalLink, Sparkles,
  Wrench, GitPullRequest, XCircle, RefreshCw,
} from 'lucide-react';
import { api, type BugDetail, type SimilarBug, type ClusterMember, type ChatMessage, type FixAttempt } from '../api';
import { useAuth } from '../hooks/useAuth';
import SessionTimeline from '../components/SessionTimeline';
import rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { SeverityBadge, StatusBadge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { cn, formatDateTime, formatRelativeTime } from '../lib/utils';

// ── Ambient particle canvas for AI chat card ──────────────────────────────
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W;
    canvas.height = H;

    const COUNT = 60;
    type Particle = { x: number; y: number; vy: number; vx: number; radius: number; alpha: number; phase: number; speed: number };

    const particles: Particle[] = Array.from({ length: COUNT }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vy: -(0.2 + Math.random() * 0.5),
      vx: 0,
      radius: 1.2 + Math.random() * 1.2,
      alpha: 0.15 + Math.random() * 0.35,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.8,
    }));

    let raf: number;
    let t = 0;

    function draw() {
      ctx!.clearRect(0, 0, W, H);
      t += 0.012;
      for (const p of particles) {
        p.phase += 0.018 * p.speed;
        p.x += Math.sin(p.phase) * 0.4;
        p.y += p.vy;
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(239, 68, 68, ${p.alpha})`;
        ctx!.fill();
      }
      raf = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full rounded-t-lg pointer-events-none"
      style={{ opacity: 0.8 }}
    />
  );
}

// ── Chat content renderer — handles `code` and ```blocks``` ───────────────
function ChatContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return (
    <div className="chat-content text-xs leading-relaxed whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3).replace(/^\w+\n/, '');
          return <pre key={i}>{inner}</pre>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}

// ── Sparkle particles that float up from an AI bubble on mount ───────────
const SPARKLE_CHARS = ['✦', '✧', '⋆', '✶', '·'];

function SparkleParticles() {
  const [particles, setParticles] = useState<{ id: number; x: number; char: string; delay: number; size: number }[]>([]);

  useEffect(() => {
    const count = 7;
    setParticles(
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: 8 + Math.random() * 84,       // % across the bubble
        char: SPARKLE_CHARS[Math.floor(Math.random() * SPARKLE_CHARS.length)],
        delay: i * 0.07,
        size: 8 + Math.floor(Math.random() * 7),
      }))
    );
    // Remove after animation completes so they don't linger in the DOM
    const t = setTimeout(() => setParticles([]), 1400);
    return () => clearTimeout(t);
  }, []);

  if (particles.length === 0) return null;

  return (
    <span className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl" aria-hidden>
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute bottom-1/2 select-none"
          style={{ left: `${p.x}%`, fontSize: p.size, color: 'var(--th-accent-3)', opacity: 0 }}
          animate={{ y: [0, -(40 + Math.random() * 30)], opacity: [0, 0.9, 0] }}
          transition={{ duration: 0.9, delay: p.delay, ease: 'easeOut' }}
        >
          {p.char}
        </motion.span>
      ))}
    </span>
  );
}

// ── Staggered card entrance ───────────────────────────────────────────────
function FadeUp({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

export default function BugDetailPage() {
  const { projectId, bugId } = useParams<{ projectId: string; bugId: string }>();
  const { canManage, canAssign, canResolve } = useAuth();
  const [bug, setBug] = useState<BugDetail | null>(null);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [replayEvents, setReplayEvents] = useState<unknown[] | null>(null);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [similar, setSimilar] = useState<SimilarBug[]>([]);
  const [clusterMembers, setClusterMembers] = useState<ClusterMember[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  const [copiedStack, setCopiedStack] = useState(false);
  const [fixAttempts, setFixAttempts] = useState<FixAttempt[]>([]);
  const [triggeringFix, setTriggeringFix] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const replayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectId || !bugId) return;
    api.bugs.get(projectId, bugId).then(setBug).catch((e: unknown) => setError((e as Error).message));
    api.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, [projectId, bugId]);

  useEffect(() => {
    if (!projectId || !bugId) return;
    Promise.all([
      api.bugs.similar(projectId, bugId).then((r) => setSimilar(r.similar)).catch(() => setSimilar([])),
      api.bugs.clusterMembers(projectId, bugId).then((r) => setClusterMembers(r.members)).catch(() => setClusterMembers([])),
      api.bugs.chat.getThread(projectId, bugId).then((t) => setChatMessages(t.messages)).catch(() => setChatMessages([])),
      api.bugs.fixAttempts.list(projectId, bugId).then((r) => setFixAttempts(r.attempts)).catch(() => setFixAttempts([])),
    ]);
  }, [projectId, bugId]);

  // Poll fix attempts every 10s while any attempt is in an active (non-terminal) state
  useEffect(() => {
    if (!projectId || !bugId) return;
    const ACTIVE = ['generating', 'validating', 'validated', 'pr_open'];
    const hasActive = fixAttempts.some((a) => ACTIVE.includes(a.status));
    if (!hasActive) return;

    const id = setInterval(async () => {
      try {
        const r = await api.bugs.fixAttempts.list(projectId, bugId);
        setFixAttempts(r.attempts);
      } catch { /* ignore */ }
    }, 10_000);

    return () => clearInterval(id);
  }, [projectId, bugId, fixAttempts]);

  async function triggerFix() {
    if (!projectId || !bugId) return;
    setTriggeringFix(true);
    try {
      await api.bugs.fixAttempts.trigger(projectId, bugId, true);
      const r = await api.bugs.fixAttempts.list(projectId, bugId);
      setFixAttempts(r.attempts);
    } catch (err) { setError((err as Error).message); }
    finally { setTriggeringFix(false); }
  }

  async function cancelFix(attemptId: string) {
    if (!projectId || !bugId) return;
    try {
      await api.bugs.fixAttempts.cancel(projectId, bugId, attemptId);
      const r = await api.bugs.fixAttempts.list(projectId, bugId);
      setFixAttempts(r.attempts);
    } catch (err) { setError((err as Error).message); }
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    if (!replayRef.current || !replayEvents || replayEvents.length === 0) return;
    if (!Array.isArray(replayEvents) || replayEvents.some((e) => !e || typeof e !== 'object')) return;
    const width = Math.min(replayRef.current.clientWidth, 900);
    const height = Math.round(width * 0.5625);
    const player = new rrwebPlayer({
      target: replayRef.current,
      props: { events: replayEvents as any[], width, height, autoPlay: false, showController: true, maxScale: 1 },
    });
    return () => { (player as unknown as { $destroy(): void }).$destroy(); };
  }, [replayEvents]);

  async function setStatus(status: string) {
    if (!projectId || !bugId) return;
    setUpdating(true);
    try {
      await api.bugs.updateStatus(projectId, bugId, status);
      setBug((b) => b ? { ...b, status } : b);
    } catch (err) { setError((err as Error).message); }
    finally { setUpdating(false); }
  }

  const copyStack = useCallback(() => {
    if (!bug) return;
    void navigator.clipboard.writeText(`${bug.error.message}\n\n${bug.error.stack ?? ''}`);
    setCopiedStack(true);
    setTimeout(() => setCopiedStack(false), 2000);
  }, [bug]);

  async function sendChatMessage() {
    if (!projectId || !bugId || !chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatLoading(true);
    setChatMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, role: 'user', content: msg, createdAt: new Date().toISOString() }]);
    try {
      const response = await api.bugs.chat.sendMessage(projectId, bugId, msg);
      setChatMessages((prev) => [...prev, response]);
    } catch (err) {
      setChatMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: `Error: ${(err as Error).message}`, createdAt: new Date().toISOString() }]);
    } finally { setChatLoading(false); }
  }

  if (error) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-sm text-red-400 font-mono">{error}</div>
    </div>
  );

  if (!bug) return (
    <div className="p-6 space-y-3 max-w-100% mx-auto">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-24 bg-th-surface border border-th rounded-lg animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  );

  return (
    <div className="max-w-100% mx-auto px-6 py-6 space-y-4">

      {/* ── Breadcrumb ── */}
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25 }}
        className="flex items-center gap-2 text-xs text-th-3"
      >
        <Link to={`/projects/${projectId}/bugs`} className="flex items-center gap-1.5 text-th-3 hover:text-th-2 transition-colors duration-150">
          <ArrowLeft size={12} /> Bugs
        </Link>
        <ChevronRight size={10} className="text-zinc-700" />
        <span className="text-th-3 truncate max-w-xs">{bug.summary}</span>
      </motion.div>

      {/* ── Header card ── */}
      <FadeUp delay={0}>
        <Card className="card-hover">
          <div className="flex items-start justify-between gap-4 mb-3">
            <h1 className="text-[15px] font-bold text-th leading-snug flex-1">{bug.summary}</h1>
            <div className="flex items-center gap-2 flex-shrink-0">
              {bug.archivedAt && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-700/50 text-th-3 uppercase tracking-wider">Archived</span>
              )}
              {bug.regressionDetectedAt && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 uppercase tracking-wider">Regression</span>
              )}
              <SeverityBadge severity={bug.severity} />
              <StatusBadge status={bug.status} />
            </div>
          </div>

          {/* Meta row — JetBrains Mono for IDs and timestamps */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-th-3">
            <span className="flex items-center gap-1.5">
              <Clock size={11} className="text-th-3" />
              <span className="font-mono">{formatDateTime(bug.createdAt)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-th-3">session</span>
              <span className="font-mono text-th-2">{bug.sessionId.slice(0, 12)}…</span>
            </span>
            {bug.aiModelVersion && (
              <span className="flex items-center gap-1.5">
                <Cpu size={11} className="text-th-3" />
                <span className="font-mono">{bug.aiModelVersion}</span>
                {bug.aiConfidence !== undefined && (
                  <span className="text-th-3">{Math.round(bug.aiConfidence * 100)}% conf.</span>
                )}
              </span>
            )}
            {bug.cluster && (
              <span className="flex items-center gap-1.5">
                <Layers size={11} className="text-th-3" />
                <span>{bug.cluster.occurrenceCount} in cluster</span>
              </span>
            )}
            {bug.release && (
              <span className="flex items-center gap-1.5">
                <GitBranch size={11} className="text-th-3" />
                <span className="font-mono">v{bug.release.version}</span>
              </span>
            )}
            {bug.assignee && (
              <span className="flex items-center gap-1.5">
                <Users size={11} className="text-th-3" /> {bug.assignee.email}
              </span>
            )}
          </div>

          {bug.regressionRelease && (
            <div className="mt-3 flex items-center gap-2 text-xs text-red-400 bg-red-950/40 border border-red-500/20 rounded-md px-3 py-2">
              <AlertTriangle size={12} className="flex-shrink-0" />
              Regression in <span className="font-mono font-semibold">v{bug.regressionRelease.version}</span>
              <span className="text-red-500/60 mx-1">·</span>
              detected {formatRelativeTime(bug.regressionDetectedAt!)}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-th-sub">
            {projectId && canResolve(projectId) && bug.status !== 'resolved' && (
              <Button size="sm" onClick={() => void setStatus('resolved')} loading={updating}>
                <CheckCircle2 size={12} /> Resolve
              </Button>
            )}
            {projectId && canResolve(projectId) && bug.status !== 'ignored' && (
              <Button size="sm" variant="secondary" onClick={() => void setStatus('ignored')} loading={updating}>
                <EyeOff size={12} /> Ignore
              </Button>
            )}
            {projectId && canResolve(projectId) && bug.status === 'open' && (
              <Button size="sm" variant="secondary" onClick={() => void setStatus('dispatched')} loading={updating}>
                <Send size={12} /> Dispatch
              </Button>
            )}
            {projectId && canAssign(projectId) && currentUser && !bug.assignee && (
              <Button
                size="sm"
                variant="secondary"
                loading={updating}
                onClick={async () => {
                  if (!projectId || !bugId) return;
                  setUpdating(true);
                  try {
                    const updated = await api.bugs.assign(projectId, bugId, currentUser.id);
                    setBug((b) => b ? { ...b, assignee: updated.assignee } : b);
                  } catch (err) { setError((err as Error).message); }
                  finally { setUpdating(false); }
                }}
              >
                <Users size={12} /> Assign to me
              </Button>
            )}
            {projectId && canManage(projectId) && bug.archivedAt && (
              <Button
                size="sm"
                variant="secondary"
                loading={updating}
                onClick={async () => {
                  if (!projectId || !bugId) return;
                  setUpdating(true);
                  try {
                    const updated = await api.bugs.unarchive(projectId, bugId);
                    setBug((b) => b ? { ...b, archivedAt: updated.archivedAt, status: updated.status } : b);
                  } catch (err) { setError((err as Error).message); }
                  finally { setUpdating(false); }
                }}
              >
                Unarchive
              </Button>
            )}
          </div>
        </Card>
      </FadeUp>

      {/* ── AI Analysis grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { title: 'Root Cause', content: bug.rootCause, delay: 0.07 },
          { title: 'Fix Suggestion', content: bug.fixSuggestion, delay: 0.14 },
        ].map(({ title, content, delay }) => (
          <FadeUp key={title} delay={delay}>
            <Card className="h-full card-hover">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-1 h-3.5 rounded-full bg-indigo-500/60" />
                <CardTitle className="text-[11px] uppercase tracking-wider text-th-3">{title}</CardTitle>
              </div>
              <p className="text-xs text-th-2 leading-relaxed">{content}</p>
            </Card>
          </FadeUp>
        ))}
        <FadeUp delay={0.21}>
          <Card className="h-full card-hover">
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-1 h-3.5 rounded-full bg-indigo-500/60" />
              <CardTitle className="text-[11px] uppercase tracking-wider text-th-3">Steps to Reproduce</CardTitle>
            </div>
            <ol className="space-y-1.5">
              {bug.stepsToReproduce.map((step, i) => (
                <li key={i} className="flex gap-2 text-xs text-th-2">
                  <span className="font-mono text-th-3 flex-shrink-0 select-none">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </Card>
        </FadeUp>
      </div>

      {/* ── Error detail ── */}
      <FadeUp delay={0.28}>
        <Card className="card-hover">
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <button
              onClick={copyStack}
              className={cn(
                'copy-btn flex items-center gap-1.5 text-[11px] transition-colors duration-150 px-2 py-1 rounded-md',
                copiedStack
                  ? 'copied text-green-400 bg-green-500/10'
                  : 'text-th-3 hover:text-th-2 hover:bg-th-surface-2'
              )}
            >
              {copiedStack ? <Check size={11} /> : <Copy size={11} />}
              {copiedStack ? 'Copied!' : 'Copy'}
            </button>
          </CardHeader>
          <div className="font-mono text-sm text-red-400 mb-3 leading-snug">{bug.error.message}</div>
          {bug.error.stack && (
            <pre className="text-[10px] font-mono text-th-3 bg-th-bg border border-th-sub rounded-md p-3 overflow-auto max-h-52 leading-relaxed">
              {bug.error.stack}
            </pre>
          )}
        </Card>
      </FadeUp>

      {/* ── Screenshot ── */}
      {bug.screenshotUrl && (
        <FadeUp delay={0.35}>
          <Card className="card-hover">
            <CardHeader>
              <CardTitle>Screenshot</CardTitle>
              <a href={bug.screenshotUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-[11px] text-th-3 hover:text-th-2 transition-colors duration-150 px-2 py-1 rounded-md hover:bg-th-surface-2">
                <ExternalLink size={11} /> Open
              </a>
            </CardHeader>
            <img src={bug.screenshotUrl} alt="Error screenshot" className="rounded-md border border-th max-w-full" />
          </Card>
        </FadeUp>
      )}

      {/* ── Session Replay ── */}
      <FadeUp delay={0.35}>
        <Card className="card-hover">
          <CardHeader>
            <CardTitle>Session Replay</CardTitle>
          </CardHeader>
          {replayEvents === null ? (
            <Button
              variant="secondary"
              size="sm"
              loading={loadingReplay}
              onClick={async () => {
                if (!bug.sessionId || !projectId) return;
                setLoadingReplay(true);
                try {
                  const data = await api.sessions.replay(projectId, bug.sessionId);
                  setReplayEvents(data.events);
                } catch { setReplayEvents([]); }
                finally { setLoadingReplay(false); }
              }}
            >
              <Play size={12} /> Load Replay
            </Button>
          ) : replayEvents.length === 0 ? (
            <EmptyState title="No replay data" description="This session has no recorded events" />
          ) : (
            <div>
              <p className="text-[11px] text-th-3 font-mono mb-3">{replayEvents.length} events</p>
              <div ref={replayRef} className="rounded-lg overflow-hidden" />
            </div>
          )}
        </Card>
      </FadeUp>

      {/* ── Session Timeline ── */}
      {bug.sessionId && projectId && (
        <FadeUp delay={0.42}>
          <Card className="card-hover">
            <CardHeader>
              <CardTitle>Session Timeline</CardTitle>
            </CardHeader>
            <SessionTimeline projectId={projectId} sessionId={bug.sessionId} />
          </Card>
        </FadeUp>
      )}

      {/* ── Similar Bugs ── */}
      <FadeUp delay={0.49}>
        <Card padding="none" className="card-hover">
          <div className="px-5 pt-5 pb-3">
            <CardTitle>Similar Bugs</CardTitle>
          </div>
          {similar.length === 0 && clusterMembers.length === 0 ? (
            <EmptyState title="No similar bugs found" className="py-8" />
          ) : (
            <div>
              {similar.map((s, i) => (
                <Link
                  key={s.id}
                  to={`/projects/${projectId}/bugs/${s.id}`}
                  className={cn(
                    'flex items-center justify-between px-5 py-3 gap-3',
                    'hover:bg-th-surface-2/30 transition-colors duration-150',
                    i < similar.length - 1 && 'border-b border-th-sub'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-th-2 truncate">{s.summary ?? 'Untitled'}</div>
                    <div className="text-[10px] font-mono text-th-3 mt-0.5">{formatDateTime(s.createdAt)} · {s.status}</div>
                  </div>
                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    <SeverityBadge severity={s.severity ?? 'medium'} />
                    <span className={cn(
                      'text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded',
                      s.distance < 0.15
                        ? 'text-emerald-400 bg-emerald-500/10'
                        : s.distance < 0.3
                          ? 'text-amber-400 bg-amber-500/10'
                          : 'text-red-400 bg-red-500/10'
                    )}>
                      {(s.distance * 100).toFixed(1)}%
                    </span>
                  </div>
                </Link>
              ))}
              {clusterMembers.length > 0 && (
                <>
                  <div className="px-5 py-2 text-[10px] font-semibold text-th-3 uppercase tracking-widest border-t border-th-sub">
                    Cluster members ({clusterMembers.length})
                  </div>
                  {clusterMembers.map((m, i) => (
                    <Link
                      key={m.id}
                      to={`/projects/${projectId}/bugs/${m.id}`}
                      className={cn(
                        'flex items-center justify-between px-5 py-3 gap-3',
                        'hover:bg-th-surface-2/30 transition-colors duration-150',
                        i < clusterMembers.length - 1 && 'border-b border-th-sub'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-th-2 truncate">{m.summary ?? 'Untitled'}</div>
                        <div className="text-[10px] font-mono text-th-3 mt-0.5 truncate">{m.errorMessage.slice(0, 80)}</div>
                      </div>
                      <SeverityBadge severity={m.severity ?? 'medium'} />
                    </Link>
                  ))}
                </>
              )}
            </div>
          )}
        </Card>
      </FadeUp>

      {/* ── Autofix ── */}
      <FadeUp delay={0.53}>
        <Card className="card-hover">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
                <Wrench size={12} className="text-emerald-400" />
              </div>
              <CardTitle>Autofix</CardTitle>
              {bug.fixStatus && (
                <span className={cn(
                  'text-[10px] font-mono px-1.5 py-0.5 rounded-full border',
                  bug.fixStatus === 'merged' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                  bug.fixStatus === 'pr_open' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                  bug.fixStatus === 'fix_failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                  'bg-amber-500/10 text-amber-400 border-amber-500/20'
                )}>
                  {bug.fixStatus.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            {projectId && canManage(projectId) && bug.status !== 'resolved' && bug.status !== 'ignored' && (
              <Button size="sm" variant="secondary" onClick={() => void triggerFix()} loading={triggeringFix}>
                <RefreshCw size={11} /> Trigger Fix
              </Button>
            )}
          </div>

          {fixAttempts.length === 0 ? (
            <p className="text-xs text-th-3">No fix attempts yet. Autofix runs automatically when a matching rule fires, or trigger manually above.</p>
          ) : (
            <div className="space-y-2">
              {fixAttempts.map((a) => (
                <div key={a.id} className="border border-th-sub rounded-lg p-3 bg-th-bg/40">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-th-3">#{a.attempt_number}</span>
                      <span className={cn(
                        'text-[10px] font-mono px-1.5 py-0.5 rounded border',
                        a.status === 'merged' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                        a.status === 'pr_open' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                        a.status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        a.status === 'cancelled' ? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' :
                        'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      )}>
                        {a.status}
                      </span>
                      {a.fix_confidence != null && (
                        <span className="text-[10px] text-th-3 font-mono">{Math.round(a.fix_confidence * 100)}% conf.</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {a.pr_url && (
                        <a href={a.pr_url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
                          <GitPullRequest size={10} /> PR #{a.pr_number}
                        </a>
                      )}
                      {['generating', 'validating', 'validated', 'pr_open'].includes(a.status) && projectId && canManage(projectId) && (
                        <button
                          onClick={() => void cancelFix(a.id)}
                          className="flex items-center gap-1 text-[10px] text-th-3 hover:text-red-400 transition-colors"
                        >
                          <XCircle size={10} /> Cancel
                        </button>
                      )}
                    </div>
                  </div>
                  {a.target_file && (
                    <div className="text-[10px] font-mono text-th-3 truncate">
                      {a.target_file}{a.start_line != null ? `:${a.start_line}–${a.end_line}` : ''}
                    </div>
                  )}
                  {a.fix_explanation && (
                    <p className="text-[11px] text-th-2 mt-1">{a.fix_explanation}</p>
                  )}
                  {a.failure_reason && (
                    <p className="text-[10px] text-red-400 mt-1 font-mono">{a.failure_reason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </FadeUp>

      {/* ── AI Debug Assistant ── */}
      <FadeUp delay={0.56}>
        <div className="bg-th-surface border border-th rounded-lg overflow-hidden card-hover">

          {/* Card header with particle canvas behind it */}
          <div className="relative px-5 py-4 border-b border-th-sub overflow-hidden" style={{ minHeight: 64 }}>
            <ParticleCanvas />
            <div className="relative z-10 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-red-500/15 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                <Sparkles size={13} className="text-red-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-th flex items-center gap-2">
                  AI Debug Assistant
                  <span className="flex items-center gap-1 text-[9px] font-mono text-red-400/60 bg-red-500/8 border border-red-500/10 px-1.5 py-0.5 rounded-full">
                    <span className="w-1 h-1 rounded-full bg-red-400 animate-pulse inline-block" />
                    active
                  </span>
                </div>
                <div className="text-[11px] text-th-3">Ask about root cause, fixes, impact, or related code</div>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div
            className="relative p-4 max-h-80 overflow-y-auto flex flex-col gap-3 bg-th-bg/40"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--th-scrollbar) transparent' }}
          >
            <ParticleCanvas />
            {chatMessages.length === 0 && !chatLoading && (
              <div className="py-6 text-center">
                <MessageSquare size={16} className="text-zinc-700 mx-auto mb-2" />
                <p className="text-xs text-th-3">No messages yet. Ask anything about this bug.</p>
              </div>
            )}
            {chatMessages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  'relative max-w-[88%] px-3.5 py-2.5 rounded-2xl',
                  m.role === 'user'
                    ? 'self-end bg-indigo-500 text-white rounded-br-sm'
                    : 'self-start bg-th-surface-2/80 border border-th/50 text-th-2 rounded-bl-sm'
                )}
              >
                {m.role === 'assistant' && <SparkleParticles />}
                {m.role === 'assistant' ? (
                  <ChatContent content={m.content} />
                ) : (
                  <span className="text-xs leading-relaxed">{m.content}</span>
                )}
              </motion.div>
            ))}
            {chatLoading && (
              <div className="self-start flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-th-surface-2/80 border border-th/50 rounded-bl-sm">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-zinc-500"
                    animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
                  />
                ))}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-th-sub flex gap-2 bg-th-surface">
            <input
              className="flex-1 bg-th-surface-2/60 border border-th/60 rounded-lg px-3 py-2 text-xs text-th placeholder:text-th-3 focus:outline-none focus:border-indigo-500/70 focus:bg-th-surface-2 transition-all duration-150"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChatMessage(); } }}
              placeholder="Ask about this bug…"
              disabled={chatLoading}
            />
            <Button
              size="sm"
              onClick={() => void sendChatMessage()}
              disabled={chatLoading || !chatInput.trim()}
            >
              <Send size={12} />
            </Button>
          </div>
        </div>
      </FadeUp>

    </div>
  );
}
