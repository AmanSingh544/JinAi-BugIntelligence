import { cn } from '../../lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  padding?: 'sm' | 'md' | 'lg' | 'none';
}

export function Card({ className, hover = true, padding = 'md', children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-th-surface border border-th rounded-lg',
        hover && 'card-hover',
        padding === 'sm'  && 'p-3',
        padding === 'md'  && 'p-5',
        padding === 'lg'  && 'p-6',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-sm font-semibold text-th-2', className)} {...props}>
      {children}
    </h3>
  );
}
