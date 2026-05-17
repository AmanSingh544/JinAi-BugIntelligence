import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 font-medium rounded-md select-none',
          'transition-all duration-150 cursor-pointer',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none',
          'active:scale-[0.96]',
          variant === 'primary' && [
            'bg-[var(--th-accent)] text-white shadow-sm',
            'hover:bg-[var(--th-accent-2)] hover:shadow-md',
            'active:bg-[var(--th-accent-2)]',
            'focus-visible:outline-[var(--th-accent)]',
          ],
          variant === 'secondary' && [
            'bg-th-surface-2 text-th border border-th',
            'hover:bg-th-surface-3 hover:text-th',
            'focus-visible:outline-[var(--th-accent)]',
          ],
          variant === 'ghost' && [
            'text-th-2',
            'hover:text-th hover:bg-th-surface-2',
            'focus-visible:outline-[var(--th-accent)]',
          ],
          variant === 'danger' && [
            'bg-red-500/10 text-red-500 border border-red-500/20',
            'hover:bg-red-500/20 hover:border-red-500/40',
            'focus-visible:outline-red-500',
          ],
          variant === 'outline' && [
            'bg-transparent text-th-2 border border-th',
            'hover:bg-th-surface-2 hover:text-th',
            'focus-visible:outline-[var(--th-accent)]',
          ],
          size === 'xs' && 'text-[11px] px-2 py-1 h-6 rounded gap-1',
          size === 'sm' && 'text-xs px-2.5 py-1.5 h-7',
          size === 'md' && 'text-sm px-3 py-1.5 h-8',
          size === 'lg' && 'text-sm px-4 py-2 h-9',
          className,
        )}
        {...props}
      >
        {loading ? (
          <>
            <svg className="animate-spin -ml-0.5 h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {children}
          </>
        ) : children}
      </button>
    );
  }
);

Button.displayName = 'Button';
