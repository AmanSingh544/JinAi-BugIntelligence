import { cn } from '../../lib/utils';

type Severity = 'critical' | 'high' | 'medium' | 'low';
type Status = 'open' | 'resolved' | 'ignored' | 'ai_failed' | 'dispatched';

const severityStyles: Record<Severity, string> = {
  critical: 'bg-red-500/10 text-red-400 border border-red-500/20',
  high:     'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  medium:   'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  low:      'bg-green-500/10 text-green-400 border border-green-500/20',
};

const statusStyles: Record<Status, string> = {
  open:       'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  resolved:   'bg-green-500/10 text-green-400 border border-green-500/20',
  ignored:    'bg-zinc-500/10 text-th-2 border border-zinc-500/20',
  ai_failed:  'bg-purple-500/10 text-purple-400 border border-purple-500/20',
  dispatched: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
};

interface BadgeProps {
  children: React.ReactNode;
  severity?: Severity;
  status?: Status;
  className?: string;
  dot?: boolean;
}

export function Badge({ children, severity, status, className, dot }: BadgeProps) {
  const style = severity
    ? severityStyles[severity] ?? 'bg-zinc-500/10 text-th-2 border border-zinc-500/20'
    : status
    ? statusStyles[status] ?? 'bg-zinc-500/10 text-th-2 border border-zinc-500/20'
    : 'bg-zinc-500/10 text-th-2 border border-zinc-500/20';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide',
        style,
        className
      )}
    >
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
          severity === 'critical' ? 'bg-red-400' :
          severity === 'high'     ? 'bg-orange-400' :
          severity === 'medium'   ? 'bg-amber-400' :
          severity === 'low'      ? 'bg-green-400' :
          status   === 'open'     ? 'bg-blue-400' :
          status   === 'resolved' ? 'bg-green-400' :
          'bg-zinc-400'
        )} />
      )}
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge severity={severity as Severity} dot>
      {severity}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label = status === 'ai_failed' ? 'AI Failed' : status;
  return (
    <Badge status={status as Status} dot>
      {label}
    </Badge>
  );
}
