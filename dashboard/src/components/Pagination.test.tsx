import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  it('renders nothing when only one page', () => {
    const { container } = render(
      <Pagination page={1} limit={20} total={5} onPageChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders page buttons for multiple pages', () => {
    render(<Pagination page={1} limit={20} total={100} onPageChange={() => {}} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('calls onPageChange when clicking next', () => {
    const onChange = vi.fn();
    render(<Pagination page={1} limit={20} total={100} onPageChange={onChange} />);
    fireEvent.click(screen.getByText('Next →'));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('disables prev on first page', () => {
    render(<Pagination page={1} limit={20} total={100} onPageChange={() => {}} />);
    expect(screen.getByText('← Prev')).toBeDisabled();
  });

  it('disables next on last page', () => {
    render(<Pagination page={5} limit={20} total={100} onPageChange={() => {}} />);
    expect(screen.getByText('Next →')).toBeDisabled();
  });
});
