import React from 'react';

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
  if (end - start + 1 < maxVisible) {
    start = Math.max(1, end - maxVisible + 1);
  }

  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push('...');
  }
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
      <button
        className="secondary"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        ← Prev
      </button>
      {pages.map((p, idx) =>
        p === '...' ? (
          <span key={`ellipsis-${idx}`} style={{ color: 'var(--text-muted)', padding: '0 4px' }}>...</span>
        ) : (
          <button
            key={p}
            className={p === page ? '' : 'secondary'}
            onClick={() => onPageChange(p as number)}
            style={p === page ? { fontWeight: 700 } : {}}
          >
            {p}
          </button>
        )
      )}
      <button
        className="secondary"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next →
      </button>
      <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>
        {total} total
      </span>
    </div>
  );
};
