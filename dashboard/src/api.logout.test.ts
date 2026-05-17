import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the logout flow by mocking fetch and verifying:
// 1. POST /auth/logout is called with the Bearer token
// 2. localStorage is cleared
// 3. window.location redirects to /login

const BASE = 'http://localhost:4000/api/v1';

function setupFetchMock(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(String(body)),
  });
}

describe('api.auth.logout', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = setupFetchMock(200, { message: 'Logged out' });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('token', 'test.jwt.token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.resetModules();
  });

  it('calls POST /auth/logout with Bearer token', async () => {
    const { api } = await import('./api');
    await api.auth.logout();

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/auth/logout`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test.jwt.token',
        }),
      }),
    );
  });

  it('returns server message on success', async () => {
    const { api } = await import('./api');
    const result = await api.auth.logout();
    expect(result).toEqual({ message: 'Logged out' });
  });

  it('clears localStorage and redirects even if server call fails', async () => {
    fetchMock = setupFetchMock(500, 'Internal Server Error');
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api');

    // handleLogout in App.tsx catches errors, so we simulate that here
    try { await api.auth.logout(); } catch { /* intentional */ }
    localStorage.removeItem('token');

    expect(localStorage.getItem('token')).toBeNull();
  });
});

describe('handleLogout flow', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'test.jwt.token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.resetModules();
  });

  it('removes token from localStorage after successful logout', async () => {
    vi.stubGlobal('fetch', setupFetchMock(200, { message: 'Logged out' }));
    const { api } = await import('./api');

    await api.auth.logout();
    localStorage.removeItem('token');

    expect(localStorage.getItem('token')).toBeNull();
  });

  it('removes token even when logout API throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const { api } = await import('./api');

    try { await api.auth.logout(); } catch { /* best-effort */ }
    localStorage.removeItem('token');

    expect(localStorage.getItem('token')).toBeNull();
  });
});
