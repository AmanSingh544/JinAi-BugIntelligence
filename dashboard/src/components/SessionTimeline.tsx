import { useEffect, useState } from 'react';
import { api, type TimelineEvent } from '../api';

const TYPE_COLORS: Record<string, string> = {
  click: '#60a5fa',
  input: '#a78bfa',
  navigation: '#34d399',
  api_request: '#fbbf24',
  api_response: '#f59e0b',
  console: '#94a3b8',
  error: '#ef4444',
  replay_snapshot: '#64748b',
};

const TYPE_ICONS: Record<string, string> = {
  click: '👆',
  input: '⌨️',
  navigation: '🔗',
  api_request: '⬆️',
  api_response: '⬇️',
  console: '📝',
  error: '🔥',
  replay_snapshot: '🎥',
};

function formatPayload(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'click':
      return `clicked ${payload.selector as string}`;
    case 'input':
      return `typed ${payload.valueLength as number} chars in ${payload.selector as string}`;
    case 'navigation':
      return `${payload.from as string} → ${payload.to as string}`;
    case 'api_request':
      return `${payload.method as string} ${payload.url as string}`;
    case 'api_response':
      return `${payload.status as number} ${payload.method as string} ${payload.url as string}`;
    case 'console':
      return `[${payload.level as string}] ${payload.message as string}`;
    case 'error':
      return `${payload.message as string}`;
    default:
      return JSON.stringify(payload).slice(0, 80);
  }
}

interface Props {
  projectId: string;
  sessionId: string;
}

export default function SessionTimeline({ projectId, sessionId }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.sessions.timeline(projectId, sessionId)
      .then((res) => setEvents(res.events))
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [projectId, sessionId]);

  if (loading) return <div style={{ color: 'var(--muted)', padding: 12 }}>Loading timeline…</div>;
  if (error) return <div style={{ color: '#ef4444', padding: 12 }}>{error}</div>;
  if (events.length === 0) return <div style={{ color: 'var(--muted)', padding: 12 }}>No events in this session.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {events.map((e) => {
        const isError = e.type === 'error';
        const color = TYPE_COLORS[e.type] ?? '#64748b';
        const isExpanded = expandedId === e.id;
        return (
          <div
            key={e.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '8px 12px',
              borderLeft: `3px solid ${color}`,
              background: isError ? 'rgba(239,68,68,0.08)' : undefined,
              cursor: 'pointer',
            }}
            onClick={() => setExpandedId(isExpanded ? null : e.id)}
          >
            <span style={{ fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>{TYPE_ICONS[e.type] ?? '•'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>
                {new Date(e.timestamp).toLocaleTimeString()} · {e.type}
              </div>
              <div style={{ fontSize: 13, color: isError ? '#ef4444' : 'var(--text)', fontWeight: isError ? 500 : 400 }}>
                {formatPayload(e.type, e.payload)}
              </div>
              {isExpanded && (
                <pre style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: 'var(--muted)',
                  background: '#0f1117',
                  padding: 8,
                  borderRadius: 4,
                  overflow: 'auto',
                  maxHeight: 200,
                }}>
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              )}
            </div>
            {isError && (
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#ef4444',
                flexShrink: 0,
                marginTop: 4,
                animation: 'pulse 2s infinite',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
