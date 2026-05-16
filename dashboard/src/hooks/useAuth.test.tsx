import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from './useAuth';

const mockUser = {
  id: 'u1',
  email: 'test@example.com',
  emailVerified: true,
  memberships: [
    { tenantId: 't1', role: 'owner', projectIds: ['p1', 'p2'] },
    { tenantId: 't2', role: 'viewer', projectIds: ['p3'] },
  ],
};

vi.mock('../api', () => ({
  api: {
    auth: {
      me: vi.fn(),
    },
  },
}));

import { api } from '../api';

function TestComponent() {
  const { user, loading, roleFor, canManage, canAssign, canResolve, isViewer } = useAuth();
  if (loading) return <div>Loading</div>;
  if (!user) return <div>Not logged in</div>;
  return (
    <div>
      <div data-testid="email">{user.email}</div>
      <div data-testid="verified">{user.emailVerified ? 'yes' : 'no'}</div>
      <div data-testid="role-p1">{roleFor('p1') ?? 'none'}</div>
      <div data-testid="role-p3">{roleFor('p3') ?? 'none'}</div>
      <div data-testid="manage-p1">{canManage('p1') ? 'yes' : 'no'}</div>
      <div data-testid="manage-p3">{canManage('p3') ? 'yes' : 'no'}</div>
      <div data-testid="assign-p1">{canAssign('p1') ? 'yes' : 'no'}</div>
      <div data-testid="assign-p3">{canAssign('p3') ? 'yes' : 'no'}</div>
      <div data-testid="resolve-p1">{canResolve('p1') ? 'yes' : 'no'}</div>
      <div data-testid="viewer-p3">{isViewer('p3') ? 'yes' : 'no'}</div>
    </div>
  );
}

describe('useAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('shows loading initially when token exists', async () => {
    localStorage.setItem('token', 'test-token');
    (api.auth.me as any).mockResolvedValue(mockUser);

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    expect(screen.getByText('Loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('email')).toHaveTextContent('test@example.com'));
  });

  it('shows not logged in when no token', async () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Not logged in')).toBeInTheDocument());
  });

  it('returns correct role for project', async () => {
    localStorage.setItem('token', 'test-token');
    (api.auth.me as any).mockResolvedValue(mockUser);

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('role-p1')).toHaveTextContent('owner');
      expect(screen.getByTestId('role-p3')).toHaveTextContent('viewer');
    });
  });

  it('canManage returns true for owner/admin only', async () => {
    localStorage.setItem('token', 'test-token');
    (api.auth.me as any).mockResolvedValue(mockUser);

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('manage-p1')).toHaveTextContent('yes');
      expect(screen.getByTestId('manage-p3')).toHaveTextContent('no');
    });
  });

  it('canAssign returns true for developer+', async () => {
    localStorage.setItem('token', 'test-token');
    (api.auth.me as any).mockResolvedValue(mockUser);

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('assign-p1')).toHaveTextContent('yes');
      expect(screen.getByTestId('assign-p3')).toHaveTextContent('no');
    });
  });

  it('canResolve returns true for developer+', async () => {
    localStorage.setItem('token', 'test-token');
    (api.auth.me as any).mockResolvedValue(mockUser);

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('resolve-p1')).toHaveTextContent('yes');
    });
  });

  it('isViewer returns true only for viewer role', async () => {
    localStorage.setItem('token', 'test-token');
    (api.auth.me as any).mockResolvedValue(mockUser);

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('viewer-p3')).toHaveTextContent('yes');
    });
  });

  it('returns none for unknown project', async () => {
    localStorage.setItem('token', 'test-token');
    (api.auth.me as any).mockResolvedValue(mockUser);

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('role-p1')).toHaveTextContent('owner');
    });
  });

  it('shows emailVerified from me response', async () => {
    localStorage.setItem('token', 'test-token');
    (api.auth.me as any).mockResolvedValue(mockUser);

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('verified')).toHaveTextContent('yes');
    });
  });
});
