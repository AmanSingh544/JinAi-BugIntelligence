import { ProviderError } from './provider-error';

describe('ProviderError', () => {
  it('sets statusCode and providerId', () => {
    const err = new ProviderError({ message: 'Failed', providerId: 'jira', statusCode: 404 });
    expect(err.statusCode).toBe(404);
    expect(err.providerId).toBe('jira');
    expect(err.message).toContain('[jira]');
    expect(err.message).toContain('Failed');
    expect(err.name).toBe('ProviderError');
  });

  it('detects rate limit (429)', () => {
    const err = new ProviderError({ message: 'Too many', providerId: 'github', statusCode: 429 });
    expect(err.isRateLimit).toBe(true);
    expect(err.isServerError).toBe(false);
  });

  it('detects server error (5xx)', () => {
    const err = new ProviderError({ message: 'Down', providerId: 'jira', statusCode: 503 });
    expect(err.isRateLimit).toBe(false);
    expect(err.isServerError).toBe(true);
  });

  it('does not flag 4xx as server error', () => {
    const err = new ProviderError({ message: 'Bad request', providerId: 'jira', statusCode: 400 });
    expect(err.isServerError).toBe(false);
    expect(err.isRateLimit).toBe(false);
  });

  it('includes retryAfter in message', () => {
    const err = new ProviderError({ message: 'Rate limited', providerId: 'github', statusCode: 429, retryAfterSeconds: 60 });
    expect(err.retryAfterSeconds).toBe(60);
    expect(err.message).toContain('Retry-After=60s');
  });

  it('handles statusCode 0', () => {
    const err = new ProviderError({ message: 'Network error', providerId: 'generic', statusCode: 0 });
    expect(err.statusCode).toBe(0);
    expect(err.isRateLimit).toBe(false);
    expect(err.isServerError).toBe(false);
  });
});
