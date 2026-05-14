import { externalApiFetch } from '../external-api-fetch';
import { ProviderError } from '../../../modules/integrations/providers/provider-error';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('externalApiFetch', () => {
  it('returns response on success', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const res = await externalApiFetch('test', { url: 'https://example.com/api' });
    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('throws ProviderError on 4xx', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('Bad request', { status: 400 }),
    );

    await expect(externalApiFetch('test', { url: 'https://example.com/api' })).rejects.toBeInstanceOf(ProviderError);
  });

  it('throws ProviderError on 5xx with retry-after', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('Server error', { status: 503, headers: { 'retry-after': '120' } }),
    );

    await expect(externalApiFetch('test', { url: 'https://example.com/api' })).rejects.toMatchObject({
      statusCode: 503,
      retryAfterSeconds: 120,
    });
  });

  it('throws for blocked URLs', async () => {
    await expect(externalApiFetch('test', { url: 'http://localhost:3000' })).rejects.toBeInstanceOf(ProviderError);
  });
});
