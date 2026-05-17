import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MousePointer2, Keyboard, Navigation, ArrowUpCircle, ArrowDownCircle,
  Terminal, AlertCircle, Camera, ChevronDown,
} from 'lucide-react';
import { api, type TimelineEvent } from '../api';
import { cn } from '../lib/utils';

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string; dot: string }> = {
  click:           { icon: <MousePointer2 size={10} />, label: 'CLICK',    color: 'text-blue-500',   bg: 'bg-blue-500/10',   dot: 'bg-blue-500' },
  input:           { icon: <Keyboard size={10} />,      label: 'INPUT',    color: 'text-violet-500', bg: 'bg-violet-500/10', dot: 'bg-violet-500' },
  navigation:      { icon: <Navigation size={10} />,    label: 'NAV',      color: 'text-emerald-600',bg: 'bg-emerald-500/10',dot: 'bg-emerald-500' },
  api_request:     { icon: <ArrowUpCircle size={10} />, label: 'REQUEST',  color: 'text-amber-600',  bg: 'bg-amber-500/10',  dot: 'bg-amber-500' },
  api_response:    { icon: <ArrowDownCircle size={10} />,label:'RESPONSE', color: 'text-amber-500',  bg: 'bg-amber-500/8',   dot: 'bg-amber-400' },
  console:         { icon: <Terminal size={10} />,      label: 'CONSOLE',  color: 'text-th-3',       bg: 'bg-th-surface-2',  dot: 'bg-th-3' },
  error:           { icon: <AlertCircle size={10} />,   label: 'ERROR',    color: 'text-red-500',    bg: 'bg-red-500/15',    dot: 'bg-red-500' },
  replay_snapshot: { icon: <Camera size={10} />,        label: 'SNAPSHOT', color: 'text-th-3',       bg: 'bg-th-surface-2',  dot: 'bg-th-3' },
};

function formatPayload(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'click':        return `${payload.selector as string}`;
    case 'input':        return `${payload.valueLength as number} chars → ${payload.selector as string}`;
    case 'navigation':   return `${payload.from as string} → ${payload.to as string}`;
    case 'api_request':  return `${payload.method as string} ${payload.url as string}`;
    case 'api_response': return `${payload.status as number} ${payload.method as string} ${payload.url as string}`;
    case 'console':      return `[${payload.level as string}] ${String(payload.message).slice(0, 120)}`;
    case 'error':        return String(payload.message);
    default:             return JSON.stringify(payload).slice(0, 100);
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

  if (loading) return (
    <div className="space-y-1.5 py-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-9 bg-th-surface-2 rounded-md animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  );
  if (error) return <div className="text-xs text-red-500 py-2 font-mono">{error}</div>;
  if (events.length === 0) return <div className="text-xs text-th-3 py-4 text-center">No events recorded in this session.</div>;

  return (
    <div className="space-y-px max-h-[420px] overflow-y-auto pr-1">
      {events.map((e, i) => {
        const cfg = TYPE_CONFIG[e.type] ?? { icon: null, label: e.type.toUpperCase(), color: 'text-th-3', bg: 'bg-th-surface-2', dot: 'bg-th-3' };
        const isError = e.type === 'error';
        const isExpanded = expandedId === e.id;
        const isApiMuted = e.type === 'api_request' || e.type === 'api_response';
        const time = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        return (
          <motion.div
            key={e.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.015, 0.4), duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'group flex items-start gap-3 px-3 py-2 rounded-md cursor-pointer select-none',
              'transition-all duration-100',
              isError
                ? 'bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 hover:border-red-500/30'
                : isApiMuted
                  ? 'hover:bg-th-surface-2'
                  : 'hover:bg-th-surface-2',
            )}
            onClick={() => setExpandedId(isExpanded ? null : e.id)}
          >
            {/* Dot + line */}
            <div className="flex flex-col items-center flex-shrink-0 pt-1.5">
              <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', cfg.dot, isApiMuted && 'opacity-50')} />
              {i < events.length - 1 && (
                <div className="w-px flex-1 mt-1 min-h-[8px] bg-th-border" />
              )}
            </div>

            {/* Body */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2 mb-0.5">
                {/* Timestamp */}
                <span className={cn(
                  'font-mono text-[10px] tabular-nums flex-shrink-0',
                  isError ? 'text-red-500' : 'text-th-3'
                )}>
                  {time}
                </span>

                {/* Type badge */}
                <span className={cn(
                  'inline-flex items-center gap-1 text-[9px] font-mono font-semibold tracking-widest uppercase px-1.5 py-0.5 rounded',
                  cfg.bg, cfg.color,
                  isApiMuted && 'opacity-60'
                )}>
                  {cfg.icon}
                  {cfg.label}
                </span>

                {/* Error marker */}
                {isError && (
                  <span className="text-[9px] font-mono text-red-500 ml-auto flex-shrink-0">⚠ exception</span>
                )}
              </div>

              {/* Event summary */}
              <div className={cn(
                'text-[11px] leading-snug truncate',
                isError ? 'text-red-600 font-medium' : isApiMuted ? 'text-th-3 font-mono' : 'text-th-2',
              )}>
                {formatPayload(e.type, e.payload)}
              </div>

              {/* Expanded payload */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <pre className={cn(
                      'mt-2 text-[10px] font-mono rounded-md p-3 overflow-auto max-h-44 leading-relaxed',
                      isError
                        ? 'bg-red-500/10 border border-red-500/25 text-red-600'
                        : 'bg-th-bg border border-th text-th-3'
                    )}>
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Expand chevron */}
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.15 }}
              className={cn('flex-shrink-0 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100', cfg.color)}
            >
              <ChevronDown size={11} />
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
}
