import { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, type BugDetail, type SimilarBug, type ClusterMember, type ChatMessage } from '../api';
import { useAuth } from '../hooks/useAuth';
import SessionTimeline from '../components/SessionTimeline';
import rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';

export default function BugDetailPage() {
  const { projectId, bugId } = useParams<{ projectId: string; bugId: string }>();
  const nav = useNavigate();
  const { canManage, canAssign, canResolve } = useAuth();
  const [bug, setBug] = useState<BugDetail | null>(null);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [replayEvents, setReplayEvents] = useState<unknown[] | null>(null);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [similar, setSimilar] = useState<SimilarBug[]>([]);
  const [clusterMembers, setClusterMembers] = useState<ClusterMember[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const replayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectId || !bugId) return;
    api.bugs.get(projectId, bugId).then(setBug).catch((e: unknown) => setError((e as Error).message));
    api.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, [projectId, bugId]);

  useEffect(() => {
    if (!projectId || !bugId) return;
    setLoadingSimilar(true);
    Promise.all([
      api.bugs.similar(projectId, bugId).then((r) => setSimilar(r.similar)).catch(() => setSimilar([])),
      api.bugs.clusterMembers(projectId, bugId).then((r) => setClusterMembers(r.members)).catch(() => setClusterMembers([])),
      api.bugs.chat.getThread(projectId, bugId).then((t) => setChatMessages(t.messages)).catch(() => setChatMessages([])),
    ]).finally(() => setLoadingSimilar(false));
  }, [projectId, bugId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    if (!replayRef.current || !replayEvents || replayEvents.length === 0) return;

    // Validate payload shape
    if (!Array.isArray(replayEvents) || replayEvents.some((e) => !e || typeof e !== 'object')) {
      return;
    }

    // Measure container for responsive sizing
    const width = Math.min(replayRef.current.clientWidth, 900);
    const height = Math.round(width * 0.5625); // 16:9

    const player = new rrwebPlayer({
      target: replayRef.current,
      props: {
        events: replayEvents as any[],
        width,
        height,
        autoPlay: false,
        showController: true,
        maxScale: 1,
      },
    });

    return () => {
      (player as unknown as { $destroy(): void }).$destroy();
    };
  }, [replayEvents]);

  async function setStatus(status: string) {
    if (!projectId || !bugId) return;
    setUpdating(true);
    try {
      await api.bugs.updateStatus(projectId, bugId, status);
      setBug((b) => b ? { ...b, status } : b);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdating(false);
    }
  }

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
      setChatMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'assistant', content: `Error: ${(err as Error).message}`, createdAt: new Date().toISOString() },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  if (error) return (
    <div style={{ padding: 32, color: '#ef4444' }}>{error}</div>
  );

  if (!bug) return (
    <div style={{ padding: 32, color: 'var(--muted)' }}>Loading…</div>
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Link to={`/projects/${projectId}/bugs`}>← Bugs</Link>
      </div>

      {/* Header */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, flex: 1, marginRight: 16 }}>{bug.summary}</h1>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {bug.archivedAt && (
              <span className="badge" style={{ background: '#64748b', color: '#fff' }}>Archived</span>
            )}
            {bug.regressionDetectedAt && (
              <span className="badge" style={{ background: '#ef4444', color: '#fff' }}>Regression</span>
            )}
            <span className={`badge badge-${bug.severity}`}>{bug.severity}</span>
            <span className={`badge badge-${bug.status}`}>{bug.status}</span>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Session: <code>{bug.sessionId}</code> · {new Date(bug.createdAt).toLocaleString()} · AI: {bug.aiModelVersion}
          {bug.aiConfidence !== undefined && (
            <span> · Confidence: {Math.round(bug.aiConfidence * 100)}%</span>
          )}
        </div>
        {bug.cluster && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            Cluster: <code>{bug.cluster.id.slice(0, 8)}…</code> · {bug.cluster.occurrenceCount} occurrences
          </div>
        )}
        {bug.release && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            Release: <code>{bug.release.version}</code>
          </div>
        )}
        {bug.regressionRelease && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#ef4444' }}>
            Regression introduced in: <code>{bug.regressionRelease.version}</code> · Detected {new Date(bug.regressionDetectedAt!).toLocaleString()}
          </div>
        )}
        {bug.assignee && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            Assigned to: <strong>{bug.assignee.email}</strong>
          </div>
        )}
      </div>

      {/* AI Analysis */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Root Cause</h2>
        <p style={{ color: 'var(--text)', lineHeight: 1.6 }}>{bug.rootCause}</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Steps to Reproduce</h2>
        <ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bug.stepsToReproduce.map((step, i) => (
            <li key={i} style={{ lineHeight: 1.6 }}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Fix Suggestion</h2>
        <p style={{ color: 'var(--text)', lineHeight: 1.6 }}>{bug.fixSuggestion}</p>
      </div>

      {/* Screenshot */}
      {bug.screenshotUrl && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Screenshot</h2>
          <img
            src={bug.screenshotUrl}
            alt="Error screenshot"
            style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--border)' }}
          />
        </div>
      )}

      {/* Replay */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Session Replay</h2>
        {replayEvents === null ? (
          <button
            className="secondary"
            onClick={async () => {
              if (!bug.sessionId || !projectId) return;
              setLoadingReplay(true);
              try {
                const data = await api.sessions.replay(projectId, bug.sessionId);
                setReplayEvents(data.events);
              } catch {
                setReplayEvents([]);
              } finally {
                setLoadingReplay(false);
              }
            }}
            disabled={loadingReplay}
          >
            {loadingReplay ? 'Loading...' : 'View Replay'}
          </button>
        ) : replayEvents.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No replay data available.</p>
        ) : (
          <div>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>{replayEvents.length} replay events</p>
            <div ref={replayRef} style={{ borderRadius: 6, minHeight: 200 }} />
          </div>
        )}
      </div>

      {/* Session Timeline */}
      {bug.sessionId && projectId && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Session Timeline</h2>
          <SessionTimeline projectId={projectId} sessionId={bug.sessionId} />
        </div>
      )}

      {/* Error details */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Error</h2>
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: '#ef4444', fontFamily: 'monospace', fontSize: 13 }}>{bug.error.message}</span>
        </div>
        {bug.error.stack && (
          <pre style={{
            background: '#0f1117',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            fontSize: 11,
            overflow: 'auto',
            color: 'var(--muted)',
            maxHeight: 300,
          }}>
            {bug.error.stack}
          </pre>
        )}
      </div>

      {/* Similar Bugs */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Similar Bugs</h2>
        {loadingSimilar ? (
          <p style={{ color: 'var(--muted)' }}>Loading…</p>
        ) : similar.length === 0 && clusterMembers.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No similar bugs found.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {similar.map((s) => (
              <Link
                key={s.id}
                to={`/projects/${projectId}/bugs/${s.id}`}
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
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.summary ?? 'Untitled'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {new Date(s.createdAt).toLocaleString()} · {s.status}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12 }}>
                  <span className={`badge badge-${s.severity ?? 'medium'}`}>{s.severity ?? 'medium'}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: s.distance < 0.15 ? '#22c55e' : s.distance < 0.3 ? '#f59e0b' : '#ef4444',
                    }}
                    title="Semantic distance (lower = more similar)"
                  >
                    {(s.distance * 100).toFixed(1)}%
                  </span>
                </div>
              </Link>
            ))}
            {clusterMembers.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginTop: 4 }}>
                  Cluster members ({clusterMembers.length})
                </div>
                {clusterMembers.map((m) => (
                  <Link
                    key={m.id}
                    to={`/projects/${projectId}/bugs/${m.id}`}
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
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {m.summary ?? 'Untitled'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {m.errorMessage.slice(0, 80)}{m.errorMessage.length > 80 ? '…' : ''}
                      </div>
                    </div>
                    <span className={`badge badge-${m.severity ?? 'medium'}`}>{m.severity ?? 'medium'}</span>
                  </Link>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* AI Debug Chat */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>AI Debug Assistant</h2>
        <div
          style={{
            maxHeight: 400,
            overflowY: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {chatMessages.length === 0 && (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Ask me anything about this bug — root cause analysis, how to fix it, impact assessment, or related code investigation.
            </p>
          )}
          {chatMessages.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '8px 12px',
                borderRadius: 10,
                background: m.role === 'user' ? 'var(--accent)' : 'var(--surface)',
                color: m.role === 'user' ? '#fff' : 'var(--text)',
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
          ))}
          {chatLoading && (
            <div style={{ alignSelf: 'flex-start', padding: '8px 12px', borderRadius: 10, background: 'var(--surface)', fontSize: 13, color: 'var(--muted)' }}>
              Thinking…
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void sendChatMessage(); }}
            placeholder="Ask about this bug…"
            style={{ flex: 1 }}
            disabled={chatLoading}
          />
          <button onClick={() => void sendChatMessage()} disabled={chatLoading || !chatInput.trim()}>
            Send
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="card">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Actions</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {projectId && canResolve(projectId) && bug.status !== 'resolved' && (
            <button onClick={() => void setStatus('resolved')} disabled={updating}>
              Mark Resolved
            </button>
          )}
          {projectId && canResolve(projectId) && bug.status !== 'ignored' && (
            <button className="secondary" onClick={() => void setStatus('ignored')} disabled={updating}>
              Ignore
            </button>
          )}
          {projectId && canResolve(projectId) && bug.status === 'open' && (
            <button className="secondary" onClick={() => void setStatus('dispatched')} disabled={updating}>
              Dispatch
            </button>
          )}
          {projectId && canAssign(projectId) && currentUser && !bug.assignee && (
            <button
              className="secondary"
              onClick={async () => {
                if (!projectId || !bugId) return;
                setUpdating(true);
                try {
                  const updated = await api.bugs.assign(projectId, bugId, currentUser.id);
                  setBug((b) => b ? { ...b, assignee: updated.assignee } : b);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setUpdating(false);
                }
              }}
              disabled={updating}
            >
              Assign to me
            </button>
          )}
          {projectId && canManage(projectId) && bug.archivedAt && (
            <button
              className="secondary"
              onClick={async () => {
                if (!projectId || !bugId) return;
                setUpdating(true);
                try {
                  const updated = await api.bugs.unarchive(projectId, bugId);
                  setBug((b) => b ? { ...b, archivedAt: updated.archivedAt, status: updated.status } : b);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setUpdating(false);
                }
              }}
              disabled={updating}
            >
              Unarchive
            </button>
          )}
          <button className="secondary" onClick={() => nav(-1)}>Back</button>
        </div>
      </div>
    </div>
  );
}
