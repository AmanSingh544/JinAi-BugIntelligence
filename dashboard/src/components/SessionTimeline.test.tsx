import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SessionTimeline from './SessionTimeline';

vi.mock('../api', () => ({
  api: {
    sessions: {
      timeline: vi.fn().mockResolvedValue({
        events: [
          { id: 'e1', type: 'click', timestamp: 1000, payload: { selector: '#btn', text: 'Submit' } },
          { id: 'e2', type: 'input', timestamp: 2000, payload: { tag: 'input', inputType: 'text', valueLength: 5, isPassword: false, selector: '#name' } },
          { id: 'e3', type: 'error', timestamp: 3000, payload: { message: 'Something broke', file: 'app.js', line: 42 } },
          { id: 'e4', type: 'navigation', timestamp: 4000, payload: { from: '/login', to: '/dashboard' } },
        ],
      }),
    },
  },
}));

describe('SessionTimeline', () => {
  it('renders loading state initially', () => {
    render(<SessionTimeline projectId="p1" sessionId="s1" />);
    expect(screen.getByText('Loading timeline…')).toBeInTheDocument();
  });

  it('renders events after loading', async () => {
    render(<SessionTimeline projectId="p1" sessionId="s1" />);
    expect(await screen.findByText('Something broke')).toBeInTheDocument();
    expect(screen.getByText('clicked #btn')).toBeInTheDocument();
  });

  it('expands payload on click', async () => {
    render(<SessionTimeline projectId="p1" sessionId="s1" />);
    const errorEvent = await screen.findByText('Something broke');
    fireEvent.click(errorEvent.closest('div')!);
    expect(screen.getByText(/"message"/)).toBeInTheDocument();
  });
});
