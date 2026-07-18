import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}

export const Pagination: React.FC<PaginationProps> = ({ page, limit, total, onPageChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;

  const pages: (number | string)[] = [];
  const maxVisible = 5;
  let start = Math.max(1, page - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);

  if (start > 1) { pages.push(1); if (start > 2) pages.push('...'); }
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages) { if (end < totalPages - 1) pages.push('...'); pages.push(totalPages); }

  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-th-3 tabular-nums">
        {((page - 1) * limit + 1).toLocaleString()}–{Math.min(page * limit, total).toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="flex items-center justify-center w-7 h-7 rounded-md bg-th-surface border border-th text-th-2 hover:bg-th-surface-2 hover:border-th disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
        >
          <ChevronLeft size={13} />
        </button>
        {pages.map((p, idx) =>
          p === '...' ? (
            <span key={`ellipsis-${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-th-3">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p as number)}
              className={cn(
                'w-7 h-7 flex items-center justify-center rounded-md text-xs font-medium transition-all duration-150',
                p === page
                  ? 'bg-indigo-500 text-white'
                  : 'bg-th-surface border border-th text-th-2 hover:bg-th-surface-2 hover:border-th'
              )}
            >
              {p}
            </button>
          )
        )}
        <button
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="flex items-center justify-center w-7 h-7 rounded-md bg-th-surface border border-th text-th-2 hover:bg-th-surface-2 hover:border-th disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
        >
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
};
