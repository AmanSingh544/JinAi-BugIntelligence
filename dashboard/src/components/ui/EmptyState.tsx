import { cn } from '../../lib/utils';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      {icon && (
        <div className="w-12 h-12 rounded-xl bg-th-surface-2 border border-th flex items-center justify-center mb-4 text-th-3">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-medium text-th-2 mb-1">{title}</h3>
      {description && <p className="text-xs text-th-3 max-w-xs mb-4">{description}</p>}
      {action}
    </div>
  );
}
