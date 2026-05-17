import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  suffix?: React.ReactNode;
}

const inputBase = [
  'w-full input-th rounded-md text-sm',
  'px-3 py-1.5 h-8 transition-all duration-150',
  'focus:outline-none focus:ring-1',
  'disabled:opacity-40 disabled:cursor-not-allowed',
].join(' ');

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, icon, suffix, ...props }, ref) => {
    if (icon || suffix) {
      return (
        <div className="relative flex items-center">
          {icon && (
            <div className="absolute left-2.5 text-th-3 pointer-events-none flex items-center">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={cn(inputBase, 'border', icon && 'pl-8', suffix && 'pr-8', className)}
            {...props}
          />
          {suffix && (
            <div className="absolute right-2.5 text-th-3 flex items-center">
              {suffix}
            </div>
          )}
        </div>
      );
    }

    return (
      <input
        ref={ref}
        className={cn(inputBase, 'border', className)}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full input-th border rounded-md text-sm',
        'px-3 py-2 min-h-[80px] resize-y transition-all duration-150',
        'focus:outline-none focus:ring-1',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'input-th border rounded-md text-sm',
        'px-3 py-1.5 h-8 transition-all duration-150 cursor-pointer appearance-none',
        'focus:outline-none focus:ring-1',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        className
      )}
      {...props}
    />
  )
);
Select.displayName = 'Select';
